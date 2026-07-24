// Shared server-only helpers for the external /api/v1 REST routes: Bearer auth,
// CORS, JSON responses, and opaque offset-cursor pagination.
//
// Server-only: route files (src/routes/api/v1/*) ship to the client bundle, so
// they must import THIS module dynamically inside their handlers, never at the
// top level (it transitively pulls node:crypto via api-tokens.server).
import { verifyApiToken } from "./api-tokens.server";

export const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, OPTIONS",
};

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...CORS,
    },
  });
}

/** Parse `Authorization: Bearer <token>` → owner, or null if missing/invalid/revoked. */
export async function authFromRequest(
  request: Request,
): Promise<{ userId: string; tokenId: string } | null> {
  const h = request.headers.get("authorization");
  if (!h || !h.startsWith("Bearer ")) return null;
  const raw = h.slice("Bearer ".length).trim();
  if (!raw) return null;
  return verifyApiToken(raw);
}

export function clampInt(v: string | null, def: number, min: number, max: number): number {
  if (v == null) return def;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

/** Decode a cursor to a non-negative offset. Returns 0 when absent, null when malformed. */
export function decodeCursor(v: string | null): number | null {
  if (v == null || v === "") return 0;
  try {
    const s = Buffer.from(v, "base64url").toString("utf8");
    const n = Number.parseInt(s, 10);
    if (!Number.isInteger(n) || n < 0) return null;
    return n;
  } catch {
    return null;
  }
}

/** True when a param is present but not a parseable date. */
export function isBadDate(v: string | null): boolean {
  if (v == null) return false;
  return Number.isNaN(Date.parse(v));
}
