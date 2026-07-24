// Import Luma calendars/events by public URL using Firecrawl.
// Scraped calendars and events live in `scraped_events`; the calendar row
// in `user_luma_calendars` uses source='scrape' with a NULL api key.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type ImportResult = {
  kind: "calendar" | "event";
  calendarRowId: string; // uuid of the user_luma_calendars row
  calendarId: string; // stable synthetic id (`scr-<slug>`)
  calendarName: string;
  imported: number;
  eventIds: string[]; // `scr-<hash>` ids of imported events
};

const InputSchema = z.object({
  url: z.string().url(),
  kind: z.enum(["auto", "calendar", "event"]).default("auto"),
  limit: z.number().int().min(1).max(80).default(40),
});

function hashKey(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `scr-${Math.abs(h).toString(36)}`;
}

function guessKind(url: string): "calendar" | "event" {
  try {
    const u = new URL(url);
    // lu.ma calendars live at /{slug} with 'user_...' / 'cal-...' ids too.
    // Heuristic: if pathname is empty or starts with an "event" style path with 5+ chars, we treat as event.
    // But safest default is `auto` — user should pick when unclear.
    const seg = u.pathname.replace(/^\/+|\/+$/g, "");
    if (!seg) return "calendar";
    // Luma slugs for calendars are longer, human names (e.g. hack0). Events tend to be short hashes.
    if (/^[a-z0-9]{4,8}$/i.test(seg)) return "event";
    return "calendar";
  } catch {
    return "event";
  }
}

export const importFromUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data, context }): Promise<ImportResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Ensure a source='scrape' calendar row exists; return its uuid.
    async function ensureCalendarRow(
      calendarId: string,
      calendarName: string,
      calendarUrl: string | null,
    ): Promise<string> {
      const { data: existingCal } = await supabaseAdmin
        .from("user_luma_calendars" as never)
        .select("id")
        .eq("user_id", context.userId)
        .eq("calendar_id", calendarId)
        .maybeSingle();
      const existingId = (existingCal as { id?: string } | null)?.id;
      if (existingId) return existingId;
      const { data: inserted, error } = await supabaseAdmin
        .from("user_luma_calendars" as never)
        .insert({
          user_id: context.userId,
          calendar_id: calendarId,
          calendar_name: calendarName,
          calendar_url: calendarUrl,
          source: "scrape",
          is_default: false,
        } as never)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return (inserted as { id: string }).id;
    }

    const kind = data.kind === "auto" ? guessKind(data.url) : data.kind;

    // --- Calendar: use Luma's public API (no API key, no Firecrawl). ---
    if (kind === "calendar") {
      const { resolveLumaCalendar, fetchPublicCalendarEvents } =
        await import("./luma-public.server");
      const cal = await resolveLumaCalendar(data.url);
      if (!cal) {
        throw new Error(
          "Couldn't read that Luma calendar. Use a public calendar URL like " +
            "luma.com/your-calendar. To import a single event, choose type 'event'.",
        );
      }
      const events = await fetchPublicCalendarEvents(cal.apiId, data.limit);
      if (events.length === 0) throw new Error("That calendar has no events to import.");

      const calendarId = `scr-${cal.apiId}`;
      const calendarRowId = await ensureCalendarRow(calendarId, cal.name, data.url);

      const imported: string[] = [];
      for (const ev of events) {
        const { error: upErr } = await supabaseAdmin.from("scraped_events" as never).upsert(
          {
            user_id: context.userId,
            calendar_id: calendarRowId,
            event_key: ev.apiId,
            source_url: ev.url,
            name: ev.name,
            description: null,
            cover_url: ev.coverUrl,
            city: ev.city,
            start_at: ev.startAt,
            end_at: ev.endAt,
            host_name: null,
            payload: { source: "luma-api" },
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: "user_id,event_key" },
        );
        if (upErr) {
          console.error("scraped_events upsert failed", upErr);
          continue;
        }
        imported.push(ev.apiId);
      }

      return {
        kind,
        calendarRowId,
        calendarId,
        calendarName: cal.name,
        imported: imported.length,
        eventIds: imported,
      };
    }

    // --- Single event: scrape the page with Firecrawl. ---
    const { hasFirecrawl, firecrawlScrapeEvent } = await import("./firecrawl.server");
    if (!hasFirecrawl()) throw new Error("Firecrawl connector not configured");

    const calendarId = `scr-standalone-${context.userId.slice(0, 8)}`;
    const calendarName = "Imported events";
    const calendarRowId = await ensureCalendarRow(calendarId, calendarName, null);

    const ev = await firecrawlScrapeEvent(data.url);
    if (!ev) throw new Error("Couldn't read that event page.");
    const eventKey = hashKey(data.url);
    const { error: upErr } = await supabaseAdmin.from("scraped_events" as never).upsert(
      {
        user_id: context.userId,
        calendar_id: calendarRowId,
        event_key: eventKey,
        source_url: data.url,
        name: ev.name,
        description: ev.description,
        cover_url: ev.coverUrl,
        city: ev.city,
        start_at: ev.startAt,
        end_at: ev.endAt,
        host_name: ev.hostName,
        payload: { branding: ev.branding ?? null, ogImage: ev.ogImage ?? null },
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "user_id,event_key" },
    );
    if (upErr) throw new Error(upErr.message);

    return {
      kind,
      calendarRowId,
      calendarId,
      calendarName,
      imported: 1,
      eventIds: [eventKey],
    };
  });

