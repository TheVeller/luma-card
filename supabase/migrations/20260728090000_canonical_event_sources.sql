-- Canonical event library: one user-scoped event with many source sightings.
-- Existing scraped_events/user_luma_calendars remain in place; this is an
-- additive model for dedupe, API routing, and future virtual calendars.

CREATE TABLE public.canonical_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  canonical_key text NOT NULL,
  luma_event_id text,
  name text NOT NULL,
  url text NOT NULL,
  cover_url text,
  start_at timestamptz,
  end_at timestamptz,
  city text,
  description text,
  host_name text,
  tags text[] NOT NULL DEFAULT '{}',
  suggested_tags text[] NOT NULL DEFAULT '{}',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, canonical_key)
);

CREATE TABLE public.event_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  canonical_event_id uuid NOT NULL REFERENCES public.canonical_events(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (
    source_type IN ('api', 'calendar_scrape', 'event_scrape', 'profile_scrape')
  ),
  source_key text NOT NULL,
  calendar_row_id uuid REFERENCES public.user_luma_calendars(id) ON DELETE SET NULL,
  calendar_public_id text,
  calendar_name text,
  source_url text NOT NULL,
  external_event_id text,
  host_name text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_type, source_key)
);

CREATE INDEX canonical_events_user_start_idx
  ON public.canonical_events (user_id, start_at DESC NULLS LAST);
CREATE INDEX event_sources_user_event_idx
  ON public.event_sources (user_id, canonical_event_id);
CREATE INDEX event_sources_user_calendar_idx
  ON public.event_sources (user_id, calendar_public_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.canonical_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_sources TO authenticated;
GRANT ALL ON public.canonical_events TO service_role;
GRANT ALL ON public.event_sources TO service_role;

ALTER TABLE public.canonical_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own canonical events"
  ON public.canonical_events FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users insert own canonical events"
  ON public.canonical_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own canonical events"
  ON public.canonical_events FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own canonical events"
  ON public.canonical_events FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users read own event sources"
  ON public.event_sources FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users insert own event sources"
  ON public.event_sources FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own event sources"
  ON public.event_sources FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own event sources"
  ON public.event_sources FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_canonical_events_updated_at
  BEFORE UPDATE ON public.canonical_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_event_sources_updated_at
  BEFORE UPDATE ON public.event_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
