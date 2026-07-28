import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

export async function readEventLibraryStats(userId: string): Promise<EventLibraryStats> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc(
    "get_event_library_stats" as never,
    { p_user_id: userId } as never,
  );
  if (error) {
    if (/schema cache|does not exist/i.test(error.message)) return emptyStats();
    throw new Error(error.message);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return emptyStats();
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

export const getEventLibraryStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => readEventLibraryStats(context.userId));
