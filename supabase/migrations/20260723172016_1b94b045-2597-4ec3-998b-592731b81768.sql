-- Multi-calendar support: convert user_luma_keys into a multi-row table
-- with a default flag. Backfill from the existing single-row table.

CREATE TABLE public.user_luma_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  calendar_id text NOT NULL,
  calendar_name text,
  calendar_slug text,
  calendar_avatar_url text,
  calendar_url text,
  api_key_ciphertext text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, calendar_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_luma_calendars TO authenticated;
GRANT ALL ON public.user_luma_calendars TO service_role;

ALTER TABLE public.user_luma_calendars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own calendars"
  ON public.user_luma_calendars FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users insert own calendars"
  ON public.user_luma_calendars FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own calendars"
  ON public.user_luma_calendars FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own calendars"
  ON public.user_luma_calendars FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_user_luma_calendars_updated_at
  BEFORE UPDATE ON public.user_luma_calendars
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Backfill: copy each legacy user_luma_keys row into user_luma_calendars
-- as the user's default calendar. Rows without a resolved calendar_id use
-- a synthetic id so the unique constraint holds.
INSERT INTO public.user_luma_calendars
  (user_id, calendar_id, calendar_name, calendar_slug, calendar_avatar_url,
   calendar_url, api_key_ciphertext, is_default, created_at, updated_at)
SELECT
  user_id,
  COALESCE(NULLIF(calendar_id, ''), 'legacy-' || user_id::text),
  calendar_name,
  calendar_slug,
  calendar_avatar_url,
  calendar_url,
  api_key_ciphertext,
  true,
  created_at,
  updated_at
FROM public.user_luma_keys
ON CONFLICT (user_id, calendar_id) DO NOTHING;