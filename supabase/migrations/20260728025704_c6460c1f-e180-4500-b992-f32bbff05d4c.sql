CREATE OR REPLACE FUNCTION public.normalize_calendar_alias(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
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
SET search_path = public
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

REVOKE ALL ON FUNCTION public.add_calendar_alias(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_calendar_rows(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_luma_calendar_identity(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_user_calendar_row_id(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_merged_calendar_rows(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_api_calendar_sync(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_event_library_stats(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.add_calendar_alias(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_calendar_rows(uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_luma_calendar_identity(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_user_calendar_row_id(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_merged_calendar_rows(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_api_calendar_sync(uuid, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_event_library_stats(uuid, timestamptz) TO service_role;