ALTER TABLE public.event_sync_jobs
  ADD COLUMN IF NOT EXISTS sync_scope text NOT NULL DEFAULT 'auto';