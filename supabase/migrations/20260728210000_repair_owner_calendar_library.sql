-- Repair the owner library after the canonical-calendar rollout. The legacy
-- global event key made aggregator calendars fail as soon as they listed an
-- event that was already present in another calendar.
ALTER TABLE public.scraped_events
  DROP CONSTRAINT IF EXISTS scraped_events_user_id_event_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS scraped_events_user_calendar_event_key
  ON public.scraped_events (user_id, calendar_id, event_key);

CREATE INDEX IF NOT EXISTS scraped_events_user_event_idx
  ON public.scraped_events (user_id, event_key);

DO $$
DECLARE
  v_user_id uuid;
  v_cursor_id uuid;
  v_winner_id uuid;
  v_ignacio_profile_id uuid;
  v_ignacio_calendar_id uuid;
  duplicate_name text;
  loser record;
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

  -- Register the known canonical identity before queueing the complete Cursor
  -- Community snapshot. API-backed rows still win if one is connected later.
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
      v_user_id,
      v_cursor_id,
      'cal-61Cv6COs4g9GKw7'
    );
    UPDATE public.user_luma_calendars
    SET curated_name = CASE
          WHEN organization_manual THEN curated_name
          ELSE 'Cursor Community'
        END,
        calendar_url = 'https://luma.com/cursorcommunity',
        sync_all_events = true,
        event_limit = 2000,
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

  -- Explicit repair manifest observed in the owner Settings screen. For these
  -- known pairs, preserve the API connection and merge the public-link cache.
  FOREACH duplicate_name IN ARRAY ARRAY[
    'cursor lima, peru',
    'cursor arequipa, peru',
    'flit festival',
    'hack0 community',
    'notion arequipa'
  ]
  LOOP
    v_winner_id := NULL;
    SELECT id INTO v_winner_id
    FROM public.user_luma_calendars
    WHERE user_id = v_user_id
      AND merged_into_id IS NULL
      AND (source_kind = 'api' OR source = 'api')
      AND lower(COALESCE(curated_name, remote_name, calendar_name, '')) = duplicate_name
    ORDER BY created_at
    LIMIT 1;

    IF v_winner_id IS NOT NULL THEN
      FOR loser IN
        SELECT id
        FROM public.user_luma_calendars
        WHERE user_id = v_user_id
          AND merged_into_id IS NULL
          AND id <> v_winner_id
          AND NOT (source_kind = 'api' OR source = 'api')
          AND lower(COALESCE(curated_name, remote_name, calendar_name, '')) = duplicate_name
        ORDER BY created_at
      LOOP
        PERFORM public.merge_calendar_rows(
          v_user_id,
          v_winner_id,
          loser.id,
          'owner_api_duplicate_repair'
        );
      END LOOP;
    END IF;
  END LOOP;

  -- The public profile is the personal source with data (8 events in the
  -- pre-repair audit); the managed calendar row has none.
  SELECT id INTO v_ignacio_profile_id
  FROM public.user_luma_calendars
  WHERE user_id = v_user_id
    AND merged_into_id IS NULL
    AND source_kind = 'profile'
    AND (
      lower(calendar_url) LIKE '%luma.com/user/theveller%'
      OR lower(COALESCE(curated_name, remote_name, calendar_name, '')) =
        'ignacio velasquez profile'
    )
  ORDER BY imported_count DESC, created_at
  LIMIT 1;

  SELECT id INTO v_ignacio_calendar_id
  FROM public.user_luma_calendars
  WHERE user_id = v_user_id
    AND merged_into_id IS NULL
    AND source_kind = 'calendar'
    AND (
      lower(calendar_url) LIKE '%cal-kxl4d1uaou43fuo%'
      OR lower(COALESCE(curated_name, remote_name, calendar_name, '')) =
        'ignacio velasquez'
    )
  ORDER BY imported_count DESC, created_at
  LIMIT 1;

  IF v_ignacio_profile_id IS NOT NULL
     AND v_ignacio_calendar_id IS NOT NULL
     AND v_ignacio_profile_id <> v_ignacio_calendar_id THEN
    PERFORM public.merge_calendar_rows(
      v_user_id,
      v_ignacio_profile_id,
      v_ignacio_calendar_id,
      'owner_personal_source_repair'
    );
    UPDATE public.user_luma_calendars
    SET curated_name = 'Ignacio Velasquez',
        updated_at = now()
    WHERE id = v_ignacio_profile_id
      AND NOT organization_manual;
  END IF;

  -- Upgrade any already queued repair work to a historical snapshot and add
  -- missing jobs. A running worker is allowed to finish without creating a
  -- competing job.
  UPDATE public.event_sync_jobs j
  SET sync_scope = 'full',
      scheduled_at = now(),
      error = NULL,
      updated_at = now()
  WHERE j.user_id = v_user_id
    AND j.status = 'queued'
    AND j.source_id IN (
      SELECT c.id
      FROM public.user_luma_calendars c
      WHERE c.user_id = v_user_id
        AND c.merged_into_id IS NULL
        AND (
          c.id = v_cursor_id
          OR (
            (c.source_kind = 'api' OR c.source = 'api')
            AND lower(COALESCE(c.curated_name, c.remote_name, c.calendar_name, '')) =
              ANY (ARRAY[
                'cursor lima, peru',
                'cursor arequipa, peru',
                'flit festival',
                'hack0 community',
                'notion arequipa'
              ])
          )
        )
    );

  INSERT INTO public.event_sync_jobs(
    user_id, source_id, trigger, status, sync_scope, scheduled_at
  )
  SELECT v_user_id, c.id, 'manual', 'queued', 'full', now()
  FROM public.user_luma_calendars c
  WHERE c.user_id = v_user_id
    AND c.merged_into_id IS NULL
    AND (
      c.id = v_cursor_id
      OR (
        (c.source_kind = 'api' OR c.source = 'api')
        AND lower(COALESCE(c.curated_name, c.remote_name, c.calendar_name, '')) =
          ANY (ARRAY[
            'cursor lima, peru',
            'cursor arequipa, peru',
            'flit festival',
            'hack0 community',
            'notion arequipa'
          ])
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.event_sync_jobs active_job
      WHERE active_job.source_id = c.id
        AND active_job.status IN ('queued', 'running')
    )
  ON CONFLICT DO NOTHING;

  UPDATE public.user_luma_calendars c
  SET sync_status = CASE
        WHEN EXISTS (
          SELECT 1 FROM public.event_sync_jobs running_job
          WHERE running_job.source_id = c.id
            AND running_job.status = 'running'
        ) THEN 'running'
        ELSE 'queued'
      END,
      sync_error = NULL,
      next_sync_at = now(),
      updated_at = now()
  WHERE c.user_id = v_user_id
    AND c.merged_into_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.event_sync_jobs active_job
      WHERE active_job.source_id = c.id
        AND active_job.status IN ('queued', 'running')
    );

  PERFORM public.cleanup_merged_calendar_rows(v_user_id);
END
$$;
