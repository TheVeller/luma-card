-- Per-user API tokens for the external /api/v1 calendar router.
-- Tokens are shown once at creation; only a SHA-256 hash is stored.
-- The external route looks up by hash via the service-role client (bypasses RLS);
-- RLS below only governs a user managing their own tokens from the app.
CREATE TABLE public.api_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_prefix TEXT NOT NULL,          -- plaintext, for display (e.g. luma_sk_AbCd1234)
  token_hash TEXT NOT NULL,            -- sha256 hex of the raw token
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX api_tokens_user_idx ON public.api_tokens (user_id, created_at DESC);
CREATE UNIQUE INDEX api_tokens_hash_idx ON public.api_tokens (token_hash);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_tokens TO authenticated;
GRANT ALL ON public.api_tokens TO service_role;

ALTER TABLE public.api_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own api tokens"
  ON public.api_tokens
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
