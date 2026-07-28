
ALTER TABLE public.user_luma_calendars
  ADD COLUMN IF NOT EXISTS curated_name text,
  ADD COLUMN IF NOT EXISTS remote_name text,
  ADD COLUMN IF NOT EXISTS source_kind text,
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS sync_error text,
  ADD COLUMN IF NOT EXISTS sync_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS event_limit integer NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS discovered_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS imported_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_metadata jsonb,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_sync_at timestamptz;

CREATE TABLE IF NOT EXISTS public.event_sync_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES public.user_luma_calendars(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  trigger text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempt integer NOT NULL DEFAULT 0,
  discovered_count integer,
  imported_count integer,
  error text,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS event_sync_jobs_queued_unique
  ON public.event_sync_jobs (source_id)
  WHERE status = 'queued';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_sync_jobs TO authenticated;
GRANT ALL ON public.event_sync_jobs TO service_role;

ALTER TABLE public.event_sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own sync jobs" ON public.event_sync_jobs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS scraped_events_user_calendar_event_key
  ON public.scraped_events (user_id, calendar_id, event_key);
