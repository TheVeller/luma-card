-- 1. event_sync_jobs: add missing updated_at and a partial-unique index for active jobs.
ALTER TABLE public.event_sync_jobs
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS event_sync_jobs_active_source_idx
  ON public.event_sync_jobs (source_id)
  WHERE status IN ('queued', 'running');

-- 2. scraped_events: drop the legacy global unique; keep per-calendar unique.
ALTER TABLE public.scraped_events
  DROP CONSTRAINT IF EXISTS scraped_events_user_id_event_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS scraped_events_user_calendar_event_key
  ON public.scraped_events (user_id, calendar_id, event_key);

CREATE INDEX IF NOT EXISTS scraped_events_user_event_idx
  ON public.scraped_events (user_id, event_key);

-- 3. Owner-scoped repair: named duplicates + Cursor Community full-history queue.
DO $$
DECLARE
  v_user_id uuid;
  v_cursor_id uuid;
  v_ignacio_profile_id uuid;
  v_ignacio_calendar_id uuid;
  duplicate_name text;
  loser record;
  winner_id uuid;
  duplicate_names text[] := ARRAY[
    'cursor lima, peru',
    'cursor arequipa, peru',
    'flit festival',
    'hack0 community',
    'notion arequipa'
  ];
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = 'ivelasquezfr@gmail.com'
  ORDER BY created_at
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Owner account not found; calendar repair skipped';
    RETURN;
  END IF;

  -- 3a. Cursor Community canonical identity + full-history configuration.
  SELECT id INTO v_cursor_id
  FROM public.user_luma_calendars
  WHERE user_id = v_user_id
    AND merged_into_id IS NULL
    AND (
      luma_calendar_id = 'cal-61Cv6COs4g9GKw7'
      OR lower(calendar_url) LIKE '%luma.com/cursorcommunity%'
    )
  ORDER BY
    (source_kind = 'api' OR source = 'api') DESC,
    created_at
  LIMIT 1;

  IF v_cursor_id IS NOT NULL THEN
    v_cursor_id := public.register_luma_calendar_identity(
      v_user_id, v_cursor_id, 'cal-61Cv6COs4g9GKw7'
    );
    UPDATE public.user_luma_calendars
    SET curated_name = CASE
          WHEN organization_manual THEN curated_name
          ELSE 'Cursor Community'
        END,
        calendar_url = COALESCE(calendar_url, 'https://luma.com/cursorcommunity'),
        sync_all_events = true,
        event_limit = GREATEST(event_limit, 2000),
        sync_enabled = true,
        historical_sync_completed_at = NULL,
        next_sync_at = now(),
        source_metadata = COALESCE(source_metadata, '{}'::jsonb) ||
          jsonb_build_object(
            'lumaCalendarId', 'cal-61Cv6COs4g9GKw7',
            'repairRequestedAt', now()
          ),
        updated_at = now()
    WHERE id = v_cursor_id;

    PERFORM public.add_calendar_alias(
      v_user_id, v_cursor_id, 'https://luma.com/cursorcommunity', 'url'
    );
    PERFORM public.add_calendar_alias(
      v_user_id, v_cursor_id, 'cal-61Cv6COs4g9GKw7', 'luma_id'
    );
  END IF;

  -- 3b. Named duplicates: merge public losers into API winner.
  FOREACH duplicate_name IN ARRAY duplicate_names LOOP
    winner_id := NULL;
    SELECT id INTO winner_id
    FROM public.user_luma_calendars
    WHERE user_id = v_user_id
      AND merged_into_id IS NULL
      AND (source_kind = 'api' OR source = 'api')
      AND lower(COALESCE(curated_name, remote_name, calendar_name, '')) = duplicate_name
    ORDER BY created_at
    LIMIT 1;

    IF winner_id IS NOT NULL THEN
      FOR loser IN
        SELECT id
        FROM public.user_luma_calendars
        WHERE user_id = v_user_id
          AND merged_into_id IS NULL
          AND id <> winner_id
          AND NOT (source_kind = 'api' OR source = 'api')
          AND lower(COALESCE(curated_name, remote_name, calendar_name, '')) = duplicate_name
        ORDER BY created_at
      LOOP
        PERFORM public.merge_calendar_rows(
          v_user_id, winner_id, loser.id, 'owner_api_duplicate_repair'
        );
      END LOOP;
    END IF;
  END LOOP;

  -- 3c. Ignacio Velasquez: keep profile (8 events), merge empty calendar row.
  SELECT id INTO v_ignacio_profile_id
  FROM public.user_luma_calendars
  WHERE user_id = v_user_id
    AND merged_into_id IS NULL
    AND source_kind = 'profile'
    AND (
      lower(calendar_url) LIKE '%luma.com/user/theveller%'
      OR lower(COALESCE(curated_name, remote_name, calendar_name, '')) = 'ignacio velasquez profile'
    )
  ORDER BY imported_count DESC, created_at
  LIMIT 1;

  SELECT id INTO v_ignacio_calendar_id
  FROM public.user_luma_calendars
  WHERE user_id = v_user_id
    AND merged_into_id IS NULL
    AND source_kind = 'calendar'
    AND lower(COALESCE(curated_name, remote_name, calendar_name, '')) = 'ignacio velasquez'
  ORDER BY imported_count DESC, created_at
  LIMIT 1;

  IF v_ignacio_profile_id IS NOT NULL
     AND v_ignacio_calendar_id IS NOT NULL
     AND v_ignacio_profile_id <> v_ignacio_calendar_id THEN
    PERFORM public.merge_calendar_rows(
      v_user_id, v_ignacio_profile_id, v_ignacio_calendar_id, 'owner_personal_source_repair'
    );
    UPDATE public.user_luma_calendars
    SET curated_name = 'Ignacio Velasquez',
        updated_at = now()
    WHERE id = v_ignacio_profile_id
      AND NOT organization_manual;
  END IF;

  -- 3d. Upgrade any queued job for target calendars to full-scope.
  UPDATE public.event_sync_jobs j
  SET sync_scope = 'full',
      scheduled_at = now(),
      error = NULL,
      updated_at = now()
  WHERE j.user_id = v_user_id
    AND j.status = 'queued'
    AND j.source_id IN (
      SELECT c.id FROM public.user_luma_calendars c
      WHERE c.user_id = v_user_id
        AND c.merged_into_id IS NULL
        AND (
          c.id = v_cursor_id
          OR (
            (c.source_kind = 'api' OR c.source = 'api')
            AND lower(COALESCE(c.curated_name, c.remote_name, c.calendar_name, '')) = ANY (duplicate_names)
          )
        )
    );

  -- 3e. Enqueue full-scope jobs where none is active (partial unique index enforces).
  INSERT INTO public.event_sync_jobs(
    user_id, source_id, batch_id, trigger, status, sync_scope, scheduled_at
  )
  SELECT v_user_id, c.id, gen_random_uuid(), 'manual', 'queued', 'full', now()
  FROM public.user_luma_calendars c
  WHERE c.user_id = v_user_id
    AND c.merged_into_id IS NULL
    AND (
      c.id = v_cursor_id
      OR (
        (c.source_kind = 'api' OR c.source = 'api')
        AND lower(COALESCE(c.curated_name, c.remote_name, c.calendar_name, '')) = ANY (duplicate_names)
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.event_sync_jobs aj
      WHERE aj.source_id = c.id AND aj.status IN ('queued', 'running')
    );

  -- 3f. Reflect queued/running state on calendar rows.
  UPDATE public.user_luma_calendars c
  SET sync_status = CASE
        WHEN EXISTS (
          SELECT 1 FROM public.event_sync_jobs rj
          WHERE rj.source_id = c.id AND rj.status = 'running'
        ) THEN 'running'
        ELSE 'queued'
      END,
      sync_error = NULL,
      next_sync_at = now(),
      updated_at = now()
  WHERE c.user_id = v_user_id
    AND c.merged_into_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.event_sync_jobs aj
      WHERE aj.source_id = c.id AND aj.status IN ('queued', 'running')
    );

  PERFORM public.cleanup_merged_calendar_rows(v_user_id);
END
$$;