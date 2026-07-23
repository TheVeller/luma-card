
-- User-scoped Luma API keys (encrypted at rest)
CREATE TABLE public.user_luma_keys (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key_ciphertext text NOT NULL,
  calendar_id text,
  calendar_name text,
  calendar_slug text,
  calendar_avatar_url text,
  calendar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_luma_keys TO authenticated;
GRANT ALL ON public.user_luma_keys TO service_role;

ALTER TABLE public.user_luma_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own luma key row"
  ON public.user_luma_keys FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own luma key row"
  ON public.user_luma_keys FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own luma key row"
  ON public.user_luma_keys FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own luma key row"
  ON public.user_luma_keys FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_user_luma_keys_updated_at
  BEFORE UPDATE ON public.user_luma_keys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Badges: attach optional creator user_id
ALTER TABLE public.badges
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS badges_event_id_idx ON public.badges (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS badges_user_id_idx ON public.badges (user_id);
