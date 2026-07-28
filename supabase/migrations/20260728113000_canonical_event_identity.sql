ALTER TABLE public.canonical_events
  ADD COLUMN IF NOT EXISTS identity_fingerprint text;

CREATE INDEX IF NOT EXISTS canonical_events_user_identity_idx
  ON public.canonical_events (user_id, identity_fingerprint)
  WHERE identity_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS canonical_events_user_url_idx
  ON public.canonical_events (user_id, url);
