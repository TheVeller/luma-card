-- 1) DELETE policy on badges (owner only)
CREATE POLICY "Users delete own badges"
  ON public.badges
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 2) Storage: allow owners to delete their own objects in the 'badges' bucket
CREATE POLICY "Owners delete own badge objects"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'badges'
    AND EXISTS (
      SELECT 1 FROM public.badges b
      WHERE b.image_path = storage.objects.name
        AND b.user_id = auth.uid()
    )
  );

-- 3) Templates: reusable badge style presets
CREATE TABLE public.templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  style_spec jsonb NOT NULL,
  preview_path text,
  source_url text,
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.templates TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.templates TO authenticated;
GRANT ALL ON public.templates TO service_role;

ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;

-- Read: system templates readable by everyone; user's own also readable
CREATE POLICY "Read system or own templates"
  ON public.templates
  FOR SELECT
  TO anon, authenticated
  USING (is_system = true OR auth.uid() = created_by);

-- Insert/update/delete: only your own, non-system rows
CREATE POLICY "Users insert own templates"
  ON public.templates
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by AND is_system = false);

CREATE POLICY "Users update own templates"
  ON public.templates
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by AND is_system = false)
  WITH CHECK (auth.uid() = created_by AND is_system = false);

CREATE POLICY "Users delete own templates"
  ON public.templates
  FOR DELETE
  TO authenticated
  USING (auth.uid() = created_by AND is_system = false);

CREATE TRIGGER update_templates_updated_at
  BEFORE UPDATE ON public.templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Seed 6 system templates (previews uploaded from app on first admin visit)
INSERT INTO public.templates (slug, name, description, style_spec, preview_path, source_url, is_system) VALUES
('era1-code-brew',
 'Code Brew — Original',
 'Warm cream editorial with red kicker. Original Code Brew Bogotá era.',
 '{"style":"warm-paper","palette":{"bg":"#efeadd","surface":"#e6dfcc","accent":"#e33d3d","text":"#141311","textMuted":"#7a7264"},"fonts":{"heading":"Space Grotesk","body":"IBM Plex Mono"},"mood":"cream paper editorial"}'::jsonb,
 'templates/era1-code-brew.png',
 'https://github.com/crafter-station/event-badge-history',
 true),
('era2-v0-zero-to-agents',
 'v0 · Zero to Agent',
 'Dark tech mode with cool cyan accent — v0 Zero-to-Agent era.',
 '{"style":"dark-mode-tech","palette":{"bg":"#0a0a0a","surface":"#141414","accent":"#4ec7ff","text":"#f5f5f0","textMuted":"#8a8a86"},"fonts":{"heading":"Sora","body":"JetBrains Mono"},"mood":"dark tech neon"}'::jsonb,
 'templates/era2-v0-zero-to-agents.png',
 'https://github.com/crafter-station/event-badge-history',
 true),
('era3-gtm-hackathon',
 'The GTM Hackathon',
 'Bold punk red on cream — GTM Hackathon era.',
 '{"style":"bold-punk","palette":{"bg":"#f2ecdd","surface":"#e8dfc8","accent":"#f03d44","text":"#111111","textMuted":"#6f6857"},"fonts":{"heading":"Archivo Black","body":"Space Mono"},"mood":"bold punk hackathon"}'::jsonb,
 'templates/era3-gtm-hackathon.png',
 'https://github.com/crafter-station/event-badge-history',
 true),
('era4-cursor-meetup',
 'Cursor Meetup',
 'Industrial mono grayscale — Cursor Meetup era.',
 '{"style":"industrial-mono","palette":{"bg":"#e9e6de","surface":"#dedbd1","accent":"#151515","text":"#111111","textMuted":"#6a6660"},"fonts":{"heading":"IBM Plex Mono","body":"IBM Plex Mono"},"mood":"industrial mono meetup"}'::jsonb,
 'templates/era4-cursor-meetup.png',
 'https://github.com/crafter-station/event-badge-history',
 true),
('era5-cursor-buildathon-sv',
 'Cursor Buildathon SV',
 'Terminal mono cream — Cursor Buildathon El Salvador era.',
 '{"style":"mono-terminal","palette":{"bg":"#f5f1e4","surface":"#ebe6d5","accent":"#111111","text":"#111111","textMuted":"#5d5a55"},"fonts":{"heading":"Space Mono","body":"IBM Plex Mono"},"mood":"terminal mono buildathon"}'::jsonb,
 'templates/era5-cursor-buildathon-sv.png',
 'https://github.com/crafter-station/event-badge-history',
 true),
('era6-codebrew-sv',
 'Code Brew SV',
 'Editorial serif cream — Code Brew El Salvador era.',
 '{"style":"editorial-serif","palette":{"bg":"#f1ecdd","surface":"#e6dfcb","accent":"#a5522f","text":"#141210","textMuted":"#736c5b"},"fonts":{"heading":"Instrument Serif","body":"Inter"},"mood":"editorial serif warm"}'::jsonb,
 'templates/era6-codebrew-sv.png',
 'https://github.com/crafter-station/event-badge-history',
 true);
