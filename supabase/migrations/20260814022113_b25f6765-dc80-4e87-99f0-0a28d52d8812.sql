ALTER TABLE public.user_luma_calendars
  ADD COLUMN IF NOT EXISTS is_mine boolean NOT NULL DEFAULT false;

UPDATE public.user_luma_calendars
SET is_mine = true
WHERE COALESCE(ownership, 'external') = 'connected' AND is_mine = false;

CREATE INDEX IF NOT EXISTS user_luma_calendars_user_mine_idx
  ON public.user_luma_calendars (user_id)
  WHERE is_mine;

CREATE TABLE IF NOT EXISTS public.app_user_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  connector_id text NOT NULL,
  connection_key_ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, connector_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_user_connections TO service_role;
ALTER TABLE public.app_user_connections ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.notion_sync_settings (
  user_id uuid PRIMARY KEY,
  database_id text,
  database_title text,
  parent_page_id text,
  auto_sync boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  last_status text,
  last_error text,
  last_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.notion_sync_settings TO authenticated;
GRANT ALL ON public.notion_sync_settings TO service_role;
ALTER TABLE public.notion_sync_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own Notion sync settings"
  ON public.notion_sync_settings FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_notion_sync_settings_updated_at
  BEFORE UPDATE ON public.notion_sync_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.notion_event_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  canonical_event_id uuid NOT NULL REFERENCES public.canonical_events(id) ON DELETE CASCADE,
  database_id text NOT NULL,
  notion_page_id text NOT NULL,
  content_hash text,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, canonical_event_id, database_id)
);

