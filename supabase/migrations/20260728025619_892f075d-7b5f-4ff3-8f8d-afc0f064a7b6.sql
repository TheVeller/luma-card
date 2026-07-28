CREATE TABLE IF NOT EXISTS public.canonical_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  canonical_key text NOT NULL,
  luma_event_id text,
  name text NOT NULL,
  url text NOT NULL,
  cover_url text,
  start_at timestamptz,
  end_at timestamptz,
  city text,
  description text,
  host_name text,
  tags text[] NOT NULL DEFAULT '{}',
  suggested_tags text[] NOT NULL DEFAULT '{}',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  identity_fingerprint text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, canonical_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.canonical_events TO authenticated;
GRANT ALL ON public.canonical_events TO service_role;

ALTER TABLE public.canonical_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own canonical events" ON public.canonical_events;
CREATE POLICY "Users read own canonical events"
  ON public.canonical_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users insert own canonical events" ON public.canonical_events;
CREATE POLICY "Users insert own canonical events"
  ON public.canonical_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users update own canonical events" ON public.canonical_events;
CREATE POLICY "Users update own canonical events"
  ON public.canonical_events FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users delete own canonical events" ON public.canonical_events;
CREATE POLICY "Users delete own canonical events"
  ON public.canonical_events FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.event_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  canonical_event_id uuid NOT NULL REFERENCES public.canonical_events(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (
    source_type IN ('api', 'calendar_scrape', 'event_scrape', 'profile_scrape')
  ),
  source_key text NOT NULL,
  calendar_row_id uuid REFERENCES public.user_luma_calendars(id) ON DELETE SET NULL,
  calendar_public_id text,
  calendar_name text,
  source_url text NOT NULL,
  external_event_id text,
  host_name text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_type, source_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_sources TO authenticated;
GRANT ALL ON public.event_sources TO service_role;

ALTER TABLE public.event_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own event sources" ON public.event_sources;
CREATE POLICY "Users read own event sources"
  ON public.event_sources FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users insert own event sources" ON public.event_sources;
CREATE POLICY "Users insert own event sources"
  ON public.event_sources FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users update own event sources" ON public.event_sources;
CREATE POLICY "Users update own event sources"
  ON public.event_sources FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users delete own event sources" ON public.event_sources;
CREATE POLICY "Users delete own event sources"
  ON public.event_sources FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS canonical_events_user_start_idx
  ON public.canonical_events (user_id, start_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS canonical_events_user_identity_idx
  ON public.canonical_events (user_id, identity_fingerprint)
  WHERE identity_fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS canonical_events_user_url_idx
  ON public.canonical_events (user_id, url);
CREATE INDEX IF NOT EXISTS event_sources_user_event_idx
  ON public.event_sources (user_id, canonical_event_id);
CREATE INDEX IF NOT EXISTS event_sources_user_calendar_idx
  ON public.event_sources (user_id, calendar_public_id);

DROP TRIGGER IF EXISTS update_canonical_events_updated_at ON public.canonical_events;
CREATE TRIGGER update_canonical_events_updated_at
  BEFORE UPDATE ON public.canonical_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_event_sources_updated_at ON public.event_sources;
CREATE TRIGGER update_event_sources_updated_at
  BEFORE UPDATE ON public.event_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.finalize_api_calendar_sync(
  p_user_id uuid,
  p_calendar_row_id uuid,
  p_run_started_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed_scrape_sources integer := 0;
  removed_stale_api_sources integer := 0;
  removed_cached_events integer := 0;
  removed_orphans integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_luma_calendars c
    WHERE c.id = p_calendar_row_id
      AND c.user_id = p_user_id
      AND c.merged_into_id IS NULL
      AND (c.source = 'api' OR c.source_kind = 'api')
  ) THEN
    RAISE EXCEPTION 'Active API calendar not found';
  END IF;

  DELETE FROM public.event_sources s
  WHERE s.user_id = p_user_id
    AND s.calendar_row_id = p_calendar_row_id
    AND s.source_type = 'calendar_scrape';
  GET DIAGNOSTICS removed_scrape_sources = ROW_COUNT;

  DELETE FROM public.event_sources s
  WHERE s.user_id = p_user_id
    AND s.calendar_row_id = p_calendar_row_id
    AND s.source_type = 'api'
    AND s.last_synced_at < p_run_started_at;
  GET DIAGNOSTICS removed_stale_api_sources = ROW_COUNT;

  DELETE FROM public.scraped_events e
  WHERE e.user_id = p_user_id AND e.calendar_id = p_calendar_row_id;
  GET DIAGNOSTICS removed_cached_events = ROW_COUNT;

  DELETE FROM public.canonical_events e
  WHERE e.user_id = p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.event_sources s
      WHERE s.canonical_event_id = e.id
    );
  GET DIAGNOSTICS removed_orphans = ROW_COUNT;

  RETURN jsonb_build_object(
    'removedScrapeSources', removed_scrape_sources,
    'removedStaleApiSources', removed_stale_api_sources,
    'removedCachedEvents', removed_cached_events,
    'removedOrphans', removed_orphans
  );
END
$$;

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
  WITH active_calendars AS (
    SELECT id
    FROM public.user_luma_calendars
    WHERE user_id = p_user_id AND merged_into_id IS NULL
  ), calendar_events AS (
    SELECT DISTINCT source.calendar_row_id, source.canonical_event_id
    FROM public.event_sources source
    JOIN active_calendars calendar ON calendar.id = source.calendar_row_id
    WHERE source.user_id = p_user_id
  ), per_calendar AS (
    SELECT
      calendar.id AS calendar_row_id,
      count(event.id)::integer AS total,
      count(event.id) FILTER (
        WHERE event.start_at > p_at
          OR (event.start_at <= p_at AND event.end_at > p_at)
      )::integer AS upcoming,
      count(event.id) FILTER (
        WHERE event.start_at <= p_at
          AND (event.end_at IS NULL OR event.end_at <= p_at)
      )::integer AS past,
      count(event.id) FILTER (WHERE event.start_at IS NULL)::integer AS unknown
    FROM active_calendars calendar
    LEFT JOIN calendar_events sighting ON sighting.calendar_row_id = calendar.id
    LEFT JOIN public.canonical_events event ON event.id = sighting.canonical_event_id
    GROUP BY calendar.id
  ), global_events AS (
    SELECT DISTINCT event.*
    FROM public.canonical_events event
    JOIN calendar_events sighting ON sighting.canonical_event_id = event.id
    WHERE event.user_id = p_user_id
  ), global_stats AS (
    SELECT
      count(*)::integer AS total,
      count(*) FILTER (
        WHERE start_at > p_at OR (start_at <= p_at AND end_at > p_at)
      )::integer AS upcoming,
      count(*) FILTER (
        WHERE start_at <= p_at AND (end_at IS NULL OR end_at <= p_at)
      )::integer AS past,
      count(*) FILTER (WHERE start_at IS NULL)::integer AS unknown
    FROM global_events
  )
  SELECT jsonb_build_object(
    'generatedAt', p_at,
    'total', COALESCE(global_stats.total, 0),
    'upcoming', COALESCE(global_stats.upcoming, 0),
    'past', COALESCE(global_stats.past, 0),
    'unknown', COALESCE(global_stats.unknown, 0),
    'calendars', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'calendarRowId', calendar_row_id,
            'total', total,
            'upcoming', upcoming,
            'past', past,
            'unknown', unknown
          )
          ORDER BY calendar_row_id
        )
        FROM per_calendar
      ),
      '[]'::jsonb
    )
  )
  FROM global_stats
