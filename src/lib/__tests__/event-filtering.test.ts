import { describe, expect, it } from "bun:test";
import { eventTags, matchesEvent, type EventFilterState } from "../event-filtering";
import type { EventDTO } from "../events-aggregate.server";

const baseEvent: EventDTO = {
  id: "event-1",
  canonicalId: "00000000-0000-0000-0000-000000000001",
  name: "AI founders workshop",
  coverUrl: null,
  url: "https://example.com/event-1",
  startAt: "2030-06-10T18:00:00.000Z",
  city: "Lima",
  enrichment: {
    format: "workshop",
    topics: ["ai"],
    audience: ["founders"],
    isOnline: true,
    countryCode: "PE",
    languageCode: "es",
  },
  tagDetails: [
    {
      namespace: "topic",
      slug: "ai",
      label: "AI",
      origin: "system",
      state: "active",
      confidence: 0.96,
      taxonomyVersion: 1,
    },
    {
      namespace: "audience",
      slug: "founders",
      label: "Founders",
      origin: "manual",
      state: "active",
      confidence: 1,
      taxonomyVersion: 1,
    },
  ],
  sources: [
    {
      provider: "meetup",
      sourceType: "meetup_public",
      sourceKey: "meetup:event-1",
      calendarId: "calendar-1",
      calendarName: "AI Lima",
      sourceUrl: "https://meetup.com/ai-lima",
      externalEventId: "event-1",
      hostName: null,
      lastSyncedAt: "2030-01-01T00:00:00.000Z",
    },
  ],
};

const filters = (partial: Partial<EventFilterState> = {}): EventFilterState => ({
  q: "",
  provider: "all",
  labels: [],
  formats: [],
  topics: [],
  audiences: [],
  online: "all",
  cities: [],
  countries: [],
  languages: [],
  dateFrom: "",
  dateTo: "",
  status: "all",
  ...partial,
});

describe("event filtering", () => {
  it("keeps tag namespace and origin instead of flattening labels", () => {
    expect(eventTags(baseEvent).map((tag) => `${tag.namespace}:${tag.origin}`)).toEqual([
      "topic:system",
      "audience:manual",
    ]);
  });

  it("uses OR inside a dimension and AND across dimensions", () => {
    expect(
      matchesEvent(
        baseEvent,
        filters({ topics: ["ai", "design"], formats: ["workshop"] }),
        Date.parse("2030-01-01"),
      ),
    ).toBe(true);
    expect(
      matchesEvent(
        baseEvent,
        filters({ topics: ["ai"], formats: ["conference"] }),
        Date.parse("2030-01-01"),
      ),
    ).toBe(false);
  });

  it("matches location, modality, provider and date range", () => {
    expect(
      matchesEvent(
        baseEvent,
        filters({
          cities: ["lima"],
          online: "online",
          provider: "meetup",
          dateFrom: "2030-06-01",
          dateTo: "2030-06-30",
        }),
        Date.parse("2030-01-01"),
      ),
    ).toBe(true);
    expect(
      matchesEvent(baseEvent, filters({ online: "in-person" }), Date.parse("2030-01-01")),
    ).toBe(false);
  });
});
