
CREATE TABLE public.badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL,
  first_name text NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 40),
  role text CHECK (role IS NULL OR char_length(role) <= 80),
  image_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX badges_event_created_idx ON public.badges (event_id, created_at DESC);

GRANT SELECT, INSERT ON public.badges TO anon, authenticated;
GRANT ALL ON public.badges TO service_role;

ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read badges" ON public.badges
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Anyone can insert badges" ON public.badges
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    char_length(event_id) BETWEEN 1 AND 100
    AND char_length(first_name) BETWEEN 1 AND 40
    AND (role IS NULL OR char_length(role) <= 80)
  );

-- Storage policies on the "badges" bucket
CREATE POLICY "Public read badge files" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'badges');

CREATE POLICY "Anyone can upload badge files" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'badges');