$$;

CREATE OR REPLACE FUNCTION public.cleanup_merged_calendar_rows(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.user_luma_calendars c
  WHERE c.user_id = p_user_id
    AND c.merged_into_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.event_sync_jobs j
      WHERE j.source_id = c.id AND j.status IN ('queued', 'running')
    );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END
$$;

CREATE OR REPLACE VIEW public.calendar_canonicalization_report
WITH (security_invoker = true) AS
SELECT
  c.user_id,
  count(*) FILTER (WHERE c.merged_into_id IS NULL) AS active_calendars,
  (SELECT count(*) FROM public.calendar_merge_audit m WHERE m.user_id = c.user_id)
    AS merged_calendars,
  count(*) FILTER (
    WHERE c.merged_into_id IS NULL
      AND c.source_kind = 'calendar'
      AND c.luma_calendar_id IS NULL
  ) AS unresolved_calendars,
  (SELECT count(*) FROM public.user_calendar_aliases a WHERE a.user_id = c.user_id)
    AS aliases_created,
  (SELECT COALESCE(sum(m.events_moved), 0)
   FROM public.calendar_merge_audit m WHERE m.user_id = c.user_id) AS events_moved,
  (SELECT COALESCE(sum(m.sources_moved), 0)
   FROM public.calendar_merge_audit m WHERE m.user_id = c.user_id) AS sources_moved
FROM public.user_luma_calendars c
GROUP BY c.user_id;

GRANT SELECT ON public.calendar_canonicalization_report TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.add_calendar_alias(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_calendar_rows(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_luma_calendar_identity(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_user_calendar_row_id(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_merged_calendar_rows(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_api_calendar_sync(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_event_library_stats(uuid, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.resolve_user_calendar_row_id(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_luma_calendar_identity(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_calendar_alias(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_calendar_rows(uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_merged_calendar_rows(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_api_calendar_sync(uuid, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_event_library_stats(uuid, timestamptz) TO service_role;