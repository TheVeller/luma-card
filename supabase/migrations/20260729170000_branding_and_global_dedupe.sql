-- Durable source identity, image metadata, and idempotent deduplication.
-- This migration is intentionally additive: losers are retained as merged rows
-- and every merge is recorded by merge_calendar_rows/calendar_merge_audit.

CREATE OR REPLACE FUNCTION public.normalized_calendar_source_url(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    regexp_replace(
      regexp_replace(
        lower(split_part(split_part(trim(value), '#', 1), '?', 1)),
        '^https?://(www\.)?', ''
      ),
      '/+$', ''
    ),
    ''
  )
$$;

-- Backfill provider identities before deduplication/index creation.
UPDATE public.user_luma_calendars
SET provider = COALESCE(provider, 'luma')
WHERE provider IS NULL;

UPDATE public.user_luma_calendars
SET provider_source_id = 'meetup:meetup.com/' || lower(
  split_part(regexp_replace(split_part(split_part(calendar_url, '#', 1), '?', 1), '^https?://(www\.)?', ''), '/', 1)
)
WHERE provider = 'meetup'
  AND provider_source_id IS NULL
  AND calendar_url ~* '^https?://(www\.)?meetup\.com/[^/]+/?';

-- Merge duplicate provider identities and canonical URLs. The winner is
-- deterministic: connected/API, then more imported events, then oldest row.
DO $$
DECLARE
  duplicate record;
  winner uuid;
  loser uuid;
BEGIN
  FOR duplicate IN
    SELECT user_id, provider, provider_source_id, array_agg(id ORDER BY
      (source = 'api') DESC, imported_count DESC NULLS LAST, created_at ASC, id) AS ids
    FROM public.user_luma_calendars
    WHERE merged_into_id IS NULL AND provider_source_id IS NOT NULL
    GROUP BY user_id, provider, provider_source_id
    HAVING count(*) > 1
  LOOP
    winner := duplicate.ids[1];
    FOREACH loser IN ARRAY duplicate.ids[2:array_length(duplicate.ids, 1)] LOOP
      PERFORM public.merge_calendar_rows(duplicate.user_id, winner, loser, 'provider_identity_dedupe');
    END LOOP;
  END LOOP;

  FOR duplicate IN
    SELECT user_id, provider, normalized_calendar_source_url(calendar_url) AS source_url,
      array_agg(id ORDER BY (source = 'api') DESC, imported_count DESC NULLS LAST, created_at ASC, id) AS ids
    FROM public.user_luma_calendars
    WHERE merged_into_id IS NULL AND calendar_url IS NOT NULL
    GROUP BY user_id, provider, normalized_calendar_source_url(calendar_url)
    HAVING count(*) > 1
  LOOP
    winner := duplicate.ids[1];
    FOREACH loser IN ARRAY duplicate.ids[2:array_length(duplicate.ids, 1)] LOOP
      PERFORM public.merge_calendar_rows(duplicate.user_id, winner, loser, 'normalized_url_dedupe');
    END LOOP;
  END LOOP;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS user_luma_calendars_provider_url_active_idx
  ON public.user_luma_calendars (user_id, provider, normalized_calendar_source_url(calendar_url))
  WHERE merged_into_id IS NULL AND calendar_url IS NOT NULL;

-- A provider event may be observed through multiple ingestion modes, but only
-- once per calendar. Remove historical duplicates before enforcing the rule.
WITH ranked AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY user_id, calendar_row_id, provider,
        COALESCE(provider_event_id, external_event_id, source_key)
      ORDER BY last_synced_at DESC, updated_at DESC, id
    ) AS rank
  FROM public.event_sources
  WHERE COALESCE(provider_event_id, external_event_id, source_key) IS NOT NULL
)
DELETE FROM public.event_sources source
USING ranked duplicate
WHERE source.id = duplicate.id AND duplicate.rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS event_sources_calendar_provider_event_idx
  ON public.event_sources (
    user_id,
    COALESCE(calendar_row_id, '00000000-0000-0000-0000-000000000000'::uuid),
    provider,
    COALESCE(provider_event_id, external_event_id, source_key)
  );

-- Repair canonical-event races by URL and move all sightings to one row.
DO $$
DECLARE
  duplicate record;
  winner uuid;
  loser uuid;
BEGIN
  FOR duplicate IN
    SELECT user_id, url, array_agg(id ORDER BY created_at ASC, id) AS ids
    FROM public.canonical_events
    WHERE url IS NOT NULL
    GROUP BY user_id, url
    HAVING count(*) > 1
  LOOP
    winner := duplicate.ids[1];
    FOREACH loser IN ARRAY duplicate.ids[2:array_length(duplicate.ids, 1)] LOOP
      UPDATE public.event_sources SET canonical_event_id = winner
      WHERE canonical_event_id = loser;
      UPDATE public.canonical_events keep
      SET cover_url = COALESCE(keep.cover_url, old.cover_url),
          description = COALESCE(keep.description, old.description),
          host_name = COALESCE(keep.host_name, old.host_name),
          external_ids = keep.external_ids || old.external_ids,
          updated_at = now()
      FROM public.canonical_events old
      WHERE keep.id = winner AND old.id = loser;
      DELETE FROM public.canonical_events WHERE id = loser;
    END LOOP;
  END LOOP;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS canonical_events_user_url_idx
  ON public.canonical_events (user_id, url);

-- Keep counters honest after historical source merges.
UPDATE public.user_luma_calendars calendar
SET imported_count = (
  SELECT count(DISTINCT source.canonical_event_id)
  FROM public.event_sources source
  WHERE source.user_id = calendar.user_id AND source.calendar_row_id = calendar.id
), updated_at = now()
WHERE calendar.merged_into_id IS NULL;
