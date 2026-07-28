// GET /api/v1/events — external, token-authed. Returns the caller's events
// combined across every calendar (Luma API + Firecrawl-scraped), each tagged
// with its source calendar. Live passthrough: reuses aggregateEventsForUser.
//
//   Authorization: Bearer luma_sk_...
//   ?calendar=<calendar_id|all>  ?mode=<canonical|sources>
//   ?status=<all|upcoming|ongoing|past>
//   ?sort=<upcoming|start_asc|start_desc>
//   ?at=<ISO>  ?from=<ISO>  ?to=<ISO>  ?limit=1..200  ?cursor=<opaque>
//
// Server-only helpers are imported dynamically inside the handlers because this
// route file ships to the client bundle.
import { createFileRoute } from "@tanstack/react-router";
import type { CanonicalEventSourceDTO } from "@/lib/canonical-events";

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
        const provider = params.get("provider");
        if (provider && !["luma", "eventbrite", "meetup"].includes(provider)) {
          return json(400, {
            error: "bad_params",
            detail: "provider must be luma, eventbrite, or meetup",
          });
        }
        const ownedParam = params.get("owned");
        if (ownedParam && !["true", "false"].includes(ownedParam)) {
          return json(400, { error: "bad_params", detail: "owned must be true or false" });
        }
        const mode = params.get("mode") ?? "canonical";
        if (mode !== "canonical" && mode !== "sources") {
          return json(400, { error: "bad_params", detail: "mode must be canonical or sources" });
        }
        const status = params.get("status") ?? "all";
        if (!["all", "upcoming", "ongoing", "past"].includes(status)) {
          return json(400, {
            error: "bad_params",
            detail: "status must be all, upcoming, ongoing, or past",
          });
        }
        const sort = params.get("sort") ?? "upcoming";
        if (!["upcoming", "start_asc", "start_desc"].includes(sort)) {
          return json(400, {
            error: "bad_params",
            detail: "sort must be upcoming, start_asc, or start_desc",
          });
        }
        const from = params.get("from");
        const to = params.get("to");
        const at = params.get("at");
        if (isBadDate(from) || isBadDate(to) || isBadDate(at)) {
          return json(400, { error: "bad_params", detail: "at/from/to must be ISO dates" });
        }
        const limit = clampInt(params.get("limit"), 100, 1, 200);
        const offset = decodeCursor(params.get("cursor"));
        if (offset === null) return json(400, { error: "bad_params", detail: "invalid cursor" });

        try {
          const { aggregateCanonicalEventsForUser, aggregateEventsForUser } =
            await import("@/lib/events-aggregate.server");
          const {
            compareEventsStartAsc,
            compareEventsStartDesc,
            compareEventsUpcomingFirst,
            eventDurationMinutes,
            eventTemporalStatus,
          } = await import("@/lib/event-time");
          const { events, calendars } =
            mode === "sources"
              ? await aggregateEventsForUser(auth.userId, { calendarId: calendar })
              : await aggregateCanonicalEventsForUser(auth.userId, { calendarId: calendar });
          const calById = new Map(calendars.map((c) => [c.calendarId, c]));
          const now = at ? Date.parse(at) : Date.now();

          const fromTs = from ? Date.parse(from) : null;
          const toTs = to ? Date.parse(to) : null;
          let filtered = events;
          if (provider) {
            filtered = filtered.filter((event) => {
              const sources =
                "sources" in event ? (event.sources as CanonicalEventSourceDTO[]) : null;
              if (sources) {
                return sources.some((source) => source.provider === provider);
              }
              const calendarMeta = event.calendarId ? calById.get(event.calendarId) : null;
              return calendarMeta?.provider === provider;
            });
          }
          if (ownedParam) {
            const wanted = ownedParam === "true";
            filtered = filtered.filter((event) => {
              const sources =
                "sources" in event ? (event.sources as CanonicalEventSourceDTO[]) : null;
              const ids = sources
                ? sources
                    .map((source) => source.calendarId)
                    .filter((id): id is string => Boolean(id))
                : event.calendarId
                  ? [event.calendarId]
                  : [];
              const hasOwnedSource = ids.some((id) => calById.get(id)?.ownership === "connected");
              return wanted ? hasOwnedSource : !hasOwnedSource;
            });
          }
          if (fromTs !== null) filtered = filtered.filter((e) => Date.parse(e.startAt) >= fromTs);
          if (toTs !== null) filtered = filtered.filter((e) => Date.parse(e.startAt) <= toTs);
          if (status !== "all") {
            filtered = filtered.filter((event) => {
              const temporalStatus = eventTemporalStatus(event, now);
              return status === "upcoming"
                ? temporalStatus === "upcoming" || temporalStatus === "ongoing"
                : temporalStatus === status;
            });
          }
          filtered = [...filtered].sort((a, b) => {
            if (sort === "start_asc") return compareEventsStartAsc(a, b);
            if (sort === "start_desc") return compareEventsStartDesc(a, b);
            return compareEventsUpcomingFirst(a, b, now);
          });

          const total = filtered.length;
          const page = filtered.slice(offset, offset + limit);
          const nextCursor = offset + limit < total ? encodeCursor(offset + limit) : null;

          return json(200, {
            events: page.map((e) => {
              const sources = "sources" in e ? (e.sources as CanonicalEventSourceDTO[]) : null;
              const sourceCalendars = [
                ...new Set(
                  (sources ?? [])
                    .map((source) => source.calendarId)
                    .filter((id): id is string => Boolean(id)),
                ),
              ]
                .map((id) => calById.get(id))
                .filter(Boolean);
              const primaryCalendar = (e.calendarId && calById.get(e.calendarId)) || null;
              return {
                id: e.id,
                name: e.name,
                coverUrl: e.coverUrl,
                url: e.url,
                startAt: e.startAt,
                endAt: e.endAt ?? null,
                temporalStatus: eventTemporalStatus(e, now),
                durationMinutes: eventDurationMinutes(e),
                city: e.city ?? null,
                description: e.description ?? null,
                externalIds: "externalIds" in e ? e.externalIds : null,
                sources,
                sourceCount: sources?.length ?? 1,
                sourceCalendars,
                tags: "tags" in e ? e.tags : [],
                suggestedTags: "suggestedTags" in e ? e.suggestedTags : [],
                calendar: primaryCalendar ?? sourceCalendars[0] ?? null,
              };
            }),
            page: { limit, offset, total, nextCursor },
            mode,
            filters: { calendar, provider, owned: ownedParam, status, at, from, to },
            sort,
            generatedAt: new Date(now).toISOString(),
          });
        } catch (err) {
          console.error("[/api/v1/events] failed", err);
          return json(500, { error: "server_error" });
        }
      },
    },
  },
});
