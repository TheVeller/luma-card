-- Calendar identity support for Luma sync.
-- This migration is idempotent because parts of the schema may already exist.

ALTER TABLE public.user_luma_calendars
  ADD COLUMN IF NOT EXISTS luma_calendar_id text,
  ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES public.user_luma_calendars(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS user_luma_calendars_merged_into_idx
  ON public.user_luma_calendars (merged_into_id)
  WHERE merged_into_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.user_calendar_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  calendar_id uuid NOT NULL REFERENCES public.user_luma_calendars(id) ON DELETE CASCADE,
  alias text NOT NULL,
  alias_kind text NOT NULL DEFAULT 'legacy_id',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, alias)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_calendar_aliases TO authenticated;
GRANT ALL ON public.user_calendar_aliases TO service_role;
ALTER TABLE public.user_calendar_aliases ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_calendar_aliases_alias_kind_check'
      AND conrelid = 'public.user_calendar_aliases'::regclass
  ) THEN
    ALTER TABLE public.user_calendar_aliases
      ADD CONSTRAINT user_calendar_aliases_alias_kind_check
      CHECK (alias_kind IN ('legacy_id', 'luma_id', 'url', 'slug', 'row_id'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS user_calendar_aliases_calendar_idx
  ON public.user_calendar_aliases (calendar_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_calendar_aliases' AND policyname = 'Users read own calendar aliases') THEN
    CREATE POLICY "Users read own calendar aliases"
      ON public.user_calendar_aliases FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_calendar_aliases' AND policyname = 'Users insert own calendar aliases') THEN
    CREATE POLICY "Users insert own calendar aliases"
      ON public.user_calendar_aliases FOR INSERT TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_calendar_aliases' AND policyname = 'Users update own calendar aliases') THEN
    CREATE POLICY "Users update own calendar aliases"
      ON public.user_calendar_aliases FOR UPDATE TO authenticated
      USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_calendar_aliases' AND policyname = 'Users delete own calendar aliases') THEN
    CREATE POLICY "Users delete own calendar aliases"
      ON public.user_calendar_aliases FOR DELETE TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.calendar_merge_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  luma_calendar_id text,
  winner_id uuid NOT NULL REFERENCES public.user_luma_calendars(id) ON DELETE CASCADE,
  loser_id uuid REFERENCES public.user_luma_calendars(id) ON DELETE SET NULL,
  aliases_created integer NOT NULL DEFAULT 0,
  events_moved integer NOT NULL DEFAULT 0,
  sources_moved integer NOT NULL DEFAULT 0,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.calendar_merge_audit TO authenticated;
GRANT ALL ON public.calendar_merge_audit TO service_role;
ALTER TABLE public.calendar_merge_audit ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'calendar_merge_audit' AND policyname = 'Users read own calendar merge audit') THEN
    CREATE POLICY "Users read own calendar merge audit"
      ON public.calendar_merge_audit FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.normalize_calendar_alias(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN value IS NULL OR btrim(value) = '' THEN NULL
    WHEN btrim(value) ~* '^https?://' THEN
      lower(
        regexp_replace(
          regexp_replace(
            regexp_replace(split_part(split_part(btrim(value), '#', 1), '?', 1),
              '^https?://(www\.)?(lu\.ma|luma\.com)', 'https://luma.com', 'i'),
            '/calendar/manage/(cal-[A-Za-z0-9]+)/?$', '/calendar/\1', 'i'),
          '/+$', '')
      )
    ELSE lower(btrim(value))
  END
$$;

CREATE OR REPLACE FUNCTION public.calendar_identity_from_values(
  calendar_id text,
  calendar_url text,
  source_metadata jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    CASE
      WHEN source_metadata->>'lumaCalendarId' ~* '^cal-[A-Za-z0-9]+$'
        THEN source_metadata->>'lumaCalendarId'
    END,
    (regexp_match(calendar_id, '^(?:scr-)?(cal-[A-Za-z0-9]+)$', 'i'))[1],
    (regexp_match(calendar_url, '/calendar/(?:manage/)?(cal-[A-Za-z0-9]+)(?:[/?#]|$)', 'i'))[1]
  )
$$;

CREATE OR REPLACE FUNCTION public.add_calendar_alias(
  p_user_id uuid,
  p_calendar_id uuid,
  p_alias text,
  p_alias_kind text DEFAULT 'legacy_id'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alias text := public.normalize_calendar_alias(p_alias);
  v_changed integer;
BEGIN
  IF v_alias IS NULL THEN RETURN false; END IF;
  INSERT INTO public.user_calendar_aliases(user_id, calendar_id, alias, alias_kind)
  VALUES (p_user_id, p_calendar_id, v_alias, p_alias_kind)
  ON CONFLICT (user_id, alias) DO UPDATE SET
    calendar_id = EXCLUDED.calendar_id,
    alias_kind = EXCLUDED.alias_kind;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed > 0;
END
$$;

CREATE OR REPLACE FUNCTION public.resolve_user_calendar_row_id(
  p_user_id uuid,
  p_identifier text
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE selected AS (
    SELECT c.id, c.merged_into_id
    FROM public.user_luma_calendars c
    WHERE c.user_id = p_user_id
      AND (auth.uid() = p_user_id OR auth.role() = 'service_role')
      AND (
        c.id::text = p_identifier
        OR lower(c.calendar_id) = public.normalize_calendar_alias(p_identifier)
        OR lower(c.luma_calendar_id) = public.normalize_calendar_alias(p_identifier)
        OR public.normalize_calendar_alias(c.calendar_url) = public.normalize_calendar_alias(p_identifier)
        OR lower(c.calendar_slug) = public.normalize_calendar_alias(p_identifier)
        OR c.id = (
          SELECT a.calendar_id
          FROM public.user_calendar_aliases a
          WHERE a.user_id = p_user_id
            AND a.alias = public.normalize_calendar_alias(p_identifier)
          LIMIT 1
        )
      )
    ORDER BY (c.merged_into_id IS NULL) DESC
    LIMIT 1
  ), chain AS (
    SELECT id, merged_into_id FROM selected
    UNION ALL
    SELECT c.id, c.merged_into_id
    FROM public.user_luma_calendars c
    JOIN chain previous ON c.id = previous.merged_into_id
  )
  SELECT id FROM chain ORDER BY (merged_into_id IS NULL) DESC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.merge_calendar_rows(
  p_user_id uuid,
  p_winner_id uuid,
  p_loser_id uuid,
  p_reason text DEFAULT 'canonical_identity'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  winner public.user_luma_calendars%ROWTYPE;
  loser public.user_luma_calendars%ROWTYPE;
  v_aliases integer := 0;
  v_events integer := 0;
  v_sources integer := 0;
BEGIN
  IF p_winner_id = p_loser_id THEN RETURN p_winner_id; END IF;

  SELECT * INTO winner FROM public.user_luma_calendars
  WHERE id = p_winner_id AND user_id = p_user_id FOR UPDATE;
  SELECT * INTO loser FROM public.user_luma_calendars
  WHERE id = p_loser_id AND user_id = p_user_id FOR UPDATE;
  IF winner.id IS NULL OR loser.id IS NULL THEN
    RAISE EXCEPTION 'Calendar merge row not found';
  END IF;

  PERFORM public.add_calendar_alias(p_user_id, winner.id, loser.calendar_id, 'legacy_id');
  v_aliases := v_aliases + 1;
  PERFORM public.add_calendar_alias(p_user_id, winner.id, loser.id::text, 'row_id');
  v_aliases := v_aliases + 1;
  IF loser.calendar_url IS NOT NULL THEN
    PERFORM public.add_calendar_alias(p_user_id, winner.id, loser.calendar_url, 'url');
    v_aliases := v_aliases + 1;
  END IF;
  IF loser.calendar_slug IS NOT NULL THEN
    PERFORM public.add_calendar_alias(p_user_id, winner.id, loser.calendar_slug, 'slug');
    v_aliases := v_aliases + 1;
  END IF;
  IF loser.luma_calendar_id IS NOT NULL THEN
    PERFORM public.add_calendar_alias(p_user_id, winner.id, loser.luma_calendar_id, 'luma_id');
    v_aliases := v_aliases + 1;
  END IF;

  UPDATE public.user_calendar_aliases
  SET calendar_id = winner.id
  WHERE user_id = p_user_id AND calendar_id = loser.id;

  UPDATE public.user_luma_calendars SET
    curated_name = CASE
      WHEN loser.organization_manual AND loser.curated_name IS NOT NULL
        THEN loser.curated_name ELSE COALESCE(winner.curated_name, loser.curated_name) END,
    group_id = CASE
      WHEN loser.organization_manual THEN loser.group_id
      ELSE COALESCE(winner.group_id, loser.group_id) END,
    sort_order = CASE
      WHEN loser.organization_manual THEN loser.sort_order ELSE winner.sort_order END,
    organization_manual = winner.organization_manual OR loser.organization_manual,
    is_default = winner.is_default OR loser.is_default,
    api_key_ciphertext = COALESCE(winner.api_key_ciphertext, loser.api_key_ciphertext),
    source = CASE WHEN winner.source = 'api' OR loser.source = 'api' THEN 'api' ELSE 'scrape' END,
    source_kind = CASE
      WHEN winner.source_kind = 'api' OR loser.source_kind = 'api' THEN 'api'
      ELSE winner.source_kind END,
    calendar_name = COALESCE(winner.calendar_name, loser.calendar_name),
    remote_name = COALESCE(winner.remote_name, loser.remote_name),
    calendar_slug = COALESCE(winner.calendar_slug, loser.calendar_slug),
    calendar_url = COALESCE(winner.calendar_url, loser.calendar_url),
    calendar_avatar_url = COALESCE(winner.calendar_avatar_url, loser.calendar_avatar_url),
    calendar_cover_url = COALESCE(winner.calendar_cover_url, loser.calendar_cover_url),
    calendar_description = COALESCE(winner.calendar_description, loser.calendar_description),
    calendar_tint_color = COALESCE(winner.calendar_tint_color, loser.calendar_tint_color),
    source_metadata = COALESCE(winner.source_metadata, '{}'::jsonb) || COALESCE(loser.source_metadata, '{}'::jsonb),
    discovered_count = GREATEST(winner.discovered_count, loser.discovered_count),
    imported_count = GREATEST(winner.imported_count, loser.imported_count),
    last_synced_at = GREATEST(winner.last_synced_at, loser.last_synced_at),
    next_sync_at = LEAST(winner.next_sync_at, loser.next_sync_at),
    updated_at = now()
  WHERE id = winner.id;

  INSERT INTO public.scraped_events (
    user_id, calendar_id, event_key, source_url, name, description, cover_url,
    city, start_at, end_at, host_name, payload, created_at, updated_at
  )
  SELECT
    user_id, winner.id, event_key, source_url, name, description, cover_url,
    city, start_at, end_at, host_name, payload, created_at, updated_at
  FROM public.scraped_events
  WHERE user_id = p_user_id AND calendar_id = loser.id
  ON CONFLICT (user_id, calendar_id, event_key) DO UPDATE SET
    source_url = COALESCE(EXCLUDED.source_url, public.scraped_events.source_url),
    name = COALESCE(EXCLUDED.name, public.scraped_events.name),
    description = COALESCE(public.scraped_events.description, EXCLUDED.description),
    cover_url = COALESCE(public.scraped_events.cover_url, EXCLUDED.cover_url),
    city = COALESCE(public.scraped_events.city, EXCLUDED.city),
    start_at = COALESCE(public.scraped_events.start_at, EXCLUDED.start_at),
    end_at = COALESCE(public.scraped_events.end_at, EXCLUDED.end_at),
    host_name = COALESCE(public.scraped_events.host_name, EXCLUDED.host_name),
    payload = public.scraped_events.payload || EXCLUDED.payload,
    updated_at = GREATEST(public.scraped_events.updated_at, EXCLUDED.updated_at);
  GET DIAGNOSTICS v_events = ROW_COUNT;

  DELETE FROM public.scraped_events
  WHERE user_id = p_user_id AND calendar_id = loser.id;

  UPDATE public.event_sources SET
    calendar_row_id = winner.id,
    calendar_public_id = winner.calendar_id,
    calendar_name = COALESCE(winner.curated_name, winner.calendar_name, calendar_name),
    updated_at = now()
  WHERE user_id = p_user_id AND calendar_row_id = loser.id;
  GET DIAGNOSTICS v_sources = ROW_COUNT;

  UPDATE public.event_sync_jobs
  SET status = 'cancelled', finished_at = now(),
      error = 'Merged into canonical calendar ' || winner.id::text
  WHERE user_id = p_user_id AND source_id = loser.id AND status = 'queued';

  UPDATE public.user_luma_calendars
  SET merged_into_id = winner.id, sync_enabled = false, is_default = false,
      next_sync_at = NULL, updated_at = now()
  WHERE id = loser.id;

  INSERT INTO public.calendar_merge_audit(
    user_id, luma_calendar_id, winner_id, loser_id,
    aliases_created, events_moved, sources_moved, reason
  ) VALUES (
    p_user_id, winner.luma_calendar_id, winner.id, loser.id,
    v_aliases, v_events, v_sources, p_reason
  );

  RETURN winner.id;
END
$$;

CREATE OR REPLACE FUNCTION public.register_luma_calendar_identity(
  p_user_id uuid,
  p_calendar_row_id uuid,
  p_luma_calendar_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  incoming public.user_luma_calendars%ROWTYPE;
  candidate public.user_luma_calendars%ROWTYPE;
  winner_id uuid;
  loser_id uuid;
BEGIN
  IF p_luma_calendar_id !~* '^cal-[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'Invalid Luma calendar identity';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || lower(p_luma_calendar_id), 0));

  SELECT * INTO incoming FROM public.user_luma_calendars
  WHERE id = p_calendar_row_id AND user_id = p_user_id FOR UPDATE;
  IF incoming.id IS NULL THEN RAISE EXCEPTION 'Calendar row not found'; END IF;

  SELECT * INTO candidate FROM public.user_luma_calendars
  WHERE user_id = p_user_id
    AND merged_into_id IS NULL
    AND luma_calendar_id = p_luma_calendar_id
    AND id <> incoming.id
  ORDER BY
    (source_kind = 'api' OR source = 'api') DESC,
    (sync_status IN ('completed', 'partial')) DESC,
    created_at ASC
  LIMIT 1 FOR UPDATE;

  IF candidate.id IS NULL THEN
    UPDATE public.user_luma_calendars
    SET luma_calendar_id = p_luma_calendar_id,
        source_metadata = COALESCE(source_metadata, '{}'::jsonb) || jsonb_build_object('lumaCalendarId', p_luma_calendar_id),
        updated_at = now()
    WHERE id = incoming.id;
    winner_id := incoming.id;
  ELSE
    IF (incoming.source_kind = 'api' OR incoming.source = 'api') AND NOT (candidate.source_kind = 'api' OR candidate.source = 'api') THEN
      winner_id := incoming.id;
      loser_id := candidate.id;
      UPDATE public.user_luma_calendars SET luma_calendar_id = NULL WHERE id = candidate.id;
      UPDATE public.user_luma_calendars
      SET luma_calendar_id = p_luma_calendar_id,
          source_metadata = COALESCE(source_metadata, '{}'::jsonb) || jsonb_build_object('lumaCalendarId', p_luma_calendar_id),
          updated_at = now()
      WHERE id = incoming.id;
    ELSE
      winner_id := candidate.id;
      loser_id := incoming.id;
      UPDATE public.user_luma_calendars
      SET luma_calendar_id = p_luma_calendar_id,
          source_metadata = COALESCE(source_metadata, '{}'::jsonb) || jsonb_build_object('lumaCalendarId', p_luma_calendar_id),
          updated_at = now()
      WHERE id = candidate.id;
    END IF;
    PERFORM public.merge_calendar_rows(p_user_id, winner_id, loser_id, 'registered_identity');
  END IF;

  PERFORM public.add_calendar_alias(p_user_id, winner_id, p_luma_calendar_id, 'luma_id');
  RETURN winner_id;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS user_luma_calendars_active_luma_identity_idx
  ON public.user_luma_calendars (user_id, luma_calendar_id)
  WHERE merged_into_id IS NULL AND luma_calendar_id IS NOT NULL;

WITH ranked_aliases AS (
  SELECT
    user_id,
    id AS calendar_id,
    public.normalize_calendar_alias(calendar_id) AS alias,
    row_number() OVER (
      PARTITION BY user_id, public.normalize_calendar_alias(calendar_id)
      ORDER BY created_at ASC, id ASC
    ) AS rank
  FROM public.user_luma_calendars
  WHERE merged_into_id IS NULL
    AND public.normalize_calendar_alias(calendar_id) IS NOT NULL
)
INSERT INTO public.user_calendar_aliases(user_id, calendar_id, alias, alias_kind)
SELECT user_id, calendar_id, alias, 'legacy_id'
FROM ranked_aliases
WHERE rank = 1
ON CONFLICT (user_id, alias) DO UPDATE SET calendar_id = EXCLUDED.calendar_id;

WITH ranked_aliases AS (
  SELECT
    user_id,
    id AS calendar_id,
    public.normalize_calendar_alias(calendar_url) AS alias,
    row_number() OVER (
      PARTITION BY user_id, public.normalize_calendar_alias(calendar_url)
      ORDER BY created_at ASC, id ASC
    ) AS rank
  FROM public.user_luma_calendars
  WHERE merged_into_id IS NULL
    AND calendar_url IS NOT NULL
    AND public.normalize_calendar_alias(calendar_url) IS NOT NULL
)
INSERT INTO public.user_calendar_aliases(user_id, calendar_id, alias, alias_kind)
SELECT user_id, calendar_id, alias, 'url'
FROM ranked_aliases
WHERE rank = 1
ON CONFLICT (user_id, alias) DO UPDATE SET calendar_id = EXCLUDED.calendar_id;

REVOKE ALL ON FUNCTION public.add_calendar_alias(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.merge_calendar_rows(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_luma_calendar_identity(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_user_calendar_row_id(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_user_calendar_row_id(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_luma_calendar_identity(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_calendar_alias(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_calendar_rows(uuid, uuid, uuid, text) TO service_role;