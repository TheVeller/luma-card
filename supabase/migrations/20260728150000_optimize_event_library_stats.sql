-- Faster event counters, deployed separately because the initial canonical
-- identity migration may already have run in Lovable/Supabase.

CREATE INDEX IF NOT EXISTS event_sources_user_calendar_canonical_idx
  ON public.event_sources (user_id, calendar_row_id, canonical_event_id)
  WHERE calendar_row_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS canonical_events_user_temporal_idx
  ON public.canonical_events (user_id, start_at, end_at);

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
  ), calendar_events AS MATERIALIZED (
    SELECT DISTINCT source.calendar_row_id, source.canonical_event_id
    FROM public.event_sources source
    JOIN active_calendars calendar ON calendar.id = source.calendar_row_id
    WHERE source.user_id = p_user_id
  ), event_times AS MATERIALIZED (
    SELECT event.id, event.start_at, event.end_at
    FROM public.canonical_events event
    WHERE event.user_id = p_user_id
      AND EXISTS (
        SELECT 1
        FROM calendar_events sighting
        WHERE sighting.canonical_event_id = event.id
      )
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
    LEFT JOIN event_times event ON event.id = sighting.canonical_event_id
    GROUP BY calendar.id
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
    FROM event_times
  )
  SELECT jsonb_build_object(
    'generatedAt', p_at,
    'total', global_stats.total,
    'upcoming', global_stats.upcoming,
    'past', global_stats.past,
    'unknown', global_stats.unknown,
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

REVOKE ALL ON FUNCTION public.get_event_library_stats(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_library_stats(uuid, timestamptz)
  TO service_role;
