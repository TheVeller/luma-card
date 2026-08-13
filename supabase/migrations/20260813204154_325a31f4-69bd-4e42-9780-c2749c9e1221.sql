CREATE TABLE IF NOT EXISTS public.saved_event_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_mode text NOT NULL DEFAULT 'upcoming',
  view_mode text NOT NULL DEFAULT 'gallery',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_event_views TO authenticated;
GRANT ALL ON public.saved_event_views TO service_role;

ALTER TABLE public.saved_event_views ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'saved_event_views'
      AND policyname = 'Users manage their own saved views'
  ) THEN
    CREATE POLICY "Users manage their own saved views"
      ON public.saved_event_views FOR ALL TO authenticated
      USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS update_saved_event_views_updated_at ON public.saved_event_views;
CREATE TRIGGER update_saved_event_views_updated_at
  BEFORE UPDATE ON public.saved_event_views
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS saved_event_views_user_idx
  ON public.saved_event_views (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS event_sources_user_calendar_idx
  ON public.event_sources (user_id, calendar_row_id);
CREATE INDEX IF NOT EXISTS event_sources_user_canonical_idx
  ON public.event_sources (user_id, canonical_event_id);
CREATE INDEX IF NOT EXISTS canonical_events_user_start_idx
  ON public.canonical_events (user_id, start_at DESC);
CREATE INDEX IF NOT EXISTS canonical_events_city_idx
  ON public.canonical_events (user_id, lower(city));
CREATE INDEX IF NOT EXISTS canonical_events_country_idx
  ON public.canonical_events (user_id, country_code);
CREATE INDEX IF NOT EXISTS canonical_events_format_idx
  ON public.canonical_events (user_id, event_format);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS canonical_events_name_trgm_idx
  ON public.canonical_events USING gin (name gin_trgm_ops);