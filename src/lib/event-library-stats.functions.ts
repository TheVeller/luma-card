import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { canonicalizeEvents, type SourceEventInput } from "./canonical-events";
import { summarizeEventCounts } from "./event-time";

export type CalendarEventStats = {
  calendarRowId: string;
  total: number;
  upcoming: number;
  past: number;
  unknown: number;
};

export type ProviderEventStats = {
  total: number;
  upcoming: number;
  past: number;
  unknown: number;
};

export type CalendarLibrarySummary = {
  totalCalendars: number;
  activeCalendars: number;
  duplicateCalendars: number;
  lumaConnected: number;
  lumaExternal: number;
  meetupExternal: number;
  otherProviders: number;
  mergedHidden: number;
  erroredSources: number;
};

export type EventLibraryStats = {
  generatedAt: string;
  total: number;
  upcoming: number;
  past: number;
  unknown: number;
  calendars: CalendarEventStats[];
  providers: Record<string, ProviderEventStats>;
  library: CalendarLibrarySummary;
};

export function emptyLibrarySummary(): CalendarLibrarySummary {
  return {
    totalCalendars: 0,
    activeCalendars: 0,
    duplicateCalendars: 0,
    lumaConnected: 0,
    lumaExternal: 0,
    meetupExternal: 0,
    otherProviders: 0,
    mergedHidden: 0,
    erroredSources: 0,
  };
}

function emptyStats(): EventLibraryStats {
  return {
    generatedAt: new Date().toISOString(),
    total: 0,
    upcoming: 0,
    past: 0,
    unknown: 0,
    calendars: [],
    providers: {},
    library: emptyLibrarySummary(),
  };
}

type LibraryRow = {
  id?: string;
  calendar_id?: string | null;
  calendar_url?: string | null;
  provider_source_id?: string | null;
  provider: string | null;
  ownership: string | null;
  merged_into_id: string | null;
  sync_status: string | null;
};

/**
 * Fallback summary used only when the database aggregate is unavailable.
 * Connected rows always win over an external duplicate of the same calendar,
 * otherwise a connected Luma calendar disappears from the breakdown.
 */
export function summarizeCalendarLibrary(rows: LibraryRow[]): CalendarLibrarySummary {
  const summary = emptyLibrarySummary();
  summary.totalCalendars = rows.length;
  const byIdentity = new Map<string, LibraryRow>();
  for (const row of rows) {
    if (row.merged_into_id) {
      summary.mergedHidden++;
      continue;
    }
    const provider = row.provider ?? "luma";
    const normalizedUrl = row.calendar_url
      ? row.calendar_url
          .trim()
          .toLowerCase()
          .replace(/^https?:\/\/(www\.)?/, "")
          .replace(/[?#].*$/, "")
          .replace(/\/+$/, "")
      : null;
    const identityValue = row.provider_source_id ?? normalizedUrl ?? row.calendar_id ?? row.id;
    const identity = `${provider}:${identityValue ?? Math.random()}`;
    const existing = byIdentity.get(identity);
    if (!existing) {
      byIdentity.set(identity, row);
      continue;
    }
    summary.duplicateCalendars++;
    if ((existing.ownership ?? "external") !== "connected" && row.ownership === "connected") {
      byIdentity.set(identity, row);
    }
  }
  for (const row of byIdentity.values()) {
    const provider = row.provider ?? "luma";
    summary.activeCalendars++;
    const connected = (row.ownership ?? "external") === "connected";
    if (provider === "luma") {
      if (connected) summary.lumaConnected++;
      else summary.lumaExternal++;
    } else if (provider === "meetup") {
      summary.meetupExternal++;
    } else {
      summary.otherProviders++;
    }
    if (["failed", "inaccessible"].includes(row.sync_status ?? "")) summary.erroredSources++;
  }
  return summary;
}

async function readCalendarLibrarySummary(
  userId: string,
  userClient?: UserSupabaseClient,
): Promise<CalendarLibrarySummary> {
  const client =
    userClient ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
  const { data, error } = await client
    .from("user_luma_calendars" as never)
    .select(
      "id,calendar_id,calendar_url,provider_source_id,provider,ownership,merged_into_id,sync_status",
    )
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return summarizeCalendarLibrary((data as unknown as LibraryRow[] | null) ?? []);
}

const CACHE_TTL_MS = 30_000;
const statsCache = new Map<string, { expiresAt: number; value: Promise<EventLibraryStats> }>();

export function invalidateEventLibraryStatsCache(userId: string): void {
  statsCache.delete(userId);
}

type UserSupabaseClient = SupabaseClient<Database>;

function normalizeProviders(value: unknown): Record<string, ProviderEventStats> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, Partial<ProviderEventStats>>).map(([key, stats]) => [
      key,
      {
        total: Number(stats?.total) || 0,
        upcoming: Number(stats?.upcoming) || 0,
        past: Number(stats?.past) || 0,
        unknown: Number(stats?.unknown) || 0,
      },
    ]),
  );
}

function normalizeLibrary(value: unknown): CalendarLibrarySummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const summary = emptyLibrarySummary();
  for (const key of Object.keys(summary) as (keyof CalendarLibrarySummary)[]) {
    summary[key] = Number(raw[key]) || 0;
  }
  return summary;
}

