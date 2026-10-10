import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_event",
  title: "Get event details",
  description:
    "Get one consolidated event by id (from list_events), including description, venue, tags and every source it was found in.",
  inputSchema: { id: z.string().uuid().describe("Event id from list_events.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ id }, ctx) => {
    if (!ctx.isAuthenticated()) return fail("Not authenticated");
    const sb = supabaseForUser(ctx);
    const { data: e, error } = await sb
      .from("canonical_events")
      .select(
        "id, name, url, cover_url, description, start_at, end_at, timezone, city, country_code, region, venue_name, venue_address, is_online, language_code, host_name, event_format, tags, topics, audience, event_sources(provider, source_type, source_url, calendar_name, calendar_public_id, last_synced_at)",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error("get_event", error);
      return fail("Could not load event");
    }
    if (!e) return fail("Event not found");
    const event = {
      id: e.id,
      name: e.name,
      url: e.url,
      coverUrl: e.cover_url,
      description: e.description,
      startAt: e.start_at,
      endAt: e.end_at,
      timezone: e.timezone,
      city: e.city,
      countryCode: e.country_code,
      region: e.region,
      venueName: e.venue_name,
      venueAddress: e.venue_address,
      isOnline: e.is_online,
      language: e.language_code,
      host: e.host_name,
      format: e.event_format,
      tags: e.tags ?? [],
      topics: e.topics ?? [],
      audience: e.audience ?? [],
      sources: (e.event_sources ?? []).map((s) => ({
        provider: s.provider,
        sourceType: s.source_type,
        url: s.source_url,
        calendarName: s.calendar_name,
        calendarId: s.calendar_public_id,
        lastSyncedAt: s.last_synced_at,
      })),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(event, null, 2) }],
      structuredContent: { event },
    };
  },
});
