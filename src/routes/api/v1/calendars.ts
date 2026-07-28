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
          const { readUserCalendars, readCalendarGroups } =
            await import("@/lib/user-luma-calendars.functions");
          const rows = await readUserCalendars(auth.userId);
          const groups = await readCalendarGroups(auth.userId);
          const { readCalendarAliases } = await import("@/lib/calendar-identity.server");
          const aliases = await readCalendarAliases(
            auth.userId,
            rows.map((row) => row.id),
          );
          const { readEventLibraryStats } = await import("@/lib/event-library-stats.functions");
          const eventStats = await readEventLibraryStats(auth.userId);
          const eventStatsByCalendar = new Map(
            eventStats.calendars.map((stats) => [stats.calendarRowId, stats]),
          );
          const groupById = new Map(groups.map((group) => [group.id, group]));
          return json(200, {
            groups: groups.map((group) => ({
              id: group.id,
              name: group.name,
              order: group.sort_order,
            })),
            calendars: rows
              .map((r) => {
                const group = r.group_id ? groupById.get(r.group_id) : null;
                const calendarStats = eventStatsByCalendar.get(r.id);
                const eventCount = calendarStats?.total ?? r.imported_count ?? 0;
                return {
                  id: r.calendar_id,
                  canonicalCalendarId: r.luma_calendar_id ?? null,
                  aliases: aliases.get(r.id) ?? [],
                  name: r.calendar_name,
                  slug: r.calendar_slug,
                  source: r.source ?? "api",
                  kind: r.source_kind ?? (r.source === "api" ? "api" : "calendar"),
                  sourceKind: r.source_kind ?? (r.source === "api" ? "api" : "calendar"),
                  provider: r.provider ?? "luma",
                  ownership: r.ownership ?? (r.source === "api" ? "connected" : "external"),
                  providerSourceId: r.provider_source_id ?? null,
                  brandKitId: r.brand_kit_id ?? null,
                  isDefault: r.is_default,
                  url: r.calendar_url,
                  avatarUrl: r.calendar_avatar_url,
                  coverUrl: r.calendar_cover_url,
                  description: r.calendar_description,
                  color: r.calendar_tint_color,
                  eventCount,
                  upcomingCount: calendarStats?.upcoming ?? 0,
                  pastCount: calendarStats?.past ?? 0,
                  unknownCount: calendarStats?.unknown ?? 0,
                  hasEvents: eventCount > 0,
                  order: r.sort_order ?? 0,
                  group: group ? { id: group.id, name: group.name, order: group.sort_order } : null,
                  curatedName: r.curated_name,
                  remoteName: r.remote_name,
                  suggestedGroup: r.suggested_group_name
                    ? {
                        name: r.suggested_group_name,
                        reason: r.suggested_group_reason,
                      }
                    : null,
                  sync: {
                    status: r.sync_status ?? "idle",
                    error: r.sync_error,
                    discovered: r.discovered_count ?? 0,
                    imported: eventCount,
                    lastSyncedAt: r.last_synced_at,
                    nextSyncAt: r.next_sync_at,
                  },
                };
              })
              .sort(
                (a, b) =>
                  (a.group?.order ?? Number.MAX_SAFE_INTEGER) -
                    (b.group?.order ?? Number.MAX_SAFE_INTEGER) ||
                  a.order - b.order ||
                  (a.name ?? "").localeCompare(b.name ?? ""),
              ),
          });
        } catch (err) {
          console.error("[/api/v1/calendars] failed", err);
          return json(500, { error: "server_error" });
        }
      },
    },
  },
});
