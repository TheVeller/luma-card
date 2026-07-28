// Reusable, userId-scoped event aggregation across all of a user's calendars
// (Luma API `source='api'` + Firecrawl-scraped `source='scrape'`), with per-
// calendar failure isolation, dedupe, and a deterministic sort.
//
// This is the shared core behind both the internal `listEvents` server fn and
// the external `/api/v1/events` REST route. It takes an explicit `userId` and
// reads through the service-role client (bypasses RLS) — never touches an
// RLS-scoped request context — so it is safe to call from a token-authed HTTP
// handler that has no Supabase session.
import { fetchAllEvents, type LumaEvent } from "./luma.server";
import { resolveAllKeys, readUserCalendars } from "./user-luma-calendars.functions";
import { readScrapedEventsForCalendar } from "./luma-scrape.functions";
import {
  canonicalizeEvents,
  type CanonicalEventDTO,
  type SourceEventInput,
} from "./canonical-events";
import { compareEventsUpcomingFirst } from "./event-time";

export type EventDTO = {
  id: string;
  name: string;
  coverUrl: string | null;
  url: string;
  startAt: string;
  endAt?: string;
  city?: string;
  description?: string;
  calendarId?: string;
  calendarName?: string;
};

export function toDTO(e: LumaEvent, calendarId?: string, calendarName?: string): EventDTO {
  return {
    id: e.api_id,
    name: e.name,
    coverUrl: e.cover_url,
    url: e.url,
    startAt: e.start_at,
    endAt: e.end_at,
    city: e.geo_address_info?.city_state ?? undefined,
    description: e.description_md,
    calendarId,
    calendarName,
  };
}

type CalendarRow = Awaited<ReturnType<typeof readUserCalendars>>[number];

export type CalendarMeta = {
  calendarId: string; // public text id (row.calendar_id)
  name: string;
  slug: string | null;
  source: "api" | "scrape";
};

function metaFor(r: CalendarRow): CalendarMeta {
  return {
    calendarId: r.calendar_id,
    name: r.calendar_name ?? "Your calendar",
    slug: r.calendar_slug ?? null,
    source: (r.source ?? "api") as "api" | "scrape",
  };
}

export type AggregateResult = { events: EventDTO[]; calendars: CalendarMeta[] };

async function collectEventSourceInputsForUser(
  userId: string,
  opts: { calendarId?: string } = {},
): Promise<{ inputs: SourceEventInput[]; rows: CalendarRow[] }> {
  const allRows = await readUserCalendars(userId);
  const wantAll = !opts.calendarId || opts.calendarId === "all" || opts.calendarId === "__all__";
  const rows = wantAll ? allRows : allRows.filter((r) => r.calendar_id === opts.calendarId);

  const selectedRowIds = new Set(rows.map((r) => r.id));
  const keyed = await resolveAllKeys(userId);
  const apiResults = await Promise.all(
    keyed
      .filter(({ row }) => selectedRowIds.has(row.id))
      .map(async ({ key, row }) => {
        try {
          const events = await fetchAllEvents(key);
          return events.map((e) => ({
            event: toDTO(e, row.calendar_id, row.calendar_name ?? undefined),
            sourceType: "api" as const,
            calendarRowId: row.id,
            calendarId: row.calendar_id,
            calendarName: row.calendar_name ?? undefined,
            sourceUrl: e.url,
            externalEventId: e.api_id,
          }));
        } catch (e) {
          console.error(`[aggregate] calendar ${row.calendar_id} failed`, e);
          return [] as SourceEventInput[];
        }
      }),
  );

  const scrapedRows = rows.filter((r) => r.source === "scrape");
  const scrapedResults = await Promise.all(
    scrapedRows.map(async (r) => {
      const events = await readScrapedEventsForCalendar(
        userId,
        r.id,
        r.calendar_id,
        r.calendar_name ?? "Imported",
      );
      return events.map((event) => ({
        event,
        sourceType: "calendar_scrape" as const,
        calendarRowId: r.id,
        calendarId: r.calendar_id,
        calendarName: r.calendar_name ?? "Imported",
        sourceUrl: event.url,
        externalEventId: event.id,
      }));
    }),
  );

  return { inputs: [...apiResults, ...scrapedResults].flat(), rows };
}

/**
 * Aggregate events for a user across their calendars.
 * @param opts.calendarId  omit / "all" / "__all__" → every calendar; otherwise
 *                         restrict to the calendar whose public `calendar_id` matches.
 */
export async function aggregateEventsForUser(
  userId: string,
  opts: { calendarId?: string } = {},
): Promise<AggregateResult> {
  const { inputs, rows } = await collectEventSourceInputsForUser(userId, opts);

  // Merge + dedupe by `${calendarId}:${id}` (identical to legacy listEvents).
  const merged: EventDTO[] = [];
  const seen = new Set<string>();
  for (const { event } of inputs) {
    const k = `${event.calendarId}:${event.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(event);
  }

  const now = Date.now();
  merged.sort((a, b) => compareEventsUpcomingFirst(a, b, now));

  return { events: merged, calendars: rows.map(metaFor) };
}

export async function aggregateCanonicalEventsForUser(
  userId: string,
  opts: { calendarId?: string } = {},
): Promise<{
  events: CanonicalEventDTO[];
  calendars: CalendarMeta[];
  sourceRows: SourceEventInput[];
}> {
  const { inputs, rows } = await collectEventSourceInputsForUser(userId, opts);
  const events = canonicalizeEvents(inputs);
  const now = Date.now();
  events.sort((a, b) => compareEventsUpcomingFirst(a, b, now));
  return { events, calendars: rows.map(metaFor), sourceRows: inputs };
}
