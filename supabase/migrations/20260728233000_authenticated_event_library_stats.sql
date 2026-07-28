-- User-facing event counts do not need the service-role key. This wrapper
-- derives the owner from the authenticated JWT, so callers cannot request
-- another user's library through the SECURITY DEFINER aggregate.
CREATE OR REPLACE FUNCTION public.get_my_event_library_stats(
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_event_library_stats(auth.uid(), p_at)
  WHERE auth.uid() IS NOT NULL
$$;

REVOKE ALL ON FUNCTION public.get_my_event_library_stats(timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_event_library_stats(timestamptz)
  TO authenticated, service_role;
