import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

type EventRow = {
  id: string;
  name: string;
  url: string;
  cover_url: string | null;
  start_at: string | null;
  end_at: string | null;
  city: string | null;
  timezone: string | null;
};

export default defineTool({
  name: "list_events",
  title: "List my events",
  description:
    "List the signed-in user's consolidated (canonical) events across all connected calendars. Filter by mine (only events from calendars marked as the user's own), calendar_id, or temporal status.",
  inputSchema: {
    mine: z
      .boolean()
      .optional()
      .describe("true = only events from calendars marked as mine; false = only from calendars not marked as mine."),
    calendar_id: z
      .string()
      .optional()
      .describe("Restrict to a single calendar (its public calendar_id from list_calendars)."),
    status: z
      .enum(["all", "upcoming", "ongoing", "past"])
      .optional()
      .describe("Temporal status filter (default all)."),
    limit: z.number().int().min(1).max(100).optional().describe("Max events (default 25)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ mine, calendar_id, status, limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const sb = supabaseForUser(ctx);

    const { data: calendars, error: calError } = await sb
      .from("user_luma_calendars")
      .select("id, calendar_id, calendar_name, ownership, is_mine")
      .is("merged_into_id", null);
    if (calError) return { content: [{ type: "text", text: calError.message }], isError: true };

    let rows = (calendars ?? []).map((c) => ({
      ...c,
      is_mine: c.is_mine ?? c.ownership === "connected",
    }));
    if (calendar_id) rows = rows.filter((c) => c.calendar_id === calendar_id);
    if (mine !== undefined) rows = rows.filter((c) => (mine ? c.is_mine : !c.is_mine));
    const rowIds = rows.map((c) => c.id);
    if (rowIds.length === 0) {
      return {
        content: [{ type: "text", text: "[]" }],
        structuredContent: { events: [] },
      };
    }
    const calByRowId = new Map(rows.map((c) => [c.id, c]));

    const { data: sources, error: srcError } = await sb
      .from("event_sources")
      .select(
        "canonical_event_id, calendar_row_id, provider, canonical_events(id, name, url, cover_url, start_at, end_at, city, timezone)",
      )
      .in("calendar_row_id", rowIds);
    if (srcError) return { content: [{ type: "text", text: srcError.message }], isError: true };

    const now = Date.now();
    const byId = new Map<string, { event: EventRow; calendars: Set<string>; providers: Set<string> }>();
    for (const source of sources ?? []) {
      const event = (source as { canonical_events?: EventRow | null }).canonical_events;
      if (!event) continue;
      const entry = byId.get(event.id) ?? {
        event,
        calendars: new Set<string>(),
        providers: new Set<string>(),
      };
      const cal = source.calendar_row_id ? calByRowId.get(source.calendar_row_id) : null;
      if (cal) entry.calendars.add(cal.calendar_name ?? cal.calendar_id);
      if (source.provider) entry.providers.add(source.provider);
      byId.set(event.id, entry);
    }

    const statusOf = (e: EventRow) => {
      const start = e.start_at ? Date.parse(e.start_at) : null;
      const end = e.end_at ? Date.parse(e.end_at) : null;
      if (start === null) return "unknown";
      if (end !== null && start <= now && now <= end) return "ongoing";
      return start > now ? "upcoming" : "past";
    };

    let events = [...byId.values()].map((entry) => ({
      id: entry.event.id,
      name: entry.event.name,
      url: entry.event.url,
      coverUrl: entry.event.cover_url,
      startAt: entry.event.start_at,
      endAt: entry.event.end_at,
      city: entry.event.city,
      timezone: entry.event.timezone,
      status: statusOf(entry.event),
      calendars: [...entry.calendars],
      providers: [...entry.providers],
    }));

    const wanted = status ?? "all";
    if (wanted !== "all") {
      events = events.filter((e) =>
        wanted === "upcoming"
          ? e.status === "upcoming" || e.status === "ongoing"
          : e.status === wanted,
      );
    }
    events.sort((a, b) => {
      const at = a.startAt ? Date.parse(a.startAt) : Number.POSITIVE_INFINITY;
      const bt = b.startAt ? Date.parse(b.startAt) : Number.POSITIVE_INFINITY;
      return at - bt;
    });
    events = events.slice(0, limit ?? 25);

    return {
      content: [{ type: "text", text: JSON.stringify(events, null, 2) }],
      structuredContent: { events },
    };
  },
});
