-- 1. Restore any cross-provider merges (defensive; expected 0 rows today)
UPDATE public.user_luma_calendars loser
SET merged_into_id = NULL,
    sync_enabled = true,
    sync_status = 'queued',
    sync_error = NULL,
    next_sync_at = now(),
    updated_at = now()
FROM public.user_luma_calendars winner
WHERE loser.merged_into_id = winner.id
  AND COALESCE(loser.provider, 'luma') <> COALESCE(winner.provider, 'luma');

-- 2. Prevent cross-provider merges from ever happening again
CREATE OR REPLACE FUNCTION public.guard_cross_provider_merge()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  winner_provider text;
BEGIN
  IF NEW.merged_into_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(provider, 'luma') INTO winner_provider
  FROM public.user_luma_calendars
  WHERE id = NEW.merged_into_id;
  IF winner_provider IS NOT NULL AND winner_provider <> COALESCE(NEW.provider, 'luma') THEN
    RAISE EXCEPTION 'Cannot merge calendars across providers (% into %)',
      COALESCE(NEW.provider, 'luma'), winner_provider;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS guard_cross_provider_merge_trg ON public.user_luma_calendars;
CREATE TRIGGER guard_cross_provider_merge_trg
BEFORE INSERT OR UPDATE OF merged_into_id ON public.user_luma_calendars
FOR EACH ROW EXECUTE FUNCTION public.guard_cross_provider_merge();

-- 3. Per-provider identity uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS user_luma_calendars_provider_identity_idx
  ON public.user_luma_calendars (user_id, provider, provider_source_id)
  WHERE merged_into_id IS NULL AND provider_source_id IS NOT NULL;

-- 4. Missing scoped finalize function (root cause of the failed syncs)
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
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_scoped_calendar_sync(
  uuid, uuid, timestamptz, text[], timestamptz, boolean
) TO service_role;

-- 5. Drop orphan canonical events (no remaining source)
DELETE FROM public.canonical_events e
WHERE NOT EXISTS (
  SELECT 1 FROM public.event_sources s WHERE s.canonical_event_id = e.id
);

-- 6. Requeue calendars that failed only because the function was missing
UPDATE public.user_luma_calendars
SET sync_status = 'queued',
    sync_error = NULL,
    next_sync_at = now(),
    updated_at = now()
WHERE merged_into_id IS NULL
  AND sync_status IN ('failed', 'inaccessible')
  AND (sync_error IS NULL OR sync_error ILIKE '%finalize_scoped_calendar_sync%'
       OR sync_error ILIKE '%not publicly accessible%');