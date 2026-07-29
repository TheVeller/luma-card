-- Restore connected Luma rows that were incorrectly hidden by a
-- cross-provider canonical merge.  Provider identity is now isolated in the
-- application, but this repairs rows created before that guard existed.
-- The update is deliberately narrow and idempotent: intentional Luma/Luma
-- merges remain untouched, and no event or source rows are deleted.
DO $$
DECLARE
  repaired integer := 0;
BEGIN
  WITH candidates AS (
    SELECT DISTINCT ON (audit.loser_id)
      loser.id,
      loser.luma_calendar_id,
      loser.api_key_ciphertext,
      loser.source,
      loser.provider,
      loser.ownership
    FROM public.calendar_merge_audit audit
    JOIN public.user_luma_calendars loser ON loser.id = audit.loser_id
    JOIN public.user_luma_calendars winner ON winner.id = audit.winner_id
    WHERE loser.merged_into_id = winner.id
      AND loser.user_id = audit.user_id
      AND COALESCE(loser.provider, 'luma') = 'luma'
      AND COALESCE(winner.provider, 'luma') <> 'luma'
      AND (
        loser.ownership = 'connected'
        OR loser.api_key_ciphertext IS NOT NULL
        OR loser.source = 'api'
      )
    ORDER BY audit.loser_id, audit.created_at DESC
  ),
  safe_candidates AS (
    SELECT c.*
    FROM candidates c
    WHERE c.luma_calendar_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM public.user_luma_calendars active
         WHERE active.user_id = (SELECT user_id FROM public.user_luma_calendars WHERE id = c.id)
           AND active.id <> c.id
           AND active.merged_into_id IS NULL
           AND active.luma_calendar_id = c.luma_calendar_id
       )
  )
  UPDATE public.user_luma_calendars AS calendar_row
  SET merged_into_id = NULL,
      sync_enabled = true,
      provider = COALESCE(calendar_row.provider, 'luma'),
      ownership = CASE
        WHEN calendar_row.api_key_ciphertext IS NOT NULL OR calendar_row.source = 'api' THEN 'connected'
        ELSE COALESCE(calendar_row.ownership, 'connected')
      END,
      is_default = false,
      sync_status = 'queued',
      sync_error = NULL,
      next_sync_at = now(),
      updated_at = now()
  FROM safe_candidates candidate
  WHERE calendar_row.id = candidate.id;

  -- Repaired rows need an explicit worker job; merely setting next_sync_at
  -- does not wake the queue on older deployments.
  INSERT INTO public.event_sync_jobs(
    user_id, source_id, trigger, status, sync_scope, scheduled_at
  )
  SELECT DISTINCT loser.user_id, loser.id, 'manual', 'queued', 'full', now()
  FROM public.calendar_merge_audit audit
  JOIN public.user_luma_calendars loser ON loser.id = audit.loser_id
  JOIN public.user_luma_calendars winner ON winner.id = audit.winner_id
  WHERE loser.merged_into_id IS NULL
    AND COALESCE(loser.provider, 'luma') = 'luma'
    AND COALESCE(winner.provider, 'luma') <> 'luma'
    AND (loser.ownership = 'connected' OR loser.api_key_ciphertext IS NOT NULL OR loser.source = 'api')
    AND NOT EXISTS (
      SELECT 1 FROM public.event_sync_jobs active
      WHERE active.source_id = loser.id AND active.status IN ('queued', 'running')
    );

  GET DIAGNOSTICS repaired = ROW_COUNT;
  RAISE NOTICE 'Restored % cross-provider Luma calendar rows', repaired;
END
$$;
