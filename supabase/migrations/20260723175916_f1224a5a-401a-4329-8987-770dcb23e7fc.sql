
-- Allow scraped calendars (no API key)
ALTER TABLE public.user_luma_calendars ALTER COLUMN api_key_ciphertext DROP NOT NULL;
ALTER TABLE public.user_luma_calendars ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'api';
ALTER TABLE public.user_luma_calendars
  ADD CONSTRAINT user_luma_calendars_source_check
  CHECK (
    (source = 'api' AND api_key_ciphertext IS NOT NULL)
    OR (source = 'scrape')
  );

-- Cache of scraped events (Luma or other public URLs)
CREATE TABLE public.scraped_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  calendar_id uuid REFERENCES public.user_luma_calendars(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  source_url text NOT NULL,
  name text NOT NULL,
  description text,
  cover_url text,
  city text,
  start_at timestamptz,
  end_at timestamptz,
  host_name text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scraped_events TO authenticated;
GRANT ALL ON public.scraped_events TO service_role;

ALTER TABLE public.scraped_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own scraped events"
  ON public.scraped_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users insert own scraped events"
  ON public.scraped_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own scraped events"
  ON public.scraped_events FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own scraped events"
  ON public.scraped_events FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_scraped_events_updated_at
  BEFORE UPDATE ON public.scraped_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX scraped_events_user_cal_idx ON public.scraped_events (user_id, calendar_id, start_at DESC);
