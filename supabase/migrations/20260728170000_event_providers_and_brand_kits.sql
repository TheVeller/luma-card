-- Provider-neutral event sources and branding defaults. Existing Luma columns
-- remain for backwards compatibility with the published router API.

CREATE TABLE IF NOT EXISTS public.provider_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('eventbrite', 'meetup')),
  display_name text NOT NULL,
  access_token_ciphertext text NOT NULL,
  refresh_token_ciphertext text,
  token_expires_at timestamptz,
  external_account_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, external_account_id)
);

CREATE TABLE IF NOT EXISTS public.brand_kits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  style_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  badge_doc jsonb,
  logos jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

ALTER TABLE public.user_luma_calendars
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'luma',
  ADD COLUMN IF NOT EXISTS provider_source_id text,
  ADD COLUMN IF NOT EXISTS provider_connection_id uuid
    REFERENCES public.provider_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ownership text NOT NULL DEFAULT 'external',
  ADD COLUMN IF NOT EXISTS sync_all_events boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS brand_kit_id uuid
    REFERENCES public.brand_kits(id) ON DELETE SET NULL;

UPDATE public.user_luma_calendars
SET ownership = 'connected'
WHERE source = 'api';

ALTER TABLE public.user_luma_calendars
  DROP CONSTRAINT IF EXISTS user_luma_calendars_provider_check,
  ADD CONSTRAINT user_luma_calendars_provider_check
    CHECK (provider IN ('luma', 'eventbrite', 'meetup')),
  DROP CONSTRAINT IF EXISTS user_luma_calendars_ownership_check,
  ADD CONSTRAINT user_luma_calendars_ownership_check
    CHECK (ownership IN ('connected', 'external'));

CREATE UNIQUE INDEX IF NOT EXISTS user_calendars_provider_source_active_idx
  ON public.user_luma_calendars (user_id, provider, provider_source_id)
  WHERE merged_into_id IS NULL AND provider_source_id IS NOT NULL;

ALTER TABLE public.canonical_events
  ADD COLUMN IF NOT EXISTS external_ids jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.event_sources
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'luma',
  ADD COLUMN IF NOT EXISTS provider_event_id text,
  ADD COLUMN IF NOT EXISTS origin_provider_source_id text,
  DROP CONSTRAINT IF EXISTS event_sources_source_type_check,
  ADD CONSTRAINT event_sources_source_type_check CHECK (
    source_type IN (
      'api', 'calendar_scrape', 'event_scrape', 'profile_scrape',
      'eventbrite_api', 'eventbrite_public', 'meetup_api', 'meetup_public'
    )
  ),
  DROP CONSTRAINT IF EXISTS event_sources_provider_check,
  ADD CONSTRAINT event_sources_provider_check
    CHECK (provider IN ('luma', 'eventbrite', 'meetup'));

CREATE INDEX IF NOT EXISTS event_sources_user_provider_event_idx
  ON public.event_sources (user_id, provider, provider_event_id);

GRANT ALL ON public.provider_connections TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_kits TO authenticated;
GRANT ALL ON public.brand_kits TO service_role;

ALTER TABLE public.provider_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_kits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own provider connections"
  ON public.provider_connections FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
REVOKE ALL ON public.provider_connections FROM PUBLIC, anon, authenticated;
CREATE POLICY "Users manage own brand kits"
  ON public.brand_kits FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_provider_connections_updated_at ON public.provider_connections;
CREATE TRIGGER update_provider_connections_updated_at
  BEFORE UPDATE ON public.provider_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_brand_kits_updated_at ON public.brand_kits;
CREATE TRIGGER update_brand_kits_updated_at
  BEFORE UPDATE ON public.brand_kits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Cursor Community is an aggregator: sync every page instead of the legacy
-- bounded preview. Matching by canonical identity also covers prior aliases.
UPDATE public.user_luma_calendars
SET sync_all_events = true,
    event_limit = 2000,
    next_sync_at = now(),
    sync_status = 'queued'
WHERE luma_calendar_id = 'cal-61Cv6COs4g9GKw7'
   OR lower(calendar_url) LIKE '%luma.com/cursorcommunity%';

INSERT INTO public.event_sync_jobs(user_id, source_id, trigger, status)
SELECT user_id, id, 'manual', 'queued'
FROM public.user_luma_calendars
WHERE merged_into_id IS NULL
  AND (
    luma_calendar_id = 'cal-61Cv6COs4g9GKw7'
    OR lower(calendar_url) LIKE '%luma.com/cursorcommunity%'
  )
ON CONFLICT DO NOTHING;
