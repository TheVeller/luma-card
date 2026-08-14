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
import type { CanonicalEventSourceDTO, EventEnrichment } from "@/lib/canonical-events";

export const Route = createFileRoute("/api/v1/events")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { CORS } = await import("@/lib/api-v1.server");
        return new Response(null, { status: 204, headers: CORS });
      },
      GET: async ({ request }) => {
        const {
          json,
          apiError,
          authFromRequest,
          requireScope,
          checkRateLimit,
          rateLimitHeaders,
          clampInt,
          decodeCursor,
          encodeCursor,
          isBadDate,
        } = await import("@/lib/api-v1.server");

        const authHeader = request.headers.get("authorization");
        if (!authHeader) return apiError(401, "missing_token", "Authorization header is required");
        const auth = await authFromRequest(request);
        if (!auth) return apiError(401, "invalid_token", "Token is invalid, revoked, or expired");
        const rateLimited = checkRateLimit(auth.tokenId);
        if (rateLimited) return rateLimited;
        const scopeError = requireScope(auth, "events:read");
        if (scopeError) return scopeError;

        const params = new URL(request.url).searchParams;
        const calendar = params.get("calendar") ?? "all";
        const provider = params.get("provider");
        const q = params.get("q")?.trim().toLowerCase() || null;
        const country = params.get("country")?.trim().toUpperCase() || null;
        const city = params.get("city")?.trim().toLowerCase() || null;
        const language = params.get("language")?.trim().toLowerCase() || null;
        const online = params.get("online");
        const format = params.get("format")?.trim().toLowerCase() || null;
        const topic = params.get("topic")?.trim().toLowerCase() || null;
        if (provider && !["luma", "eventbrite", "meetup"].includes(provider)) {
          return apiError(400, "bad_params", "provider must be luma, eventbrite, or meetup");
        }
        const mineParam = params.get("mine");
        if (mineParam && !["true", "false"].includes(mineParam)) {
          return apiError(400, "bad_params", "mine must be true or false");
        }
        const ownedParam = params.get("owned");
        if (ownedParam && !["true", "false"].includes(ownedParam)) {
          return apiError(400, "bad_params", "owned must be true or false");
        }
        if (online && !["true", "false"].includes(online)) {
          return apiError(400, "bad_params", "online must be true or false");
        }
        const mode = params.get("mode") ?? "canonical";
        if (mode !== "canonical" && mode !== "sources") {
          return apiError(400, "bad_params", "mode must be canonical or sources");
        }
        const status = params.get("status") ?? "all";
        if (!["all", "upcoming", "ongoing", "past"].includes(status)) {
          return apiError(400, "bad_params", "status must be all, upcoming, ongoing, or past");
        }
        const sort = params.get("sort") ?? "upcoming";
        if (!["upcoming", "start_asc", "start_desc"].includes(sort)) {
          return apiError(400, "bad_params", "sort must be upcoming, start_asc, or start_desc");
        }
        const from = params.get("from");
        const to = params.get("to");
        const at = params.get("at");
        if (isBadDate(from) || isBadDate(to) || isBadDate(at)) {
          return apiError(400, "bad_params", "at/from/to must be ISO dates");
        }
        const limit = clampInt(params.get("limit"), 100, 1, 200);
        const offset = decodeCursor(params.get("cursor"));
        if (offset === null) return apiError(400, "bad_params", "invalid cursor");

        const mineOwnership =
          mineParam === "true" ? "mine" : mineParam === "false" ? "not_mine" : "all";

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
              ? await aggregateEventsForUser(auth.userId, {
                  calendarId: calendar,
                  ownership: mineOwnership,
                  includePayload: false,
                })
              : await aggregateCanonicalEventsForUser(auth.userId, {
                  calendarId: calendar,
                  ownership: mineOwnership,
                  includePayload: false,
                });

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
          if (q) {
            filtered = filtered.filter((event) =>
              [event.name, event.description, event.city, event.url]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(q)),
            );
          }
          filtered = filtered.filter((event) => {
            const enrichment = (
              "enrichment" in event ? (event.enrichment ?? {}) : {}
            ) as EventEnrichment;
            const countryMatch = !country || enrichment.countryCode?.toUpperCase() === country;
            const cityMatch =
              !city ||
              event.city?.toLowerCase().includes(city) ||
              enrichment.region?.toLowerCase().includes(city);
            const languageMatch =
              !language ||
              enrichment.languageCode?.toLowerCase() === language ||
              enrichment.languages?.some((item) => item.toLowerCase() === language);
            const onlineMatch = !online || String(Boolean(enrichment.isOnline)) === online;
            const formatMatch = !format || enrichment.format?.toLowerCase() === format;
            const topicMatch =
              !topic ||
              enrichment.topics?.some(
                (item) => item.toLowerCase() === topic || item.toLowerCase().includes(topic),
              );
            return (
              countryMatch && cityMatch && languageMatch && onlineMatch && formatMatch && topicMatch
            );
          });
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

          return json(
            200,
            {
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
                  canonicalId: "canonicalId" in e ? (e.canonicalId ?? null) : null,
                  name: e.name,
                  coverUrl: e.coverUrl,
                  url: e.url,
                  startAt: e.startAt,
                  endAt: e.endAt ?? null,
                  temporalStatus: eventTemporalStatus(e, now),
                  durationMinutes: eventDurationMinutes(e),
                  city: e.city ?? null,
                  description: e.description ?? null,
                  timezone: "timezone" in e ? (e.timezone ?? null) : null,
                  enrichment: "enrichment" in e ? (e.enrichment ?? {}) : {},
                  updatedAt:
                    "sources" in e
                      ? ((e.sources as CanonicalEventSourceDTO[])
                          .map((source) => source.lastSyncedAt)
                          .sort()
                          .at(-1) ?? null)
                      : null,
                  externalIds: "externalIds" in e ? e.externalIds : null,
                  sources,
                  sourceCount: sources?.length ?? 1,
                  sourceCalendars,
                  tags: "tags" in e ? e.tags : [],
                  suggestedTags: "suggestedTags" in e ? e.suggestedTags : [],
                  tagDetails: "tagDetails" in e ? (e.tagDetails ?? []) : [],
                  calendar: primaryCalendar ?? sourceCalendars[0] ?? null,
                };
              }),
              page: { limit, offset, total, nextCursor },
              mode,
              filters: {
                calendar,
                provider,
                mine: mineParam,
                owned: ownedParam,
                status,
                at,
                from,
                to,
                q,
                country,
                city,
                language,
                online,
                format,
                topic,
              },
              sort,
              generatedAt: new Date(now).toISOString(),
            },
            rateLimitHeaders(auth.tokenId),
          );
        } catch (err) {
          console.error("[/api/v1/events] failed", err);
          return apiError(500, "server_error", "Unable to read events");
        }
      },
    },
  },
});
