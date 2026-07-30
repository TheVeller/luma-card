-- 1. Enrichment fields, change feed, token scopes (previously unapplied)
ALTER TABLE public.api_tokens
  ADD COLUMN IF NOT EXISTS scopes text[] NOT NULL DEFAULT ARRAY['events:read','calendars:read','changes:read'],
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

ALTER TABLE public.canonical_events
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS language_code text,
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS venue_name text,
  ADD COLUMN IF NOT EXISTS venue_address text,
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS is_online boolean,
  ADD COLUMN IF NOT EXISTS event_format text,
  ADD COLUMN IF NOT EXISTS topics text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS audience text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS level text,
  ADD COLUMN IF NOT EXISTS enrichment jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS enrichment_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS enriched_at timestamptz;

CREATE INDEX IF NOT EXISTS canonical_events_user_topics_idx
  ON public.canonical_events USING gin (topics);
CREATE INDEX IF NOT EXISTS canonical_events_user_tags_idx
  ON public.canonical_events USING gin (tags);

CREATE TABLE IF NOT EXISTS public.event_change_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  canonical_event_id uuid,
  operation text NOT NULL CHECK (operation IN ('upsert', 'delete')),
  event_snapshot jsonb,
  changed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.event_change_log TO authenticated;
GRANT ALL ON public.event_change_log TO service_role;

ALTER TABLE public.event_change_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own event changes" ON public.event_change_log;
CREATE POLICY "Users read own event changes"
  ON public.event_change_log FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS event_change_log_user_cursor_idx
  ON public.event_change_log (user_id, id);
CREATE INDEX IF NOT EXISTS event_change_log_user_changed_idx
  ON public.event_change_log (user_id, changed_at);

CREATE OR REPLACE FUNCTION public.log_canonical_event_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.event_change_log(user_id, canonical_event_id, operation, event_snapshot)
    VALUES (OLD.user_id, OLD.id, 'delete', NULL);
    RETURN OLD;
  END IF;
  INSERT INTO public.event_change_log(user_id, canonical_event_id, operation, event_snapshot)
  VALUES (NEW.user_id, NEW.id, 'upsert', to_jsonb(NEW));
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS canonical_event_change_log_trg ON public.canonical_events;
CREATE TRIGGER canonical_event_change_log_trg
AFTER INSERT OR UPDATE OR DELETE ON public.canonical_events
FOR EACH ROW EXECUTE FUNCTION public.log_canonical_event_change();

REVOKE ALL ON FUNCTION public.log_canonical_event_change() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_canonical_event_change() TO service_role;

-- 2. Single source of truth for library + event accounting
CREATE OR REPLACE FUNCTION public.get_event_library_stats(
  p_user_id uuid,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH all_calendars AS (
    SELECT
      c.id,
      c.merged_into_id,
      COALESCE(c.provider, 'luma') AS provider,
      COALESCE(c.ownership, 'external') AS ownership,
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
      'lumaConnected', (SELECT count(*) FROM deduped WHERE provider = 'luma' AND ownership = 'connected')::int,
      'lumaExternal', (SELECT count(*) FROM deduped WHERE provider = 'luma' AND ownership <> 'connected')::int,
      'meetupExternal', (SELECT count(*) FROM deduped WHERE provider = 'meetup')::int,
      'otherProviders', (SELECT count(*) FROM deduped WHERE provider NOT IN ('luma','meetup'))::int,
      'mergedHidden', (SELECT count(*) FROM all_calendars WHERE merged_into_id IS NOT NULL)::int,
      'erroredSources', (SELECT count(*) FROM active WHERE sync_status IN ('failed','inaccessible'))::int
    ) AS value
  ), sightings AS (
    SELECT DISTINCT s.calendar_row_id, s.canonical_event_id, a.provider
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
  )
  SELECT jsonb_build_object(
    'generatedAt', p_at,
    'total', COALESCE(g.total, 0),
    'upcoming', COALESCE(g.upcoming, 0),
    'past', COALESCE(g.past, 0),
    'unknown', COALESCE(g.unknown, 0),
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
$$;

CREATE OR REPLACE FUNCTION public.get_my_event_library_stats(
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_event_library_stats(auth.uid(), p_at)
  WHERE auth.uid() IS NOT NULL
$$;

REVOKE ALL ON FUNCTION public.get_my_event_library_stats(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_event_library_stats(timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_event_library_stats(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_library_stats(uuid, timestamptz) TO service_role;

-- 3. Sync job history retention
DELETE FROM public.event_sync_jobs
WHERE status = 'failed' AND finished_at < now() - interval '7 days';