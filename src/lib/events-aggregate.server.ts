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
  type CanonicalTagDTO,
  type CanonicalEventSourceDTO,
  type CanonicalEventDTO,
  type EventEnrichment,
  type SourceEventInput,
} from "./canonical-events";
import { enrichEventForRouting } from "./event-routing-enrichment";
import { compareEventsUpcomingFirst } from "./event-time";

export type EventDTO = {
  id: string;
  canonicalId?: string;
  name: string;
  coverUrl: string | null;
  url: string;
  startAt: string;
  endAt?: string;
  city?: string;
  description?: string;
  calendarId?: string;
  calendarName?: string;
  timezone?: string | null;
  enrichment?: EventEnrichment;
  tags?: string[];
  suggestedTags?: string[];
  tagDetails?: CanonicalTagDTO[];
  sources?: CanonicalEventSourceDTO[];
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
  isMine: boolean;
};

export type OwnershipFilter = "all" | "mine" | "not_mine";

function isMineRow(r: CalendarRow): boolean {
  return (
    r.is_mine ?? (r.ownership ?? (r.source === "api" ? "connected" : "external")) === "connected"
  );
}

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
    isMine: isMineRow(r),
  };
}

export type AggregateResult = { events: EventDTO[]; calendars: CalendarMeta[] };

export type AggregateOptions = {
  calendarId?: string;
  includePayload?: boolean;
  slimDescription?: boolean;
  /** Restrict to calendars the user flagged as theirs (or explicitly not theirs). */
  ownership?: OwnershipFilter;
};