/**
 * Single source of truth. The database aggregate counts every canonical event
 * with one query; reading `event_sources` from the client instead silently
 * truncated the library at the Data API's 1000-row ceiling.
 */
async function readPersistedStats(
  userId: string,
  userClient?: UserSupabaseClient,
): Promise<EventLibraryStats | null> {
  const client =
    userClient ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
  const { data, error } = userClient
    ? await client.rpc("get_my_event_library_stats" as never)
    : await client.rpc("get_event_library_stats" as never, { p_user_id: userId } as never);
  if (error) {
    if (/schema cache|does not exist/i.test(error.message)) return null;
    throw new Error(error.message);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const value = data as unknown as Partial<EventLibraryStats>;
  const library = normalizeLibrary(value.library);
  if (!library) return null;
  return {
    library,
    providers: normalizeProviders(value.providers),
    generatedAt:
      typeof value.generatedAt === "string" ? value.generatedAt : new Date().toISOString(),
    total: Number(value.total) || 0,
    upcoming: Number(value.upcoming) || 0,
    past: Number(value.past) || 0,
    unknown: Number(value.unknown) || 0,
    calendars: Array.isArray(value.calendars)
      ? value.calendars.map((calendar) => ({
          calendarRowId: String(calendar.calendarRowId),
          total: Number(calendar.total) || 0,
          upcoming: Number(calendar.upcoming) || 0,
          past: Number(calendar.past) || 0,
          unknown: Number(calendar.unknown) || 0,
        }))
      : [],
  };
}

type PersistedTimedSource = {
  calendar_row_id: string | null;
  canonical_event_id: string;
  canonical_events:
    | { id: string; start_at: string | null; end_at: string | null }
    | Array<{ id: string; start_at: string | null; end_at: string | null }>;
};

export function summarizePersistedEventStats(
  calendarRowIds: string[],
  rows: PersistedTimedSource[],
  now = Date.now(),
): EventLibraryStats {
  const globalEvents = new Map<string, { startAt: string; endAt: string | null }>();
  const eventsByCalendar = new Map(
    calendarRowIds.map((calendarRowId) => [
      calendarRowId,
      new Map<string, { startAt: string; endAt: string | null }>(),
    ]),
  );
  for (const row of rows) {
    const event = Array.isArray(row.canonical_events)
      ? row.canonical_events[0]
      : row.canonical_events;
    if (!event) continue;
    const timed = { startAt: event.start_at ?? "", endAt: event.end_at };
    globalEvents.set(event.id || row.canonical_event_id, timed);
    if (row.calendar_row_id) {
      eventsByCalendar.get(row.calendar_row_id)?.set(event.id || row.canonical_event_id, timed);
    }
  }
  return {
    library: emptyLibrarySummary(),
    providers: {},
    generatedAt: new Date(now).toISOString(),
    ...summarizeEventCounts([...globalEvents.values()], now),
    calendars: [...eventsByCalendar].map(([calendarRowId, events]) => ({
      calendarRowId,
      ...summarizeEventCounts([...events.values()], now),
    })),
  };
}

async function readLiveStats(userId: string): Promise<EventLibraryStats> {
  const { aggregateCanonicalEventsForUser } = await import("./events-aggregate.server");
  const { sourceRows } = await aggregateCanonicalEventsForUser(userId, {
    calendarId: "__all__",
  });
  return summarizeSourceEventStats(sourceRows, Date.now());
}

export function summarizeSourceEventStats(
  sourceRows: SourceEventInput[],
  now = Date.now(),
): EventLibraryStats {
  const global = summarizeEventCounts(canonicalizeEvents(sourceRows), now);
  const inputsByCalendar = new Map<string, typeof sourceRows>();
  for (const input of sourceRows) {
    if (!input.calendarRowId) continue;
    const inputs = inputsByCalendar.get(input.calendarRowId) ?? [];
    inputs.push(input);
    inputsByCalendar.set(input.calendarRowId, inputs);
  }
  return {
    library: emptyLibrarySummary(),
    providers: {},
    generatedAt: new Date(now).toISOString(),
    ...global,
    calendars: [...inputsByCalendar.entries()].map(([calendarRowId, inputs]) => ({
      calendarRowId,
      ...summarizeEventCounts(canonicalizeEvents(inputs), now),
    })),
  };
}

async function loadEventLibraryStats(
  userId: string,
  userClient?: UserSupabaseClient,
): Promise<EventLibraryStats> {
  const persisted = await readPersistedStats(userId, userClient);
  if (persisted) return persisted;
  // Only reached while the aggregate function is being deployed.
  const library = await readCalendarLibrarySummary(userId, userClient);
  try {
    return { ...(await readLiveStats(userId)), library };
  } catch (error) {
    console.warn("[event-stats] live fallback failed", error);
    return { ...emptyStats(), library };
  }
}

export async function readEventLibraryStats(
  userId: string,
  userClient?: UserSupabaseClient,
): Promise<EventLibraryStats> {
  const now = Date.now();
  const cached = statsCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.value;
  const value = loadEventLibraryStats(userId, userClient).catch((error) => {
    statsCache.delete(userId);
    throw error;
  });
  statsCache.set(userId, { expiresAt: now + CACHE_TTL_MS, value });
  return value;
}

export const getEventLibraryStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => readEventLibraryStats(context.userId, context.supabase));
