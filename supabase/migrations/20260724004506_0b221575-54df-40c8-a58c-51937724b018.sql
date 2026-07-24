CREATE TABLE public.event_style_presets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  label TEXT,
  style_spec JSONB NOT NULL,
  spec_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_id, spec_hash)
);

CREATE INDEX event_style_presets_user_event_idx
  ON public.event_style_presets (user_id, event_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_style_presets TO authenticated;
GRANT ALL ON public.event_style_presets TO service_role;

ALTER TABLE public.event_style_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own event style presets"
  ON public.event_style_presets
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);