import { afterEach, describe, expect, test } from "bun:test";
import { canonicalizeEvents, type SourceEventInput } from "../canonical-events";
import { providerEventId, providerForUrl, providerSourceId } from "../event-providers";
import { fetchPublicProviderEvent } from "../event-providers.server";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("event providers", () => {
  test("detects supported provider URLs and stable external ids", () => {
    expect(providerForUrl("https://www.eventbrite.com/e/demo-tickets-123456789")).toBe(
      "eventbrite",
    );
    expect(providerEventId("eventbrite", "https://eventbrite.com/e/demo-tickets-123456789")).toBe(
      "123456789",
    );
    expect(providerForUrl("https://www.meetup.com/coders/events/309123456/")).toBe("meetup");
    expect(providerEventId("meetup", "https://www.meetup.com/coders/events/309123456/")).toBe(
      "309123456",
    );
    expect(providerSourceId("meetup", "https://www.meetup.com/coders/")).toBe(
      "meetup:meetup.com/coders",
    );
  });

  test("deduplicates a cross-provider listing by event fingerprint and keeps both sources", () => {
    const base = {
      name: "Builders Night",
      coverUrl: null,
      startAt: "2026-08-01T00:00:00Z",
    };
    const inputs: SourceEventInput[] = [
      {
        provider: "eventbrite",
        sourceType: "eventbrite_public",
        externalEventId: "123",
        event: { ...base, id: "eventbrite-123", url: "https://eventbrite.com/e/night-123" },
      },
      {
        provider: "meetup",
        sourceType: "meetup_public",
        externalEventId: "456",
        event: { ...base, id: "meetup-456", url: "https://meetup.com/builders/events/456" },
      },
    ];

    const events = canonicalizeEvents(inputs);
    expect(events).toHaveLength(1);
    expect(events[0]?.externalIds).toMatchObject({
      eventbriteEventId: "123",
      meetupEventId: "456",
    });
    expect(events[0]?.sources.map((source) => source.provider).sort()).toEqual([
      "eventbrite",
      "meetup",
    ]);
  });

  test("imports public Eventbrite JSON-LD without requiring Firecrawl", async () => {
    globalThis.fetch = (async () =>
      new Response(
        `<script type="application/ld+json">${JSON.stringify({
          "@type": "Event",
          name: "Public Launch",
          startDate: "2026-09-10T18:00:00-05:00",
          endDate: "2026-09-10T20:00:00-05:00",
          url: "https://www.eventbrite.com/e/public-launch-tickets-123456789",
          image: "https://example.com/cover.png",
          organizer: { name: "Builders" },
          location: { address: { addressLocality: "Lima" } },
        })}</script>`,
        { headers: { "content-type": "text/html" } },
      )) as typeof fetch;

    const event = await fetchPublicProviderEvent(
      "eventbrite",
      "https://www.eventbrite.com/e/public-launch-tickets-123456789",
    );
    expect(event.externalId).toBe("123456789");
    expect(event.event).toMatchObject({
      name: "Public Launch",
      city: "Lima",
      startAt: "2026-09-10T18:00:00-05:00",
    });
  });
});
