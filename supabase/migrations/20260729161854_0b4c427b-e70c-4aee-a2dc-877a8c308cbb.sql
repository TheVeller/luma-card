REVOKE ALL ON FUNCTION public.finalize_scoped_calendar_sync(
  uuid, uuid, timestamptz, text[], timestamptz, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_scoped_calendar_sync(
  uuid, uuid, timestamptz, text[], timestamptz, boolean
) TO service_role;