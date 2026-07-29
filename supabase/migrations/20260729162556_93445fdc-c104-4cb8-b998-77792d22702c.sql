ALTER TABLE public.event_sources DROP CONSTRAINT IF EXISTS event_sources_source_type_check;
ALTER TABLE public.event_sources ADD CONSTRAINT event_sources_source_type_check CHECK (
  source_type = ANY (ARRAY[
    'api'::text,
    'calendar_scrape'::text,
    'event_scrape'::text,
    'profile_scrape'::text,
    'meetup_api'::text,
    'meetup_public'::text,
    'eventbrite_api'::text,
    'eventbrite_public'::text
  ])
);

-- Requeue the sources that failed only because of the old constraint.
UPDATE public.user_luma_calendars
SET sync_status = 'queued', sync_error = NULL, next_sync_at = now(), updated_at = now()
WHERE sync_status = 'failed'
  AND sync_error LIKE '%event_sources_source_type_check%';