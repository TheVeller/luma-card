// GET /api/v1/events — external, token-authed. Returns the caller's events
// combined across every calendar (Luma API + Firecrawl-scraped), each tagged
// with its source calendar. Live passthrough: reuses aggregateEventsForUser.
//
//   Authorization: Bearer luma_sk_...
//   ?calendar=<calendar_id|all>  ?mode=<canonical|sources>
//   ?from=<ISO>  ?to=<ISO>  ?limit=1..200  ?cursor=<opaque>
//
// Server-only helpers are imported dynamically inside the handlers because this
// route file ships to the client bundle.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/events")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { CORS } = await import("@/lib/api-v1.server");
        return new Response(null, { status: 204, headers: CORS });
      },
      GET: async ({ request }) => {
        const { json, authFromRequest, clampInt, decodeCursor, encodeCursor, isBadDate } =
          await import("@/lib/api-v1.server");

        const authHeader = request.headers.get("authorization");
        if (!authHeader) return json(401, { error: "missing_token" });
        const auth = await authFromRequest(request);
        if (!auth) return json(401, { error: "invalid_token" });

        const params = new URL(request.url).searchParams;
        const calendar = params.get("calendar") ?? "all";
        const mode = params.get("mode") ?? "canonical";
        if (mode !== "canonical" && mode !== "sources") {
          return json(400, { error: "bad_params", detail: "mode must be canonical or sources" });
        }
        const from = params.get("from");
        const to = params.get("to");
        if (isBadDate(from) || isBadDate(to)) {
          return json(400, { error: "bad_params", detail: "from/to must be ISO dates" });
        }
        const limit = clampInt(params.get("limit"), 100, 1, 200);
        const offset = decodeCursor(params.get("cursor"));
        if (offset === null) return json(400, { error: "bad_params", detail: "invalid cursor" });

        try {
          const { aggregateCanonicalEventsForUser, aggregateEventsForUser } =
            await import("@/lib/events-aggregate.server");
          const { events, calendars } =
            mode === "sources"
              ? await aggregateEventsForUser(auth.userId, { calendarId: calendar })
              : await aggregateCanonicalEventsForUser(auth.userId, { calendarId: calendar });
          const calById = new Map(calendars.map((c) => [c.calendarId, c]));

          const fromTs = from ? Date.parse(from) : null;
          const toTs = to ? Date.parse(to) : null;
          let filtered = events;
          if (fromTs !== null) filtered = filtered.filter((e) => Date.parse(e.startAt) >= fromTs);
          if (toTs !== null) filtered = filtered.filter((e) => Date.parse(e.startAt) <= toTs);

          const total = filtered.length;
          const page = filtered.slice(offset, offset + limit);
          const nextCursor = offset + limit < total ? encodeCursor(offset + limit) : null;

          return json(200, {
            events: page.map((e) => ({
              id: e.id,
              name: e.name,
              coverUrl: e.coverUrl,
              url: e.url,
              startAt: e.startAt,
              endAt: e.endAt ?? null,
              city: e.city ?? null,
              description: e.description ?? null,
              externalIds: "externalIds" in e ? e.externalIds : null,
              sources: "sources" in e ? e.sources : null,
              tags: "tags" in e ? e.tags : [],
              calendar: (e.calendarId && calById.get(e.calendarId)) || null,
            })),
            page: { limit, offset, total, nextCursor },
            mode,
          });
        } catch (err) {
          console.error("[/api/v1/events] failed", err);
          return json(500, { error: "server_error" });
        }
      },
    },
  },
});
