import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canonicalizeEvents, type SourceEventInput } from "./canonical-events";
import { summarizeEventCounts } from "./event-time";

export type CalendarEventStats = {
  calendarRowId: string;
  total: number;
  upcoming: number;
  past: number;
  unknown: number;
};

export type EventLibraryStats = {
  generatedAt: string;
  total: number;
  upcoming: number;
  past: number;
  unknown: number;
  calendars: CalendarEventStats[];
};

function emptyStats(): EventLibraryStats {
  return {
    generatedAt: new Date().toISOString(),
    total: 0,
    upcoming: 0,
    past: 0,
    unknown: 0,
    calendars: [],
  };
}

const CACHE_TTL_MS = 30_000;
const statsCache = new Map<string, { expiresAt: number; value: Promise<EventLibraryStats> }>();

export function invalidateEventLibraryStatsCache(userId: string): void {
  statsCache.delete(userId);
}

async function readPersistedStats(userId: string): Promise<EventLibraryStats | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc(
    "get_event_library_stats" as never,
    { p_user_id: userId } as never,
  );
  if (error) {
    if (/schema cache|does not exist/i.test(error.message)) return null;
    throw new Error(error.message);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const value = data as unknown as Partial<EventLibraryStats>;
  return {
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
): Promise<boolean> {
  if (!persisted) return true;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
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

async function readLiveStats(userId: string): Promise<EventLibraryStats> {
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
    generatedAt: new Date(now).toISOString(),
    ...global,
    calendars: [...inputsByCalendar.entries()].map(([calendarRowId, inputs]) => ({
      calendarRowId,
      ...summarizeEventCounts(canonicalizeEvents(inputs), now),
    })),
  };
}

async function loadEventLibraryStats(userId: string): Promise<EventLibraryStats> {
  const persisted = await readPersistedStats(userId);
  if (!(await statsNeedLiveFallback(userId, persisted))) return persisted ?? emptyStats();
  try {
    return await readLiveStats(userId);
  } catch (error) {
    if (persisted) {
      console.warn("[event-stats] live fallback failed; using persisted counts", error);
      return persisted;
    }
    throw error;
  }
}

export async function readEventLibraryStats(userId: string): Promise<EventLibraryStats> {
  const now = Date.now();
  const cached = statsCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.value;
  const value = loadEventLibraryStats(userId).catch((error) => {
    statsCache.delete(userId);
    throw error;
  });
  statsCache.set(userId, { expiresAt: now + CACHE_TTL_MS, value });
  return value;
}

export const getEventLibraryStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => readEventLibraryStats(context.userId));
