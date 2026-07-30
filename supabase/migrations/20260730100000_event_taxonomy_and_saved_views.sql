-- Controlled event taxonomy, durable user edits, and saved Events views.
CREATE TABLE IF NOT EXISTS public.event_tag_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace text NOT NULL CHECK (namespace IN ('format', 'topic', 'audience')),
  slug text NOT NULL,
  label text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  taxonomy_version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (namespace, slug, taxonomy_version)
);

CREATE TABLE IF NOT EXISTS public.canonical_event_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  canonical_event_id uuid NOT NULL REFERENCES public.canonical_events(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.event_tag_definitions(id) ON DELETE CASCADE,
  origin text NOT NULL CHECK (origin IN ('system', 'manual')),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'dismissed')),
  confidence numeric(5,4),
  classifier_version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, canonical_event_id, tag_id)
);

CREATE INDEX IF NOT EXISTS canonical_event_tags_user_event_idx
  ON public.canonical_event_tags (user_id, canonical_event_id, state);
CREATE INDEX IF NOT EXISTS canonical_event_tags_user_tag_idx
  ON public.canonical_event_tags (user_id, tag_id, state);

CREATE TABLE IF NOT EXISTS public.saved_event_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_mode text NOT NULL DEFAULT 'upcoming',
  view_mode text NOT NULL DEFAULT 'gallery',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

ALTER TABLE public.event_tag_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_event_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_event_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Everyone can read active event tag definitions" ON public.event_tag_definitions;
CREATE POLICY "Everyone can read active event tag definitions"
  ON public.event_tag_definitions FOR SELECT TO authenticated USING (active = true);

DROP POLICY IF EXISTS "Users manage own event tags" ON public.canonical_event_tags;
CREATE POLICY "Users manage own event tags"
  ON public.canonical_event_tags FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own saved event views" ON public.saved_event_views;
CREATE POLICY "Users manage own saved event views"
  ON public.saved_event_views FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

GRANT SELECT ON public.event_tag_definitions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.canonical_event_tags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_event_views TO authenticated;
GRANT ALL ON public.event_tag_definitions, public.canonical_event_tags, public.saved_event_views TO service_role;

DROP TRIGGER IF EXISTS update_canonical_event_tags_updated_at ON public.canonical_event_tags;
CREATE TRIGGER update_canonical_event_tags_updated_at
  BEFORE UPDATE ON public.canonical_event_tags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_saved_event_views_updated_at ON public.saved_event_views;
CREATE TRIGGER update_saved_event_views_updated_at
  BEFORE UPDATE ON public.saved_event_views
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.event_tag_definitions (namespace, slug, label, aliases) VALUES
  ('format', 'talk', 'Talk', ARRAY['lecture', 'keynote']),
  ('format', 'workshop', 'Workshop', ARRAY['hands-on', 'training']),
  ('format', 'conference', 'Conference', ARRAY['summit']),
  ('format', 'meetup', 'Meetup', ARRAY['community meetup']),
  ('format', 'networking', 'Networking', ARRAY['networking event']),
  ('format', 'hackathon', 'Hackathon', ARRAY['hack day']),
  ('format', 'webinar', 'Webinar', ARRAY['online event']),
  ('format', 'course', 'Course', ARRAY['class', 'bootcamp']),
  ('format', 'panel', 'Panel', ARRAY['panel discussion']),
  ('format', 'demo', 'Demo', ARRAY['demo day']),
  ('format', 'social', 'Social', ARRAY['party']),
  ('format', 'other', 'Other', ARRAY[]::text[]),
  ('topic', 'ai', 'AI', ARRAY['artificial intelligence', 'machine learning', 'ml']),
  ('topic', 'startups', 'Startups', ARRAY['startup', 'founders']),
  ('topic', 'entrepreneurship', 'Entrepreneurship', ARRAY['business']),
  ('topic', 'technology', 'Technology', ARRAY['tech']),
  ('topic', 'software', 'Software', ARRAY['engineering', 'developer']),
  ('topic', 'design', 'Design', ARRAY['ux', 'ui']),
  ('topic', 'product', 'Product', ARRAY['product management']),
  ('topic', 'marketing', 'Marketing', ARRAY['growth']),
  ('topic', 'finance', 'Finance', ARRAY['investing']),
  ('topic', 'careers', 'Careers', ARRAY['jobs', 'employment']),
  ('topic', 'education', 'Education', ARRAY['learning']),
  ('topic', 'climate', 'Climate', ARRAY['sustainability']),
  ('topic', 'community', 'Community', ARRAY['social impact']),
  ('topic', 'other', 'Other', ARRAY[]::text[]),
  ('audience', 'founders', 'Founders', ARRAY['entrepreneurs']),
  ('audience', 'developers', 'Developers', ARRAY['engineers', 'programmers']),
  ('audience', 'designers', 'Designers', ARRAY['ux designers']),
  ('audience', 'marketers', 'Marketers', ARRAY['marketing professionals']),
  ('audience', 'students', 'Students', ARRAY['learners']),
  ('audience', 'investors', 'Investors', ARRAY['venture capital']),
  ('audience', 'operators', 'Operators', ARRAY['business operators']),
  ('audience', 'creators', 'Creators', ARRAY['content creators']),
  ('audience', 'general', 'General', ARRAY['everyone', 'all welcome']),
  ('audience', 'other', 'Other', ARRAY[]::text[])
ON CONFLICT (namespace, slug, taxonomy_version) DO UPDATE
SET label = EXCLUDED.label, aliases = EXCLUDED.aliases, active = true;
