// GET /api/v1/calendars — external, token-authed. Lists the caller's linked
// calendars (Luma API + Firecrawl-scraped) with their source tag, so consumers
// can discover the `calendar` filter values for /api/v1/events.
//
//   Authorization: Bearer luma_sk_...
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/calendars")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { CORS } = await import("@/lib/api-v1.server");
        return new Response(null, { status: 204, headers: CORS });
      },
      GET: async ({ request }) => {
        const { json, authFromRequest } = await import("@/lib/api-v1.server");

        const authHeader = request.headers.get("authorization");
        if (!authHeader) return json(401, { error: "missing_token" });
        const auth = await authFromRequest(request);
        if (!auth) return json(401, { error: "invalid_token" });

        try {
          const { ensureOwnerCuratedCatalog } = await import("@/lib/calendar-sync.server");
          await ensureOwnerCuratedCatalog(auth.userId);
          const { readUserCalendars } = await import("@/lib/user-luma-calendars.functions");
          const rows = await readUserCalendars(auth.userId);
          return json(200, {
            calendars: rows.map((r) => ({
              id: r.calendar_id,
              name: r.calendar_name,
              slug: r.calendar_slug,
              source: r.source ?? "api",
              kind: r.source_kind ?? (r.source === "api" ? "api" : "calendar"),
              isDefault: r.is_default,
              url: r.calendar_url,
              curatedName: r.curated_name,
              remoteName: r.remote_name,
              sync: {
                status: r.sync_status ?? "idle",
                error: r.sync_error,
                discovered: r.discovered_count ?? 0,
                imported: r.imported_count ?? 0,
                lastSyncedAt: r.last_synced_at,
                nextSyncAt: r.next_sync_at,
              },
            })),
          });
        } catch (err) {
          console.error("[/api/v1/calendars] failed", err);
          return json(500, { error: "server_error" });
        }
      },
    },
  },
});
