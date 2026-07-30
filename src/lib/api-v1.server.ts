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

const rateWindows = new Map<string, { resetAt: number; count: number }>();
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...CORS,
      ...headers,
    },
  });
}

/** Public, unauthenticated liveness response for integration checks. */
export function healthResponse(): Response {
  const requestId = `req_${crypto.randomUUID()}`;
  return json(
    200,
    { ok: true, service: "luma-card-event-router", apiVersion: "v1" },
    { "x-request-id": requestId },
  );
}

export function apiError(
  status: number,
  error: string,
  message: string,
  details: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  const requestId = `req_${crypto.randomUUID()}`;
  return json(
    status,
    { error, message, requestId, details },
    { "x-request-id": requestId, ...headers },
  );
}

export function checkRateLimit(tokenId: string): Response | null {
  const now = Date.now();
  const current = rateWindows.get(tokenId);
  const window =
    !current || current.resetAt <= now ? { resetAt: now + RATE_WINDOW_MS, count: 0 } : current;
  window.count++;
  rateWindows.set(tokenId, window);
  const headers = {
    "x-ratelimit-limit": String(RATE_LIMIT),
    "x-ratelimit-remaining": String(Math.max(0, RATE_LIMIT - window.count)),
    "x-ratelimit-reset": String(Math.ceil(window.resetAt / 1000)),
  };
  if (window.count > RATE_LIMIT) {
    return apiError(
      429,
      "rate_limited",
      "Too many requests",
      {},
      {
        ...headers,
        "retry-after": String(Math.ceil((window.resetAt - now) / 1000)),
      },
    );
  }
  return null;
}

export function rateLimitHeaders(tokenId: string): Record<string, string> {
  const current = rateWindows.get(tokenId);
  if (!current || current.resetAt <= Date.now()) return {};
  return {
    "x-ratelimit-limit": String(RATE_LIMIT),
    "x-ratelimit-remaining": String(Math.max(0, RATE_LIMIT - current.count)),
    "x-ratelimit-reset": String(Math.ceil(current.resetAt / 1000)),
  };
}

/** Parse `Authorization: Bearer <token>` → owner, or null if missing/invalid/revoked. */
export async function authFromRequest(
  request: Request,
): Promise<{ userId: string; tokenId: string; scopes: string[] } | null> {
  const h = request.headers.get("authorization");
  if (!h || !h.startsWith("Bearer ")) return null;
  const raw = h.slice("Bearer ".length).trim();
  if (!raw) return null;
  return verifyApiToken(raw);
}

export function requireScope(auth: { scopes: string[] }, scope: string): Response | null {
  return auth.scopes.includes(scope)
    ? null
    : apiError(403, "insufficient_scope", `Missing scope: ${scope}`);
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
