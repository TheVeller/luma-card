-- Track the difference between an initial/full historical import and the
-- inexpensive maintenance pass used after that history is safely stored.

-- A Lovable-generated compatibility migration briefly introduced this field as
-- text and defaulted every source to connected. Normalize both definitions now
-- that provider connections are backed by UUID rows.
ALTER TABLE public.user_luma_calendars
  ALTER COLUMN provider_connection_id TYPE uuid
    USING NULLIF(provider_connection_id::text, '')::uuid,
  ALTER COLUMN ownership SET DEFAULT 'external';

UPDATE public.user_luma_calendars
SET ownership = 'external'
WHERE source <> 'api' AND provider_connection_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_luma_calendars_provider_connection_id_fkey'
  ) THEN
    ALTER TABLE public.user_luma_calendars
      ADD CONSTRAINT user_luma_calendars_provider_connection_id_fkey
      FOREIGN KEY (provider_connection_id)
      REFERENCES public.provider_connections(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_luma_calendars_brand_kit_id_fkey'
  ) THEN
    ALTER TABLE public.user_luma_calendars
      ADD CONSTRAINT user_luma_calendars_brand_kit_id_fkey
      FOREIGN KEY (brand_kit_id)
      REFERENCES public.brand_kits(id) ON DELETE SET NULL;
  END IF;
END
$$;

ALTER TABLE public.user_luma_calendars
  ADD COLUMN IF NOT EXISTS historical_sync_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_scope text;

ALTER TABLE public.user_luma_calendars
  DROP CONSTRAINT IF EXISTS user_luma_calendars_last_sync_scope_check,
  ADD CONSTRAINT user_luma_calendars_last_sync_scope_check
    CHECK (last_sync_scope IS NULL OR last_sync_scope IN ('full', 'maintenance'));

ALTER TABLE public.event_sync_jobs
  ADD COLUMN IF NOT EXISTS sync_scope text NOT NULL DEFAULT 'auto';

ALTER TABLE public.event_sync_jobs
  DROP CONSTRAINT IF EXISTS event_sync_jobs_sync_scope_check,
  ADD CONSTRAINT event_sync_jobs_sync_scope_check
    CHECK (sync_scope IN ('auto', 'full', 'maintenance'));

-- Calendars that have already completed a genuinely unbounded import can move
-- directly to maintenance. Bounded previews intentionally receive one full pass.
UPDATE public.user_luma_calendars
SET historical_sync_completed_at = COALESCE(last_synced_at, now()),
    last_sync_scope = 'full'
WHERE merged_into_id IS NULL
  AND sync_status IN ('completed', 'partial')
  AND (
    sync_all_events = true
    OR source_metadata->>'syncScope' = 'all'
  )
  AND historical_sync_completed_at IS NULL;

CREATE INDEX IF NOT EXISTS user_luma_calendars_due_sync_idx
  ON public.user_luma_calendars (next_sync_at)
  WHERE sync_enabled = true AND merged_into_id IS NULL;

-- Retry API calendars that failed against the retired endpoint as soon as this
-- migration and the new adapter are deployed.
UPDATE public.user_luma_calendars
SET sync_status = 'queued',
    sync_error = NULL,
    next_sync_at = now()
WHERE merged_into_id IS NULL
  AND source_kind = 'api'
  AND sync_status = 'failed';

INSERT INTO public.event_sync_jobs(user_id, source_id, trigger, status, sync_scope)
SELECT user_id, id, 'scheduled', 'queued', 'auto'
FROM public.user_luma_calendars
WHERE merged_into_id IS NULL
  AND source_kind = 'api'
  AND sync_status = 'queued'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.finalize_scoped_calendar_sync(
  p_user_id uuid,
  p_calendar_row_id uuid,
  p_run_started_at timestamptz,
  p_source_types text[],
  p_after timestamptz DEFAULT NULL,
  p_remove_scraped_sources boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed_sources integer := 0;
  removed_cached_events integer := 0;
  removed_orphans integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_luma_calendars c
    WHERE c.id = p_calendar_row_id
      AND c.user_id = p_user_id
      AND c.merged_into_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Active calendar not found';
  END IF;

  DELETE FROM public.event_sources s
  USING public.canonical_events e
  WHERE s.canonical_event_id = e.id
    AND s.user_id = p_user_id
    AND s.calendar_row_id = p_calendar_row_id
    AND (
      (s.source_type = ANY(p_source_types) AND s.last_synced_at < p_run_started_at)
      OR (p_remove_scraped_sources AND s.source_type = 'calendar_scrape')
    )
    AND (p_after IS NULL OR e.start_at >= p_after);
  GET DIAGNOSTICS removed_sources = ROW_COUNT;

  DELETE FROM public.scraped_events cached
  WHERE cached.user_id = p_user_id
    AND cached.calendar_id = p_calendar_row_id
    AND cached.updated_at < p_run_started_at
    AND (p_after IS NULL OR cached.start_at >= p_after);
  GET DIAGNOSTICS removed_cached_events = ROW_COUNT;

  DELETE FROM public.canonical_events event
  WHERE event.user_id = p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.event_sources source
      WHERE source.canonical_event_id = event.id
    );
  GET DIAGNOSTICS removed_orphans = ROW_COUNT;

  RETURN jsonb_build_object(
    'removedSources', removed_sources,
    'removedCachedEvents', removed_cached_events,
    'removedOrphans', removed_orphans
  );
END
$$;

REVOKE ALL ON FUNCTION public.finalize_scoped_calendar_sync(
  uuid, uuid, timestamptz, text[], timestamptz, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_scoped_calendar_sync(
  uuid, uuid, timestamptz, text[], timestamptz, boolean
) TO service_role;
