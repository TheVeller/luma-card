// User-scoped Luma read APIs. Every call resolves the Luma API key from the
// signed-in user's calendars. Supports selecting a specific calendar by id
// or the "__all__" sentinel to fan out to every linked calendar.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { fetchAllEvents, fetchEvent, type LumaEvent } from "./luma.server";
import { resolveUserLumaKey } from "./user-luma-key.functions";
import { resolveAllKeys, readUserCalendars } from "./user-luma-calendars.functions";
import {
  readScrapedEventsForCalendar,
  readScrapedEventById,
  type ScrapedEventDTO,
} from "./luma-scrape.functions";

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

function toDTO(e: LumaEvent, calendarId?: string, calendarName?: string): EventDTO {
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

class NoLumaKeyError extends Error {
  constructor() {
    super("NO_LUMA_KEY");
  }
}

const ListInput = z
  .object({ calendarId: z.string().optional() })
  .optional();

export const listEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListInput.parse(d) ?? {})
  .handler(async ({ data, context }): Promise<EventDTO[]> => {
    const calendarId = data?.calendarId;
    const allRows = await readUserCalendars(context.userId);

    // Combined view: fan out across every linked calendar + scraped ones.
    if (calendarId === "__all__") {
      if (allRows.length === 0) throw new NoLumaKeyError();
      const apiKeys = await resolveAllKeys(context.userId);
      const apiResults = await Promise.all(
        apiKeys.map(async ({ key, row }) => {
          try {
            const events = await fetchAllEvents(key);
            return events.map((e) =>
              toDTO(e, row.calendar_id, row.calendar_name ?? undefined),
            );
          } catch (e) {
            console.error(`[listEvents] calendar ${row.calendar_id} failed`, e);
            return [] as EventDTO[];
          }
        }),
      );
      const scrapedRows = allRows.filter((r) => r.source === "scrape");
      const scrapedResults: ScrapedEventDTO[][] = await Promise.all(
        scrapedRows.map((r) =>
          readScrapedEventsForCalendar(
            context.userId,
            r.id,
            r.calendar_id,
            r.calendar_name ?? "Imported",
          ),
        ),
      );
      const merged: EventDTO[] = [];
      const seen = new Set<string>();
      for (const arr of [...apiResults, ...scrapedResults]) {
        for (const ev of arr) {
          const k = `${ev.calendarId}:${ev.id}`;
          if (seen.has(k)) continue;
          seen.add(k);
          merged.push(ev as EventDTO);
        }
      }
      return merged;
    }

    // Specific calendar — could be scraped (source='scrape') or api.
    const row = calendarId
      ? allRows.find((r) => r.calendar_id === calendarId)
      : allRows.find((r) => r.is_default) ?? allRows[0];
    if (row?.source === "scrape") {
      return readScrapedEventsForCalendar(
        context.userId,
        row.id,
        row.calendar_id,
        row.calendar_name ?? "Imported",
      );
    }
    const key = await resolveUserLumaKey(context.userId, calendarId);
    if (!key) throw new NoLumaKeyError();
    const events = await fetchAllEvents(key);
    return events.map((e) => toDTO(e, calendarId ?? undefined));
  });

export const getEvent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; calendarId?: string }) => {
    if (!data || typeof data.id !== "string" || !data.id) throw new Error("id required");
    return data;
  })
  .handler(async ({ data, context }) => {
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