async function collectEventSourceInputsForUser(
  userId: string,
  opts: AggregateOptions = {},
): Promise<{ inputs: SourceEventInput[]; rows: CalendarRow[] }> {
  const allRows = await readUserCalendars(userId);
  const wantAll = !opts.calendarId || opts.calendarId === "all" || opts.calendarId === "__all__";
  const { resolveCanonicalCalendarRowId } = await import("./calendar-identity.server");
  const resolvedRowId = wantAll
    ? null
    : await resolveCanonicalCalendarRowId(userId, opts.calendarId);
  const scoped = wantAll ? allRows : allRows.filter((r) => r.id === resolvedRowId);
  const ownership = opts.ownership ?? "all";
  const rows =
    ownership === "all"
      ? scoped
      : scoped.filter((r) => (ownership === "mine" ? isMineRow(r) : !isMineRow(r)));

  const rowById = new Map(rows.map((row) => [row.id, row]));
  const selectedRowIds = [...rowById.keys()];
  const canonicalInputs: SourceEventInput[] = [];
  if (selectedRowIds.length > 0) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // `payload` is a fat jsonb blob only the sync/upsert path needs. List reads
    // skip it — it was the bulk of the bytes moved for 4k+ events.
    const withPayload = opts.includePayload !== false;
    const select =
      `calendar_row_id,calendar_public_id,calendar_name,source_type,provider,source_url,external_event_id,provider_event_id,host_name,${withPayload ? "payload," : ""}last_synced_at,` +
      "canonical_events!inner(id,luma_event_id,name,url,cover_url,start_at,end_at,city,description,timezone,language_code,country_code,region,venue_name,venue_address,latitude,longitude,is_online,event_format,topics,audience,level,enrichment)";
    // PostgREST caps a single response at 1000 rows; page explicitly so large
    // libraries are not silently truncated.
    const PAGE = 1000;
    const data: unknown[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data: page, error } = await supabaseAdmin
        .from("event_sources" as never)
        .select(select)
        .eq("user_id", userId)
        .in("calendar_row_id", selectedRowIds)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) {
        if (/schema cache|does not exist/i.test(error.message)) break;
        throw new Error(error.message);
      }
      const rowsPage = (page as unknown[] | null) ?? [];
      data.push(...rowsPage);
      if (rowsPage.length < PAGE) break;
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
            timezone: string | null;
            language_code: string | null;
            country_code: string | null;
            region: string | null;
            venue_name: string | null;
            venue_address: string | null;
            latitude: number | null;
            longitude: number | null;
            is_online: boolean | null;
            event_format: string | null;
            topics: string[] | null;
            audience: string[] | null;
            level: string | null;
            enrichment: Record<string, unknown> | null;
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
            timezone: string | null;
            language_code: string | null;
            country_code: string | null;
            region: string | null;
            venue_name: string | null;
            venue_address: string | null;
            latitude: number | null;
            longitude: number | null;
            is_online: boolean | null;
            event_format: string | null;
            topics: string[] | null;
            audience: string[] | null;
            level: string | null;
            enrichment: Record<string, unknown> | null;
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
          canonicalId: canonical.id,
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
          description:
            opts.slimDescription && canonical.description && canonical.description.length > 400
              ? `${canonical.description.slice(0, 400)}…`
              : (canonical.description ?? undefined),

          timezone: canonical.timezone,
          enrichment: {
            ...(canonical.enrichment ?? {}),
            languageCode: canonical.language_code,
            countryCode: canonical.country_code,
            region: canonical.region,
            venueName: canonical.venue_name,
            venueAddress: canonical.venue_address,
            latitude: canonical.latitude,
            longitude: canonical.longitude,
            isOnline: canonical.is_online,
            format: canonical.event_format,
            topics: canonical.topics ?? [],
            audience: canonical.audience ?? [],
            level: canonical.level,
          },
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
  opts: AggregateOptions = {},

): Promise<AggregateResult> {
  const { inputs, rows } = await collectEventSourceInputsForUser(userId, opts);

  // Merge + dedupe by `${calendarId}:${id}` (identical to legacy listEvents).
  const merged: EventDTO[] = [];
  const seen = new Set<string>();
  for (const { event } of inputs) {
    const k = `${event.calendarId}:${event.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push({
      ...event,
      enrichment: enrichEventForRouting({
        event,
        calendarNames: event.calendarName ? [event.calendarName] : [],
      }),
    });
  }

  const now = Date.now();
  merged.sort((a, b) => compareEventsUpcomingFirst(a, b, now));

  return { events: merged, calendars: rows.map(metaFor) };
}

export async function aggregateCanonicalEventsForUser(
  userId: string,
  opts: AggregateOptions = {},
): Promise<{
  events: CanonicalEventDTO[];
  calendars: CalendarMeta[];
  sourceRows: SourceEventInput[];
}> {
  const { inputs, rows } = await collectEventSourceInputsForUser(userId, opts);
  const events = canonicalizeEvents(inputs);
  for (const event of events) {
    event.enrichment = enrichEventForRouting({
      event,
      calendarNames: event.sources.flatMap((source) =>
        source.calendarName ? [source.calendarName] : [],
      ),
    });
  }
  const canonicalIds = events
    .map((event) => event.canonicalId)
    .filter((id): id is string => Boolean(id));
  if (canonicalIds.length > 0) {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin
        .from("canonical_event_tags" as never)
        .select(
          "canonical_event_id,tag_id,origin,state,confidence,classifier_version,event_tag_definitions(namespace,slug,label,taxonomy_version)",
        )
        .eq("user_id", userId)
        .in("canonical_event_id", canonicalIds);
      const byEvent = new Map<string, CanonicalTagDTO[]>();
      for (const row of (data as Array<Record<string, unknown>> | null) ?? []) {
        const definition = Array.isArray(row.event_tag_definitions)
          ? (row.event_tag_definitions[0] as Record<string, unknown> | undefined)
          : (row.event_tag_definitions as Record<string, unknown> | null);
        if (!definition) continue;
        const detail: CanonicalTagDTO = {
          namespace: String(definition.namespace) as CanonicalTagDTO["namespace"],
          slug: String(definition.slug),
          label: String(definition.label),
          origin: String(row.origin) as CanonicalTagDTO["origin"],
          state: String(row.state) as CanonicalTagDTO["state"],
          confidence: typeof row.confidence === "number" ? row.confidence : null,
          taxonomyVersion: Number(definition.taxonomy_version ?? row.classifier_version ?? 1),
        };
        const current = byEvent.get(String(row.canonical_event_id)) ?? [];
        current.push(detail);
        byEvent.set(String(row.canonical_event_id), current);
      }
      for (const event of events) {
        const details = event.canonicalId ? (byEvent.get(event.canonicalId) ?? []) : [];
        event.tagDetails = details;
        event.tags = details.filter((tag) => tag.state === "active").map((tag) => tag.label);
        event.suggestedTags = details
          .filter((tag) => tag.state === "dismissed" && tag.origin === "system")
          .map((tag) => tag.label);
      }
    } catch (error) {
      if (
        !/schema cache|does not exist/i.test(error instanceof Error ? error.message : String(error))
      ) {
        throw error;
      }
    }
  }
  const now = Date.now();
  events.sort((a, b) => compareEventsUpcomingFirst(a, b, now));
  return { events, calendars: rows.map(metaFor), sourceRows: inputs };
}
