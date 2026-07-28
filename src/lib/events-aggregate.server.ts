// Reusable, userId-scoped event aggregation across all of a user's calendars
// (Luma API `source='api'` + Firecrawl-scraped `source='scrape'`), with per-
// calendar failure isolation, dedupe, and a deterministic sort.
//
// This is the shared core behind both the internal `listEvents` server fn and
// the external `/api/v1/events` REST route. It takes an explicit `userId` and
// reads through the service-role client (bypasses RLS) — never touches an
// RLS-scoped request context — so it is safe to call from a token-authed HTTP
// handler that has no Supabase session.
import type { LumaEvent } from "./luma.server";
import { readUserCalendars } from "./user-luma-calendars.functions";
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
  canonicalCalendarId: string | null;
  name: string;
  slug: string | null;
  source: "api" | "scrape";
  sourceKind: "api" | "calendar" | "profile" | "event";
  provider: "luma" | "eventbrite" | "meetup";
  ownership: "connected" | "external";
};

function metaFor(r: CalendarRow): CalendarMeta {
  return {
    calendarId: r.calendar_id,
    canonicalCalendarId: r.luma_calendar_id ?? null,
    name: r.calendar_name ?? "Your calendar",
    slug: r.calendar_slug ?? null,
    source: (r.source ?? "api") as "api" | "scrape",
    sourceKind: r.source_kind ?? (r.source === "api" ? "api" : "calendar"),
    provider: r.provider ?? "luma",
    ownership: r.ownership ?? (r.source === "api" ? "connected" : "external"),
  };
}

export type AggregateResult = { events: EventDTO[]; calendars: CalendarMeta[] };

async function collectEventSourceInputsForUser(
  userId: string,
  opts: { calendarId?: string } = {},
): Promise<{ inputs: SourceEventInput[]; rows: CalendarRow[] }> {
  const allRows = await readUserCalendars(userId);
  const wantAll = !opts.calendarId || opts.calendarId === "all" || opts.calendarId === "__all__";
  const { resolveCanonicalCalendarRowId } = await import("./calendar-identity.server");
  const resolvedRowId = wantAll
    ? null
    : await resolveCanonicalCalendarRowId(userId, opts.calendarId);
  const rows = wantAll ? allRows : allRows.filter((r) => r.id === resolvedRowId);

  const rowById = new Map(rows.map((row) => [row.id, row]));
  const selectedRowIds = [...rowById.keys()];
  const canonicalInputs: SourceEventInput[] = [];
  if (selectedRowIds.length > 0) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("event_sources" as never)
      .select(
        "calendar_row_id,calendar_public_id,calendar_name,source_type,provider,source_url,external_event_id,provider_event_id,host_name,payload,last_synced_at,canonical_events!inner(id,luma_event_id,name,url,cover_url,start_at,end_at,city,description)",
      )
      .eq("user_id", userId)
      .in("calendar_row_id", selectedRowIds);
    if (error && !/schema cache|does not exist/i.test(error.message)) {
      throw new Error(error.message);
    }
    type PersistedSource = {
      calendar_row_id: string;
      calendar_public_id: string | null;
      calendar_name: string | null;
      source_type: SourceEventInput["sourceType"];
      provider: SourceEventInput["provider"];
      source_url: string;
      external_event_id: string | null;
      provider_event_id: string | null;
      host_name: string | null;
      payload: Record<string, unknown> | null;
      last_synced_at: string;
      canonical_events:
        | {
            id: string;
            luma_event_id: string | null;
            name: string;
            url: string;
            cover_url: string | null;
            start_at: string | null;
            end_at: string | null;
            city: string | null;
            description: string | null;
          }
        | Array<{
            id: string;
            luma_event_id: string | null;
            name: string;
            url: string;
            cover_url: string | null;
            start_at: string | null;
            end_at: string | null;
            city: string | null;
            description: string | null;
          }>;
    };
    for (const source of (data as unknown as PersistedSource[] | null) ?? []) {
      const canonical = Array.isArray(source.canonical_events)
        ? source.canonical_events[0]
        : source.canonical_events;
      const row = rowById.get(source.calendar_row_id);
      if (!canonical?.start_at || !row) continue;
      canonicalInputs.push({
        event: {
          id:
            source.provider_event_id ??
            source.external_event_id ??
            canonical.luma_event_id ??
            canonical.id,
          name: canonical.name,
          coverUrl: canonical.cover_url,
          url: canonical.url,
          startAt: canonical.start_at,
          endAt: canonical.end_at ?? undefined,
          city: canonical.city ?? undefined,
          description: canonical.description ?? undefined,
          calendarId: row.calendar_id,
          calendarName: row.calendar_name ?? undefined,
        },
        sourceType: source.source_type,
        provider: source.provider ?? row.provider ?? "luma",
        calendarRowId: row.id,
        calendarId: row.calendar_id,
        calendarName: row.calendar_name ?? undefined,
        sourceUrl: source.source_url,
        externalEventId: source.provider_event_id ?? source.external_event_id ?? undefined,
        hostName: source.host_name,
        payload: source.payload ?? {},
        lastSyncedAt: source.last_synced_at,
      });
    }
  }

  // Rolling deploy fallback for public sources that have not populated the
  // canonical tables yet. API calendars intentionally never fetch live here;
  // scheduled sync is the single ingestion path.
  const rowsWithoutCanonical = rows.filter(
    (row) => !canonicalInputs.some((input) => input.calendarRowId === row.id),
  );
  const scrapedResults = await Promise.all(
    rowsWithoutCanonical
      .filter((row) => row.source === "scrape")
      .map(async (r) => {
        const events = await readScrapedEventsForCalendar(
          userId,
          r.id,
          r.calendar_id,
          r.calendar_name ?? "Imported",
        );
        return events.map((event) => ({
          event,
          sourceType:
            r.provider === "eventbrite"
              ? r.ownership === "connected"
                ? ("eventbrite_api" as const)
                : ("eventbrite_public" as const)
              : r.provider === "meetup"
                ? r.ownership === "connected"
                  ? ("meetup_api" as const)
                  : ("meetup_public" as const)
                : ("calendar_scrape" as const),
          provider: r.provider ?? "luma",
          calendarRowId: r.id,
          calendarId: r.calendar_id,
          calendarName: r.calendar_name ?? "Imported",
          sourceUrl: event.url,
          externalEventId: event.id,
        }));
      }),
  );

  return { inputs: [...canonicalInputs, ...scrapedResults.flat()], rows };
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