export type ScrapedEventDTO = {
  id: string;
  name: string;
  coverUrl: string | null;
  url: string;
  startAt: string;
  endAt?: string;
  city?: string;
  description?: string;
  calendarId: string;
  calendarName?: string;
};

export async function readScrapedEventsForCalendar(
  userId: string,
  calendarRowId: string,
  calendarPublicId: string,
  calendarName: string,
): Promise<ScrapedEventDTO[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("scraped_events" as never)
    .select("event_key, source_url, name, description, cover_url, city, start_at, end_at")
    .eq("user_id", userId)
    .eq("calendar_id", calendarRowId)
    .order("start_at", { ascending: true, nullsFirst: false });
  const rows =
    (data as Array<{
      event_key: string;
      source_url: string;
      name: string;
      description: string | null;
      cover_url: string | null;
      city: string | null;
      start_at: string | null;
      end_at: string | null;
    }> | null) ?? [];
  return rows.map((r) => ({
    id: r.event_key,
    name: r.name,
    coverUrl: r.cover_url,
    url: r.source_url,
    startAt: r.start_at ?? new Date().toISOString(),
    endAt: r.end_at ?? undefined,
    city: r.city ?? undefined,
    description: r.description ?? undefined,
    calendarId: calendarPublicId,
    calendarName,
  }));
}

export async function readScrapedEventById(
  userId: string,
  eventKey: string,
): Promise<ScrapedEventDTO | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("scraped_events" as never)
    .select(
      "event_key, source_url, name, description, cover_url, city, start_at, end_at, calendar_id",
    )
    .eq("user_id", userId)
    .eq("event_key", eventKey)
    .maybeSingle();
  const r = data as {
    event_key: string;
    source_url: string;
    name: string;
    description: string | null;
    cover_url: string | null;
    city: string | null;
    start_at: string | null;
    end_at: string | null;
    calendar_id: string | null;
  } | null;
  if (!r) return null;
  // Lookup calendar public id/name for the DTO.
  let publicId = "";
  let name = "";
  if (r.calendar_id) {
    const { data: cal } = await supabaseAdmin
      .from("user_luma_calendars" as never)
      .select("calendar_id, calendar_name")
      .eq("id", r.calendar_id)
      .maybeSingle();
    const c = cal as { calendar_id: string; calendar_name: string | null } | null;
    publicId = c?.calendar_id ?? "";
    name = c?.calendar_name ?? "";
  }
  return {
    id: r.event_key,
    name: r.name,
    coverUrl: r.cover_url,
    url: r.source_url,
    startAt: r.start_at ?? new Date().toISOString(),
    endAt: r.end_at ?? undefined,
    city: r.city ?? undefined,
    description: r.description ?? undefined,
    calendarId: publicId,
    calendarName: name,
  };
}
