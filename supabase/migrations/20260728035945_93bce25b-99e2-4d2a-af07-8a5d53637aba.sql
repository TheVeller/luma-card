ALTER TABLE public.user_luma_calendars
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'luma',
  ADD COLUMN IF NOT EXISTS provider_source_id text,
  ADD COLUMN IF NOT EXISTS provider_connection_id text,
  ADD COLUMN IF NOT EXISTS ownership text NOT NULL DEFAULT 'connected',
  ADD COLUMN IF NOT EXISTS sync_all_events boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS brand_kit_id uuid;

ALTER TABLE public.user_luma_calendars
  ADD CONSTRAINT user_luma_calendars_provider_check
  CHECK (provider IN ('luma', 'eventbrite', 'meetup')) NOT VALID;

ALTER TABLE public.user_luma_calendars
  ADD CONSTRAINT user_luma_calendars_ownership_check
  CHECK (ownership IN ('connected', 'external')) NOT VALID;

ALTER TABLE public.user_luma_calendars
  VALIDATE CONSTRAINT user_luma_calendars_provider_check;

ALTER TABLE public.user_luma_calendars
  VALIDATE CONSTRAINT user_luma_calendars_ownership_check;

CREATE INDEX IF NOT EXISTS user_luma_calendars_provider_idx
  ON public.user_luma_calendars(user_id, provider, provider_source_id)
  WHERE merged_into_id IS NULL;

NOTIFY pgrst, 'reload schema';