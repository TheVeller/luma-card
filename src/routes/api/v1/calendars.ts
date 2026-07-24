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
          const { readUserCalendars } = await import("@/lib/user-luma-calendars.functions");
          const rows = await readUserCalendars(auth.userId);
          return json(200, {
            calendars: rows.map((r) => ({
              id: r.calendar_id,
              name: r.calendar_name,
              slug: r.calendar_slug,
              source: r.source ?? "api",
              isDefault: r.is_default,
              url: r.calendar_url,
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
