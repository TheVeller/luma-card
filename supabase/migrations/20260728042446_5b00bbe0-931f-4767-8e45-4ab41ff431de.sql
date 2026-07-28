ALTER TABLE public.user_luma_calendars
  ADD COLUMN IF NOT EXISTS last_sync_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS historical_sync_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_scope text;