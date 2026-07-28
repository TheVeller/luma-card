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
  limit: z.number().int().min(1).max(80).default(80),
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
      sourceKind: "calendar" | "profile" | "event",
      lumaCalendarId?: string | null,
    ): Promise<string> {
      const { resolveCanonicalCalendarRowId, registerLumaCalendarIdentity, addCalendarAliases } =
        await import("./calendar-identity.server");
      const existingId =
        (lumaCalendarId && (await resolveCanonicalCalendarRowId(context.userId, lumaCalendarId))) ||
        (await resolveCanonicalCalendarRowId(context.userId, calendarId));
      if (existingId) {
        const { error } = await supabaseAdmin
          .from("user_luma_calendars" as never)
          .update({
            remote_name: calendarName,
            calendar_name: calendarName,
            calendar_url: calendarUrl ?? undefined,
            updated_at: new Date().toISOString(),
          } as never)
          .eq("id", existingId)
          .eq("user_id", context.userId);
        if (error) throw new Error(error.message);
        const winnerId = lumaCalendarId
          ? await registerLumaCalendarIdentity(context.userId, existingId, lumaCalendarId)
          : existingId;
        await addCalendarAliases(context.userId, winnerId, [
          { value: calendarId, kind: "legacy_id" },
          { value: calendarUrl, kind: "url" },
          { value: lumaCalendarId, kind: "luma_id" },
        ]);
        return winnerId;
      }
      const { data: inserted, error } = await supabaseAdmin
        .from("user_luma_calendars" as never)
        .upsert(
          {
            user_id: context.userId,
            calendar_id: calendarId,
            calendar_name: calendarName,
            calendar_url: calendarUrl,
            source: "scrape",
            source_kind: sourceKind,
            // Identity is claimed transactionally after insertion. Leaving this
            // null avoids racing the partial unique index with another importer.
            luma_calendar_id: null,
            source_metadata: lumaCalendarId ? { lumaCalendarId } : {},
            is_default: false,
          } as never,
          { onConflict: "user_id,calendar_id" },
        )
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      const insertedId = (inserted as { id: string }).id;
      const winnerId = lumaCalendarId
        ? await registerLumaCalendarIdentity(context.userId, insertedId, lumaCalendarId)
        : insertedId;
      await addCalendarAliases(context.userId, winnerId, [
        { value: calendarId, kind: "legacy_id" },
        { value: calendarUrl, kind: "url" },
        { value: lumaCalendarId, kind: "luma_id" },
      ]);
      return winnerId;
    }

    async function upsertScrapedEvent(values: Record<string, unknown>) {
      let result = await supabaseAdmin
        .from("scraped_events" as never)
        .upsert(values as never, { onConflict: "user_id,calendar_id,event_key" });
      if (result.error?.code === "42P10") {
        result = await supabaseAdmin
          .from("scraped_events" as never)
          .upsert(values as never, { onConflict: "user_id,event_key" });
      }
      return result;
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
        {
          const calendarId = `scr-${cal.apiId}`;
          const calendarRowId = await ensureCalendarRow(
            calendarId,
            cal.name,
            cal.url,
            "calendar",
            cal.apiId,
          );
          const { data: canonicalCalendar } = await supabaseAdmin
            .from("user_luma_calendars" as never)
            .select("calendar_id,calendar_name")
            .eq("id", calendarRowId)
            .single();
          const canonicalPublicId =
            (canonicalCalendar as { calendar_id?: string } | null)?.calendar_id ?? calendarId;
          const canonicalName =
            (canonicalCalendar as { calendar_name?: string | null } | null)?.calendar_name ??
            cal.name;

          const { tryUpsertCanonicalEventSource } = await import("./canonical-events.server");
          const importCalendarEvent = async (ev: (typeof events)[number]) => {
            const { error: upErr } = await upsertScrapedEvent({
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
            });
            if (upErr) {
              console.error("scraped_events upsert failed", upErr);
              return null;
            }
            await tryUpsertCanonicalEventSource(context.userId, {
              event: {
                id: ev.apiId,
                name: ev.name,
                coverUrl: ev.coverUrl,
                url: ev.url,
                startAt: ev.startAt ?? new Date().toISOString(),
                endAt: ev.endAt ?? undefined,
                city: ev.city ?? undefined,
                calendarId: canonicalPublicId,
                calendarName: canonicalName,
              },
              sourceType: "calendar_scrape",
              calendarRowId,
              calendarId: canonicalPublicId,
              calendarName: canonicalName,
              sourceUrl: ev.url,
              externalEventId: ev.apiId,
              payload: { source: "luma-public-api" },
            });
            return ev.apiId;
          };

          const imported: string[] = [];
          const concurrency = 10;
          for (let offset = 0; offset < events.length; offset += concurrency) {
            const batch = await Promise.all(
              events.slice(offset, offset + concurrency).map(importCalendarEvent),
            );
            imported.push(...batch.filter((eventId): eventId is string => eventId !== null));
          }
          const nextEventAt =
            events
              .map((event) => event.startAt)
              .filter((value): value is string => Boolean(value))
              .filter((value) => Date.parse(value) >= Date.now())
              .sort()[0] ?? null;
          const { error: metadataError } = await supabaseAdmin
            .from("user_luma_calendars" as never)
            .update({
              remote_name: cal.name,
              calendar_slug: cal.slug,
              calendar_url: cal.url,
              calendar_avatar_url: cal.avatarUrl,
              calendar_cover_url: cal.coverUrl,
              calendar_description: cal.description,
              calendar_tint_color: cal.tintColor,
              discovered_count: events.length,
              imported_count: imported.length,
              source_metadata: {
                lumaCalendarId: cal.apiId,
                slug: cal.slug,
                timezone: cal.timezone,
                personalUserId: cal.personalUserId,
                personalUsername: cal.personalUsername,
                ingestion: "luma-public-api",
                nextEventAt,
              },
              last_synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            } as never)
            .eq("id", calendarRowId)
            .eq("user_id", context.userId);
          if (metadataError) throw new Error(metadataError.message);
          const { enqueueSource } = await import("./calendar-sync.server");
          await enqueueSource(context.userId, calendarRowId, "manual");
          const { invalidateEventLibraryStatsCache } =
            await import("./event-library-stats.functions");
          invalidateEventLibraryStatsCache(context.userId);

          return {
            kind: "calendar",
            calendarRowId,
            calendarId: canonicalPublicId,
            calendarName: canonicalName,
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
      const calendarRowId = await ensureCalendarRow(calendarId, calendarName, data.url, "profile");
      const urls = await firecrawlDiscoverLumaEvents(data.url, data.limit);
      if (urls.length === 0) throw new Error("No public Luma events found on that profile.");

      const { tryUpsertCanonicalEventSource } = await import("./canonical-events.server");
      const importProfileEvent = async (url: string): Promise<string | null> => {
        const ev = await firecrawlScrapeEvent(url);
        if (!ev) return null;
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
        const { error: upErr } = await upsertScrapedEvent({
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
        });
        if (upErr) {
          console.error("profile scraped_events upsert failed", upErr);
          return null;
        }
        await tryUpsertCanonicalEventSource(context.userId, {
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
        return eventKey;
      };

      const imported: string[] = [];
      const concurrency = 5;
      for (let offset = 0; offset < urls.length; offset += concurrency) {
        const batch = await Promise.all(
          urls.slice(offset, offset + concurrency).map(importProfileEvent),
        );
        imported.push(...batch.filter((eventKey): eventKey is string => eventKey !== null));
      }
      if (imported.length === 0)
        throw new Error("Profile events were found, but none could be read.");
      const { invalidateEventLibraryStatsCache } = await import("./event-library-stats.functions");
      invalidateEventLibraryStatsCache(context.userId);
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
    const calendarRowId = await ensureCalendarRow(calendarId, calendarName, null, "event");

    const ev = await firecrawlScrapeEvent(data.url);
    if (!ev) throw new Error("Couldn't read that event page.");
    const eventKey = hashKey(data.url);
    const { error: upErr } = await upsertScrapedEvent({
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
    });
    if (upErr) throw new Error(upErr.message);
    const { tryUpsertCanonicalEventSource } = await import("./canonical-events.server");
    await tryUpsertCanonicalEventSource(context.userId, {
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
    const { invalidateEventLibraryStatsCache } = await import("./event-library-stats.functions");
    invalidateEventLibraryStatsCache(context.userId);

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
    .limit(1)
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
