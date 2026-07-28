ALTER TABLE public.user_luma_calendars
  ADD COLUMN IF NOT EXISTS luma_calendar_id text,
  ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES public.user_luma_calendars(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS user_luma_calendars_luma_calendar_id_idx
  ON public.user_luma_calendars(user_id, luma_calendar_id);