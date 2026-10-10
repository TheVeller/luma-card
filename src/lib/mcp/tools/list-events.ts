import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, loadCalendars, supabaseForUser } from "../supabase";

const COLUMNS =
  "id, name, url, cover_url, start_at, end_at, city, country_code, timezone, is_online, tags";

export default defineTool({
  name: "list_events",
  title: "List my events",
  description:
    "List the signed-in user's consolidated events across connected calendars, with filters for ownership, calendar, status, date range and name search. Paginate with cursor.",
  inputSchema: {
    mine: z.boolean().optional().describe("true = only calendars marked as mine; false = only others."),
    calendar_id: z.string().optional().describe("Restrict to one calendar (calendar_id from list_calendars)."),
    status: z.enum(["all", "upcoming", "past"]).optional().describe("upcoming includes ongoing events. Default all."),
    q: z.string().max(200).optional().describe("Case-insensitive search in event name."),
    from: z.string().datetime({ offset: true }).optional().describe("Only events starting at/after this ISO time."),
    to: z.string().datetime({ offset: true }).optional().describe("Only events starting before this ISO time."),
    limit: z.number().int().min(1).max(100).optional().describe("Page size (default 25)."),
    cursor: z.string().regex(/^\d+$/).optional().describe("nextCursor from a previous call."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ mine, calendar_id, status, q, from, to, limit, cursor }, ctx) => {
    if (!ctx.isAuthenticated()) return fail("Not authenticated");
    const sb = supabaseForUser(ctx);
    const pageSize = limit ?? 25;
    const offset = cursor ? Number(cursor) : 0;
    const now = new Date().toISOString();

    let rowIds: string[] | null = null;
    if (mine !== undefined || calendar_id) {
      const cals = await loadCalendars(sb);
      if (!cals.ok) return fail("Could not load calendars");
      rowIds = cals.rows
        .filter((c) => !calendar_id || c.calendar_id === calendar_id)
        .filter((c) => mine === undefined || c.is_mine === mine)
        .map((c) => c.id);
      if (rowIds.length === 0)
        return { content: [{ type: "text", text: "[]" }], structuredContent: { events: [], nextCursor: null } };
    }

    let query = rowIds
      ? sb.from("canonical_events").select(`${COLUMNS}, event_sources!inner(calendar_row_id)`, { count: "exact" }).in("event_sources.calendar_row_id", rowIds)
      : sb.from("canonical_events").select(COLUMNS, { count: "exact" });
    if (status === "upcoming") query = query.or(`start_at.gte.${now},end_at.gte.${now}`);
    if (status === "past") query = query.lt("start_at", now).or(`end_at.is.null,end_at.lt.${now}`);
    if (from) query = query.gte("start_at", from);
    if (to) query = query.lt("start_at", to);
    if (q) query = query.ilike("name", `%${q.replace(/[%_,()]/g, " ")}%`);
    query = query.order("start_at", { ascending: status !== "past", nullsFirst: false }).order("id");

    const { data, error, count } = await query.range(offset, offset + pageSize - 1);
    if (error) {
      console.error("list_events", error);
      return fail("Could not load events");
    }
    const seen = new Set<string>();
    const events = (data ?? [])
      .filter((e) => !seen.has(e.id) && seen.add(e.id))
      .map((e) => ({
        id: e.id,
        name: e.name,
        url: e.url,
        coverUrl: e.cover_url,
        startAt: e.start_at,
        endAt: e.end_at,
        city: e.city,
        countryCode: e.country_code,
        timezone: e.timezone,
        isOnline: e.is_online,
        tags: e.tags ?? [],
      }));
    const next = offset + (data?.length ?? 0);
    const nextCursor = count !== null && next < count ? String(next) : null;
    return {
      content: [{ type: "text", text: JSON.stringify({ events, nextCursor, total: count }, null, 2) }],
      structuredContent: { events, nextCursor, total: count ?? null },
    };
  },
});
