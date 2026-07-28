ALTER TABLE public.user_luma_calendars
  ADD COLUMN IF NOT EXISTS curated_name text,
  ADD COLUMN IF NOT EXISTS remote_name text,
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'calendar',
  ADD COLUMN IF NOT EXISTS sync_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS event_limit integer NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS sync_error text,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS discovered_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS imported_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.user_luma_calendars
SET source_kind = 'api'
WHERE source = 'api';

ALTER TABLE public.user_luma_calendars
  ADD CONSTRAINT user_luma_calendars_source_kind_check
  CHECK (source_kind IN ('api', 'calendar', 'profile', 'event'));

ALTER TABLE public.user_luma_calendars
  ADD CONSTRAINT user_luma_calendars_sync_status_check
  CHECK (sync_status IN ('idle', 'queued', 'running', 'completed', 'partial', 'failed', 'inaccessible'));

CREATE TABLE public.event_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.user_luma_calendars(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL DEFAULT gen_random_uuid(),
  trigger text NOT NULL CHECK (trigger IN ('initial', 'manual', 'scheduled')),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed')),
  attempt integer NOT NULL DEFAULT 0,
  discovered_count integer NOT NULL DEFAULT 0,
  imported_count integer NOT NULL DEFAULT 0,
  error text,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX event_sync_jobs_one_active_source_idx
  ON public.event_sync_jobs (source_id)
  WHERE status IN ('queued', 'running');
CREATE INDEX event_sync_jobs_queue_idx
  ON public.event_sync_jobs (status, scheduled_at, created_at);
CREATE INDEX event_sync_jobs_user_batch_idx
  ON public.event_sync_jobs (user_id, batch_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_sync_jobs TO authenticated;
GRANT ALL ON public.event_sync_jobs TO service_role;
ALTER TABLE public.event_sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own sync jobs"
  ON public.event_sync_jobs FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users insert own sync jobs"
  ON public.event_sync_jobs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own sync jobs"
  ON public.event_sync_jobs FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own sync jobs"
  ON public.event_sync_jobs FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_event_sync_jobs_updated_at
  BEFORE UPDATE ON public.event_sync_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
