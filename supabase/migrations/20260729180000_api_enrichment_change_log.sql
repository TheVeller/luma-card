-- Enriched canonical event fields and an append-only feed for external indexes.
ALTER TABLE public.api_tokens
  ADD COLUMN IF NOT EXISTS scopes text[] NOT NULL DEFAULT ARRAY['events:read','calendars:read','changes:read'],
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

ALTER TABLE public.canonical_events
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS language_code text,
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS venue_name text,
  ADD COLUMN IF NOT EXISTS venue_address text,
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS is_online boolean,
  ADD COLUMN IF NOT EXISTS event_format text,
  ADD COLUMN IF NOT EXISTS topics text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS audience text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS level text,
  ADD COLUMN IF NOT EXISTS enrichment jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS enrichment_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS enriched_at timestamptz;

CREATE TABLE IF NOT EXISTS public.event_change_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  canonical_event_id uuid,
  operation text NOT NULL CHECK (operation IN ('upsert', 'delete')),
  event_snapshot jsonb,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_change_log_user_cursor_idx
  ON public.event_change_log (user_id, id);
CREATE INDEX IF NOT EXISTS event_change_log_user_changed_idx
  ON public.event_change_log (user_id, changed_at);

ALTER TABLE public.event_change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own event changes" ON public.event_change_log;
CREATE POLICY "Users read own event changes"
  ON public.event_change_log FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
GRANT SELECT ON public.event_change_log TO authenticated;
GRANT ALL ON public.event_change_log TO service_role;

CREATE OR REPLACE FUNCTION public.log_canonical_event_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.event_change_log(user_id, canonical_event_id, operation, event_snapshot)
    VALUES (OLD.user_id, OLD.id, 'delete', NULL);
    RETURN OLD;
  END IF;
  INSERT INTO public.event_change_log(user_id, canonical_event_id, operation, event_snapshot)
  VALUES (NEW.user_id, NEW.id, 'upsert', to_jsonb(NEW));
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS canonical_event_change_log_trg ON public.canonical_events;
CREATE TRIGGER canonical_event_change_log_trg
AFTER INSERT OR UPDATE OR DELETE ON public.canonical_events
FOR EACH ROW EXECUTE FUNCTION public.log_canonical_event_change();

REVOKE ALL ON FUNCTION public.log_canonical_event_change() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_canonical_event_change() TO service_role;
