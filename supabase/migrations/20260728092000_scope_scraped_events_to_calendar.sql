-- The same Luma event can be published in multiple calendars. Preserve each
-- calendar sighting instead of moving the cached row between calendars.
ALTER TABLE public.scraped_events
  DROP CONSTRAINT IF EXISTS scraped_events_user_id_event_key_key;

ALTER TABLE public.scraped_events
  ADD CONSTRAINT scraped_events_user_calendar_event_key
  UNIQUE (user_id, calendar_id, event_key);

CREATE INDEX IF NOT EXISTS scraped_events_user_event_idx
  ON public.scraped_events (user_id, event_key);
