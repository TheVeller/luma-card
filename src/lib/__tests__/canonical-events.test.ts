import { describe, expect, test } from "bun:test";
import { canonicalizeEvents, canonicalKeyFor } from "../canonical-events";

describe("canonical events", () => {
  test("uses a Luma event id as the strongest canonical key", () => {
    const key = canonicalKeyFor({
      sourceType: "api",
      event: {
        id: "evt-abc123",
        name: "Agents Night",
        coverUrl: null,
        url: "https://luma.com/agents-night",
        startAt: "2026-08-01T00:00:00.000Z",
      },
      externalEventId: "evt-abc123",
    });
    expect(key).toBe("luma:evt-abc123");
  });

  test("merges duplicate sightings into one canonical event with sources", () => {
    const events = canonicalizeEvents([
      {
        sourceType: "api",
        calendarId: "cal-main",
        calendarName: "Main",
        externalEventId: "evt-abc123",
        event: {
          id: "evt-abc123",
          name: "Agents Night",
          coverUrl: null,
          url: "https://luma.com/agents-night",
          startAt: "2026-08-01T00:00:00.000Z",
          calendarId: "cal-main",
          calendarName: "Main",
        },
      },
      {
        sourceType: "calendar_scrape",
        calendarId: "scr-cal-main",
        calendarName: "Public Main",
        externalEventId: "evt-abc123",
        event: {
          id: "evt-abc123",
          name: "Agents Night",
          coverUrl: "https://images.lu.ma/agents.jpg",
          url: "https://lu.ma/agents-night?utm=calendar",
          startAt: "2026-08-01T00:00:00.000Z",
          calendarId: "scr-cal-main",
          calendarName: "Public Main",
        },
      },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].externalIds.lumaEventId).toBe("evt-abc123");
    expect(events[0].sources.map((s) => s.sourceType).sort()).toEqual(["api", "calendar_scrape"]);
  });

  test("merges a profile URL sighting with a Luma id sighting", () => {
    const event = {
      id: "scr-profile",
      name: "Shared event",
      coverUrl: null,
      url: "https://luma.com/shared-event",
      startAt: "2026-08-01T12:00:00.000Z",
    };
    const result = canonicalizeEvents([
      {
        event,
        sourceType: "profile_scrape",
        externalEventId: "scr-profile",
        sourceUrl: event.url,
      },
      {
        event: { ...event, id: "evt-real" },
        sourceType: "calendar_scrape",
        externalEventId: "evt-real",
        sourceUrl: `${event.url}?utm_source=calendar`,
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].externalIds.lumaEventId).toBe("evt-real");
    expect(result[0].sources).toHaveLength(2);
  });
});
