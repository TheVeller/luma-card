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

export type CalendarLibrarySummary = {
  activeCalendars: number;
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
  library: CalendarLibrarySummary;
};

export function emptyLibrarySummary(): CalendarLibrarySummary {
  return {
    activeCalendars: 0,
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

export function summarizeCalendarLibrary(rows: LibraryRow[]): CalendarLibrarySummary {
  const summary = emptyLibrarySummary();
  const activeIdentities = new Set<string>();
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
    const identity = identityValue ? `${provider}:${identityValue}` : null;
    if (identity && activeIdentities.has(identity)) continue;
    if (identity) activeIdentities.add(identity);
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
    .select("id,calendar_id,calendar_url,provider_source_id,provider,ownership,merged_into_id,sync_status")
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
  return {
    library: emptyLibrarySummary(),
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

async function statsNeedLiveFallback(
  userId: string,
  persisted: EventLibraryStats | null,
  userClient?: UserSupabaseClient,
): Promise<boolean> {
  if (!persisted) return true;
  // The authenticated Settings view must reflect the current canonical rows,
  // not a potentially stale persisted RPC snapshot. The live query deduplicates
  // by canonical_event_id and is scoped by RLS to the signed-in user.
  if (userClient) return true;
  const client =
    userClient ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
  const { data, error } = await client
    .from("user_luma_calendars" as never)
    .select("id,source_kind,imported_count,sync_status,last_synced_at,source_metadata")
    .eq("user_id", userId)
    .is("merged_into_id", null);
  if (error) throw new Error(error.message);
  const statsByCalendar = new Map(
    persisted.calendars.map((calendar) => [calendar.calendarRowId, calendar]),
  );
  return (
    (
      data as Array<{
        id: string;
        source_kind: string | null;
        imported_count: number | null;
        sync_status: string | null;
        last_synced_at: string | null;
        source_metadata: { emptyConfirmed?: boolean } | null;
      }> | null
    )?.some((calendar) => {
      const stats = statsByCalendar.get(calendar.id);
      if ((calendar.imported_count ?? 0) > (stats?.total ?? 0)) return true;
      if (
        calendar.source_kind === "api" &&
        !calendar.source_metadata?.emptyConfirmed &&
        (!calendar.last_synced_at || !["completed", "partial"].includes(calendar.sync_status ?? ""))
      ) {
        return true;
      }
      return false;
    }) ?? false
  );
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
    generatedAt: new Date(now).toISOString(),
    ...summarizeEventCounts([...globalEvents.values()], now),
    calendars: [...eventsByCalendar].map(([calendarRowId, events]) => ({
      calendarRowId,
      ...summarizeEventCounts([...events.values()], now),
    })),
  };
}

async function readAuthenticatedLiveStats(
  userId: string,
  client: UserSupabaseClient,
): Promise<EventLibraryStats> {
  const { data: calendars, error: calendarError } = await client
    .from("user_luma_calendars" as never)
    .select("id")
    .eq("user_id", userId)
    .is("merged_into_id", null);
  if (calendarError) throw new Error(calendarError.message);
  const calendarRowIds = ((calendars as Array<{ id: string }> | null) ?? []).map(
    (calendar) => calendar.id,
  );
  if (calendarRowIds.length === 0) return emptyStats();
  const { data, error } = await client
    .from("event_sources" as never)
    .select("calendar_row_id,canonical_event_id,canonical_events!inner(id,start_at,end_at)")
    .eq("user_id", userId)
    .in("calendar_row_id", calendarRowIds);
  if (error) throw new Error(error.message);
  return summarizePersistedEventStats(
    calendarRowIds,
    (data as unknown as PersistedTimedSource[] | null) ?? [],
  );
}

async function readLiveStats(
  userId: string,
  userClient?: UserSupabaseClient,
): Promise<EventLibraryStats> {
  if (userClient) return readAuthenticatedLiveStats(userId, userClient);
  const { aggregateCanonicalEventsForUser } = await import("./events-aggregate.server");
  const { sourceRows } = await aggregateCanonicalEventsForUser(userId, {
    calendarId: "__all__",
  });
  const now = Date.now();
  return summarizeSourceEventStats(sourceRows, now);
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
  // Library counters and event counters always come from the same load, so the
  // UI can never show two disagreeing totals.
  const [library, persisted] = await Promise.all([
    readCalendarLibrarySummary(userId, userClient),
    readPersistedStats(userId, userClient),
  ]);
  if (!(await statsNeedLiveFallback(userId, persisted, userClient))) {
    return { ...(persisted ?? emptyStats()), library };
  }
  try {
    return { ...(await readLiveStats(userId, userClient)), library };
  } catch (error) {
    if (persisted) {
      console.warn("[event-stats] live fallback failed; using persisted counts", error);
      return { ...persisted, library };
    }
    throw error;
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
