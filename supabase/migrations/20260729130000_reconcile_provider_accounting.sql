-- Reconcile persisted source counts and request a complete historical pass for
-- Meetup groups whose previous public sync was bounded or partial.
UPDATE public.user_luma_calendars
SET imported_count = 0,
    updated_at = now();

UPDATE public.user_luma_calendars AS calendar
SET imported_count = counts.imported_count,
    updated_at = now()
FROM (
  SELECT calendar_row_id, count(DISTINCT canonical_event_id)::integer AS imported_count
  FROM public.event_sources
  WHERE calendar_row_id IS NOT NULL
  GROUP BY calendar_row_id
) counts
WHERE calendar.id = counts.calendar_row_id;

UPDATE public.user_luma_calendars
SET sync_all_events = true,
    sync_status = 'queued',
    sync_error = NULL,
    next_sync_at = now(),
    source_metadata = COALESCE(source_metadata, '{}'::jsonb) ||
      jsonb_build_object('historicalReconcileRequestedAt', now()),
    updated_at = now()
WHERE provider = 'meetup'
  AND merged_into_id IS NULL
  AND (
    historical_sync_completed_at IS NULL
    OR COALESCE((source_metadata->>'truncated')::boolean, false)
    OR sync_status IN ('partial', 'failed')
  );

INSERT INTO public.event_sync_jobs(user_id, source_id, trigger, status, sync_scope, scheduled_at)
SELECT user_id, id, 'manual', 'queued', 'full', now()
FROM public.user_luma_calendars calendar
WHERE calendar.provider = 'meetup'
  AND calendar.merged_into_id IS NULL
  AND calendar.sync_status = 'queued'
  AND NOT EXISTS (
    SELECT 1
    FROM public.event_sync_jobs active
    WHERE active.source_id = calendar.id
      AND active.status IN ('queued', 'running')
  );

CREATE OR REPLACE VIEW public.calendar_source_accounting AS
SELECT
  calendar.user_id,
  calendar.id AS calendar_row_id,
  calendar.provider,
  calendar.provider_source_id,
  COALESCE(calendar.curated_name, calendar.calendar_name) AS source_name,
  calendar.sync_status,
  calendar.discovered_count,
  calendar.imported_count,
  COALESCE((calendar.source_metadata->>'readableCount')::integer, calendar.imported_count, 0)
    AS readable_count,
  COALESCE((calendar.source_metadata->>'cancelledCount')::integer, 0) AS cancelled_count,
  COALESCE((calendar.source_metadata->>'unreadableCount')::integer, 0) AS unreadable_count,
  count(DISTINCT event_source.canonical_event_id)::integer AS persisted_event_count,
  calendar.historical_sync_completed_at,
  calendar.merged_into_id
FROM public.user_luma_calendars calendar
LEFT JOIN public.event_sources event_source
  ON event_source.calendar_row_id = calendar.id
 AND event_source.user_id = calendar.user_id
WHERE calendar.merged_into_id IS NULL
GROUP BY calendar.id;

GRANT SELECT ON public.calendar_source_accounting TO authenticated, service_role;