GRANT SELECT ON public.notion_event_pages TO authenticated;
GRANT ALL ON public.notion_event_pages TO service_role;
ALTER TABLE public.notion_event_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own Notion page links"
  ON public.notion_event_pages FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_notion_event_pages_updated_at
  BEFORE UPDATE ON public.notion_event_pages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.get_event_library_stats(p_user_id uuid, p_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH all_calendars AS (
    SELECT
      c.id,
      c.merged_into_id,
      COALESCE(c.provider, 'luma') AS provider,
      COALESCE(c.ownership, 'external') AS ownership,
      COALESCE(c.is_mine, false) AS is_mine,
      c.sync_status,
      COALESCE(
        c.provider_source_id,
        NULLIF(regexp_replace(regexp_replace(lower(btrim(c.calendar_url)), '^https?://(www\.)?', ''), '[?#].*$|/+$', '', 'g'), ''),
        c.calendar_id,
        c.id::text
      ) AS identity_value
    FROM public.user_luma_calendars c
    WHERE c.user_id = p_user_id
  ), active AS (
    SELECT * FROM all_calendars WHERE merged_into_id IS NULL
  ), deduped AS (
    SELECT DISTINCT ON (provider, identity_value) *
    FROM active
    ORDER BY provider, identity_value, (ownership = 'connected') DESC, id
  ), library AS (
    SELECT jsonb_build_object(
      'totalCalendars', (SELECT count(*) FROM all_calendars)::int,
      'activeCalendars', (SELECT count(*) FROM deduped)::int,
      'duplicateCalendars', (SELECT count(*) FROM active)::int - (SELECT count(*) FROM deduped)::int,
      'mineCalendars', (SELECT count(*) FROM deduped WHERE is_mine)::int,
      'lumaConnected', (SELECT count(*) FROM deduped WHERE provider = 'luma' AND ownership = 'connected')::int,
      'lumaExternal', (SELECT count(*) FROM deduped WHERE provider = 'luma' AND ownership <> 'connected')::int,
      'meetupExternal', (SELECT count(*) FROM deduped WHERE provider = 'meetup')::int,
      'otherProviders', (SELECT count(*) FROM deduped WHERE provider NOT IN ('luma','meetup'))::int,
      'mergedHidden', (SELECT count(*) FROM all_calendars WHERE merged_into_id IS NOT NULL)::int,
      'erroredSources', (SELECT count(*) FROM active WHERE sync_status IN ('failed','inaccessible'))::int
    ) AS value
  ), sightings AS (
    SELECT DISTINCT s.calendar_row_id, s.canonical_event_id, a.provider, a.is_mine
    FROM public.event_sources s
    JOIN active a ON a.id = s.calendar_row_id
    WHERE s.user_id = p_user_id
  ), per_calendar AS (
    SELECT
      a.id AS calendar_row_id,
      count(e.id)::int AS total,
      count(e.id) FILTER (WHERE e.start_at > p_at OR (e.start_at <= p_at AND e.end_at > p_at))::int AS upcoming,
      count(e.id) FILTER (WHERE e.start_at <= p_at AND (e.end_at IS NULL OR e.end_at <= p_at))::int AS past,
      count(e.id) FILTER (WHERE e.start_at IS NULL)::int AS unknown
    FROM active a
    LEFT JOIN sightings s ON s.calendar_row_id = a.id
    LEFT JOIN public.canonical_events e ON e.id = s.canonical_event_id
    GROUP BY a.id
  ), provider_events AS (
    SELECT s.provider, e.id, e.start_at, e.end_at
    FROM (SELECT DISTINCT provider, canonical_event_id FROM sightings) s
    JOIN public.canonical_events e ON e.id = s.canonical_event_id
  ), per_provider AS (
    SELECT
      provider,
      count(*)::int AS total,
      count(*) FILTER (WHERE start_at > p_at OR (start_at <= p_at AND end_at > p_at))::int AS upcoming,
      count(*) FILTER (WHERE start_at <= p_at AND (end_at IS NULL OR end_at <= p_at))::int AS past,
      count(*) FILTER (WHERE start_at IS NULL)::int AS unknown
    FROM provider_events
    GROUP BY provider
  ), global_events AS (
    SELECT e.id, e.start_at, e.end_at
    FROM public.canonical_events e
    WHERE e.user_id = p_user_id
      AND EXISTS (SELECT 1 FROM sightings s WHERE s.canonical_event_id = e.id)
  ), global_stats AS (
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE start_at > p_at OR (start_at <= p_at AND end_at > p_at))::int AS upcoming,
      count(*) FILTER (WHERE start_at <= p_at AND (end_at IS NULL OR end_at <= p_at))::int AS past,
      count(*) FILTER (WHERE start_at IS NULL)::int AS unknown
    FROM global_events
  ), mine_events AS (
    SELECT e.id, e.start_at, e.end_at
    FROM public.canonical_events e
    WHERE e.user_id = p_user_id
      AND EXISTS (SELECT 1 FROM sightings s WHERE s.canonical_event_id = e.id AND s.is_mine)
  ), mine_stats AS (
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE start_at > p_at OR (start_at <= p_at AND end_at > p_at))::int AS upcoming,
      count(*) FILTER (WHERE start_at <= p_at AND (end_at IS NULL OR end_at <= p_at))::int AS past,
      count(*) FILTER (WHERE start_at IS NULL)::int AS unknown
    FROM mine_events
  )
  SELECT jsonb_build_object(
    'generatedAt', p_at,
    'total', COALESCE(g.total, 0),
    'upcoming', COALESCE(g.upcoming, 0),
    'past', COALESCE(g.past, 0),
    'unknown', COALESCE(g.unknown, 0),
    'mine', (SELECT jsonb_build_object('total', total, 'upcoming', upcoming, 'past', past, 'unknown', unknown) FROM mine_stats),
    'library', (SELECT value FROM library),
    'providers', COALESCE((
      SELECT jsonb_object_agg(provider, jsonb_build_object(
        'total', total, 'upcoming', upcoming, 'past', past, 'unknown', unknown))
      FROM per_provider
    ), '{}'::jsonb),
    'calendars', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'calendarRowId', calendar_row_id,
        'total', total,
        'upcoming', upcoming,
        'past', past,
        'unknown', unknown) ORDER BY calendar_row_id)
      FROM per_calendar
    ), '[]'::jsonb)
  )
  FROM global_stats g
$function$;

REVOKE ALL ON FUNCTION public.get_event_library_stats(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_library_stats(uuid, timestamptz) TO service_role;