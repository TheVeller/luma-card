// Import Luma calendars/events by public URL using Firecrawl.
// Scraped calendars and events live in `scraped_events`; the calendar row
// in `user_luma_calendars` uses source='scrape' with a NULL api key.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type ImportResult = {
  kind: "calendar" | "event" | "profile";
  calendarRowId: string; // uuid of the user_luma_calendars row
  calendarId: string; // stable synthetic id (`scr-<slug>`)
  calendarName: string;
  imported: number;
  eventIds: string[]; // `scr-<hash>` ids of imported events
};

const InputSchema = z.object({
  url: z.string().url(),
  kind: z.enum(["auto", "calendar", "event", "profile"]).default("auto"),
  limit: z.number().int().min(1).max(80).default(40),
});

function hashKey(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `scr-${Math.abs(h).toString(36)}`;
}

function guessKind(url: string): "calendar" | "event" | "profile" {
  try {
    const u = new URL(url);
    const seg = u.pathname.replace(/^\/+|\/+$/g, "");
    if (!seg) return "calendar";
    if (/^(user|u|profile)\//i.test(seg)) return "profile";
    // Only `evt-...` ids are unambiguously events. Human slugs like `hack0`
    // are much more likely to be calendars, and even a short hash slug can be
    // a calendar — so default to calendar and let the handler fall back to
    // event scraping if calendar resolution fails.
    if (/^evt-/i.test(seg)) return "event";
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

    const requestedKind = data.kind;
    const kind = requestedKind === "auto" ? guessKind(data.url) : requestedKind;

    // --- Calendar: use Luma's public API (no API key, no Firecrawl). ---
    if (kind === "calendar") {
      const { resolveLumaCalendar, fetchPublicCalendarEvents } =
        await import("./luma-public.server");
      const cal = await resolveLumaCalendar(data.url);
      // On `auto`, a calendar miss is expected for single-event URLs — fall
      // through to the Firecrawl event scraper instead of hard-failing.
      if (!cal) {
        if (requestedKind !== "auto") {
          throw new Error(
            "Couldn't read that Luma calendar. Use a public calendar URL like " +
              "luma.com/your-calendar. To import a single event, choose type 'event'.",
          );
        }
      } else {
        const events = await fetchPublicCalendarEvents(cal.apiId, data.limit);
        if (events.length === 0 && requestedKind !== "auto")
          throw new Error("That calendar has no events to import.");
        if (events.length > 0) {
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
            const { upsertCanonicalEventSource } = await import("./canonical-events.server");
            await upsertCanonicalEventSource(context.userId, {
              event: {
                id: ev.apiId,
                name: ev.name,
                coverUrl: ev.coverUrl,
                url: ev.url,
                startAt: ev.startAt ?? new Date().toISOString(),
                endAt: ev.endAt ?? undefined,
                city: ev.city ?? undefined,
                calendarId,
                calendarName: cal.name,
              },
              sourceType: "calendar_scrape",
              calendarRowId,
              calendarId,
              calendarName: cal.name,
              sourceUrl: ev.url,
              externalEventId: ev.apiId,
              payload: { source: "luma-public-api" },
            });
          }

          return {
            kind: "calendar",
            calendarRowId,
            calendarId,
            calendarName: cal.name,
            imported: imported.length,
            eventIds: imported,
          };
        }
      }
      // auto + calendar resolution empty/failed → fall through to event scrape.
    }

    if (kind === "profile") {
      const { hasFirecrawl, firecrawlDiscoverLumaEvents, firecrawlScrapeEvent } =
        await import("./firecrawl.server");
      if (!hasFirecrawl()) throw new Error("Firecrawl connector not configured");

      const profileSlug = new URL(data.url).pathname.replace(/^\/+|\/+$/g, "") || "profile";
      const calendarId = `scr-profile-${hashKey(data.url).replace(/^scr-/, "")}`;
      const calendarName = `Profile: ${profileSlug}`;
      const calendarRowId = await ensureCalendarRow(calendarId, calendarName, data.url);
      const urls = await firecrawlDiscoverLumaEvents(data.url, data.limit);
      if (urls.length === 0) throw new Error("No public Luma events found on that profile.");

      const imported: string[] = [];
      const { upsertCanonicalEventSource } = await import("./canonical-events.server");
      for (const url of urls) {
        const ev = await firecrawlScrapeEvent(url);
        if (!ev) continue;
        const eventKey = hashKey(url);
        const eventDto = {
          id: eventKey,
          name: ev.name,
          coverUrl: ev.coverUrl,
          url,
          startAt: ev.startAt ?? new Date().toISOString(),
          endAt: ev.endAt ?? undefined,
          city: ev.city ?? undefined,
          description: ev.description ?? undefined,
          calendarId,
          calendarName,
        };
        const { error: upErr } = await supabaseAdmin.from("scraped_events" as never).upsert(
          {
            user_id: context.userId,
            calendar_id: calendarRowId,
            event_key: eventKey,
            source_url: url,
            name: ev.name,
            description: ev.description,
            cover_url: ev.coverUrl,
            city: ev.city,
            start_at: ev.startAt,
            end_at: ev.endAt,
            host_name: ev.hostName,
            payload: { source: "profile", profileUrl: data.url, branding: ev.branding ?? null },
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: "user_id,event_key" },
        );
        if (upErr) {
          console.error("profile scraped_events upsert failed", upErr);
          continue;
        }
        await upsertCanonicalEventSource(context.userId, {
          event: eventDto,
          sourceType: "profile_scrape",
          calendarRowId,
          calendarId,
          calendarName,
          sourceUrl: url,
          externalEventId: eventKey,
          hostName: ev.hostName,
          payload: { profileUrl: data.url },
        });
        imported.push(eventKey);
      }
      if (imported.length === 0)
        throw new Error("Profile events were found, but none could be read.");
      return {
        kind: "profile",
        calendarRowId,
        calendarId,
        calendarName,
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
    const { upsertCanonicalEventSource } = await import("./canonical-events.server");
    await upsertCanonicalEventSource(context.userId, {
      event: {
        id: eventKey,
        name: ev.name,
        coverUrl: ev.coverUrl,
        url: data.url,
        startAt: ev.startAt ?? new Date().toISOString(),
        endAt: ev.endAt ?? undefined,
        city: ev.city ?? undefined,
        description: ev.description ?? undefined,
        calendarId,
        calendarName,
      },
      sourceType: "event_scrape",
      calendarRowId,
      calendarId,
      calendarName,
      sourceUrl: data.url,
      externalEventId: eventKey,
      hostName: ev.hostName,
      payload: { branding: ev.branding ?? null, ogImage: ev.ogImage ?? null },
    });

    return {
      kind: "event",
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
