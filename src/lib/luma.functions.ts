// User-scoped Luma read APIs. Every call resolves the Luma API key from the
// signed-in user's calendars. Supports selecting a specific calendar by id
// or the "__all__" sentinel to fan out to every linked calendar.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { fetchEvent } from "./luma.server";
import { resolveUserLumaKey } from "./user-luma-key.functions";
import { resolveAllKeys, readUserCalendars } from "./user-luma-calendars.functions";
import { readScrapedEventById } from "./luma-scrape.functions";
import { aggregateCanonicalEventsForUser, toDTO, type EventDTO } from "./events-aggregate.server";

// Re-exported for callers that import the DTO shape from this module.
export type { EventDTO };

class NoLumaKeyError extends Error {
  constructor() {
    super("NO_LUMA_KEY");
  }
}

const ListInput = z.object({ calendarId: z.string().optional() }).optional();

export const listEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListInput.parse(d) ?? {})
  .handler(async ({ data, context }): Promise<EventDTO[]> => {
    const calendarId = data?.calendarId;
    const allRows = await readUserCalendars(context.userId);
    const { resolveCanonicalCalendarRowId } = await import("./calendar-identity.server");
    const resolvedRowId =
      calendarId && calendarId !== "__all__"
        ? await resolveCanonicalCalendarRowId(context.userId, calendarId)
        : null;

    // Combined view: fan out across every linked calendar + scraped ones.
    // Shared with the external /api/v1/events route via aggregateEventsForUser.
    if (calendarId === "__all__") {
      if (allRows.length === 0) return [];
      const { events } = await aggregateCanonicalEventsForUser(context.userId, {
        calendarId: "__all__",
      });
      return events;
    }

    if (allRows.length === 0) return [];

    // Specific calendars are served from the canonical cache. Scheduled sync
    // is the only path that spends provider API calls.
    const row = calendarId
      ? allRows.find((r) => r.id === resolvedRowId)
      : (allRows.find((r) => r.is_default) ?? allRows[0]);
    if (!row) throw new NoLumaKeyError();
    const { events } = await aggregateCanonicalEventsForUser(context.userId, {
      calendarId: row.calendar_id,
    });
    return events;
  });

export const getEvent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; calendarId?: string }) => {
    if (!data || typeof data.id !== "string" || !data.id) throw new Error("id required");
    return data;
  })
  .handler(async ({ data, context }) => {
    // Every imported provider is stored locally. Try it first; provider event
    // IDs are intentionally not required to use Luma's `scr-` prefix.
    const imported = await readScrapedEventById(context.userId, data.id);
    if (imported) return imported as EventDTO;

    // With a specific calendarId, try that one directly.
    if (data.calendarId && data.calendarId !== "__all__") {
      const key = await resolveUserLumaKey(context.userId, data.calendarId);
      if (!key) throw new NoLumaKeyError();
      const e = await fetchEvent(key, data.id);
      return toDTO(e, data.calendarId);
    }

    // Otherwise try every calendar until one has the event.
    const all = await resolveAllKeys(context.userId);
    if (all.length === 0) throw new NoLumaKeyError();
    let lastError: unknown = null;
    for (const { key, row } of all) {
      try {
        const e = await fetchEvent(key, data.id);
        return toDTO(e, row.calendar_id, row.calendar_name ?? undefined);
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Event ${data.id} not found`);
  });
