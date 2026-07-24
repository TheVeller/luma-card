// Server-only helpers for external API tokens (see supabase/migrations/*_api_tokens.sql).
// The raw token IS the high-entropy secret; we store only its SHA-256 hash, so a DB
// read never exposes a usable token. No encryption key needed (unlike crypto.server.ts,
// which must *decrypt* Luma keys). Token format: `luma_sk_<43-char base64url>`.
//
// Server-only: keep node:crypto out of the client bundle by importing this module
// dynamically from *.functions.ts / route files (top-level import is fine from other
// *.server.ts modules).
import { randomBytes, createHash } from "node:crypto";

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateToken(): { raw: string; prefix: string; hash: string } {
  const raw = "luma_sk_" + randomBytes(32).toString("base64url");
  return { raw, prefix: raw.slice(0, 16), hash: hashToken(raw) };
}

/**
 * Resolve a raw Bearer token to its owner. Returns null for unknown, malformed,
 * or revoked tokens. Bumps last_used_at on success.
 */
export async function verifyApiToken(
  raw: string,
): Promise<{ userId: string; tokenId: string } | null> {
  if (!raw || !raw.startsWith("luma_sk_")) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const hash = hashToken(raw);
  const { data } = await supabaseAdmin
    .from("api_tokens" as never)
    .select("id, user_id, revoked_at")
    .eq("token_hash", hash)
    .maybeSingle();
  const r = data as { id: string; user_id: string; revoked_at: string | null } | null;
  if (!r || r.revoked_at) return null;
  await supabaseAdmin
    .from("api_tokens" as never)
    .update({ last_used_at: new Date().toISOString() } as never)
    .eq("id", r.id);
  return { userId: r.user_id, tokenId: r.id };
}
