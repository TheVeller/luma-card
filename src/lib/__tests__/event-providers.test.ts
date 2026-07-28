import { afterEach, describe, expect, test } from "bun:test";
import { canonicalizeEvents, type SourceEventInput } from "../canonical-events";
import {
  detectProviderImportTarget,
  providerEventId,
  providerForUrl,
  providerSourceId,
} from "../event-providers";
import {
  fetchPublicMeetupGroupSnapshot,
  fetchPublicProviderEvent,
  fetchPublicProviderSnapshot,
} from "../event-providers.server";

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
    expect(
      providerSourceId(
        "meetup",
        "https://www.meetup.com/ProductTank-Lima?recSource=chapter-search",
      ),
    ).toBe("meetup:meetup.com/producttank-lima");
  });

  test("detects provider-specific collection types for the unified importer", () => {
    expect(
      detectProviderImportTarget("https://www.eventbrite.com/o/builders-latam-123456789"),
    ).toMatchObject({
      provider: "eventbrite",
      kind: "organizer",
      confidence: "certain",
      supportedKinds: ["event", "organizer"],
    });
    expect(detectProviderImportTarget("https://www.meetup.com/coders/")).toMatchObject({
      provider: "meetup",
      kind: "group",
      providerSourceId: "meetup:meetup.com/coders",
    });
    expect(
      detectProviderImportTarget("https://www.meetup.com/coders/events/309123456/"),
    ).toMatchObject({
      provider: "meetup",
      kind: "event",
      providerSourceId: "meetup:event:309123456",
    });
    expect(detectProviderImportTarget("https://luma.com/user/demo")).toMatchObject({
      provider: "luma",
      kind: "profile",
    });
    expect(detectProviderImportTarget("https://example.com/events")).toBeNull();
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
      )) as unknown as typeof fetch;

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

  test("maintenance accepts a readable source with no events inside the lookback", async () => {
    globalThis.fetch = (async () =>
      new Response(
        `<script type="application/ld+json">${JSON.stringify({
          "@type": "Event",
          name: "Old launch",
          startDate: "2024-01-01T18:00:00Z",
          url: "https://www.eventbrite.com/e/old-launch-tickets-123456789",
        })}</script>`,
        { headers: { "content-type": "text/html" } },
      )) as unknown as typeof fetch;

    const snapshot = await fetchPublicProviderSnapshot(
      "eventbrite",
      "https://www.eventbrite.com/e/old-launch-tickets-123456789",
      80,
      { after: "2026-01-01T00:00:00Z" },
    );

    expect(snapshot.events).toEqual([]);
    expect(snapshot.readableCount).toBe(1);
    expect(snapshot.complete).toBe(true);
  });

  test("paginates public Meetup history and upcoming events without Firecrawl", async () => {
    const node = (id: string, status: "ACTIVE" | "PAST") => ({
      id,
      title: `Meetup ${id}`,
      eventUrl: `https://www.meetup.com/coders/events/${id}/`,
      description: `Description ${id}`,
      dateTime: status === "ACTIVE" ? "2026-09-01T18:00:00-05:00" : "2025-09-01T18:00:00-05:00",
      endTime: status === "ACTIVE" ? "2026-09-01T20:00:00-05:00" : "2025-09-01T20:00:00-05:00",
      status,
      eventHosts: [{ memberId: "host-1", name: "Host" }],
      featuredEventPhoto: {
        id: `photo-${id}`,
        baseUrl: "https://secure-content.meetupstatic.com/images/classic-events/",
        highResUrl: `https://example.com/${id}.jpg`,
      },
      venue: { name: "Venue", city: "Lima", state: "Lima", country: "pe" },
      group: { id: "group-1", name: "Coders", urlname: "coders" },
    });
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        variables: {
          after: string | null;
          afterDateTime: string | null;
          beforeDateTime: string | null;
        };
      };
      const upcoming = Boolean(request.variables.afterDateTime);
      const secondPastPage = request.variables.after === "past-cursor";
      const events = upcoming
        ? {
            totalCount: 1,
            pageInfo: { endCursor: null, hasNextPage: false },
            edges: [{ node: node("upcoming-1", "ACTIVE") }],
          }
        : secondPastPage
          ? {
              totalCount: 2,
              pageInfo: { endCursor: null, hasNextPage: false },
              edges: [{ node: node("past-2", "PAST") }],
            }
          : {
              totalCount: 2,
              pageInfo: { endCursor: "past-cursor", hasNextPage: true },
              edges: [{ node: node("past-1", "PAST") }],
            };
      return new Response(
        JSON.stringify({
          data: {
            groupByUrlname: {
              id: "group-1",
              name: "Coders",
              description: "A public group",
              keyGroupPhoto: { highResUrl: "https://example.com/group.jpg" },
              events,
            },
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const snapshot = await fetchPublicMeetupGroupSnapshot(
      "https://www.meetup.com/Coders?tracking=1",
      2000,
      { kind: "full" },
    );

    expect(snapshot).toMatchObject({
      name: "Coders",
      complete: true,
      discoveredCount: 3,
      readableCount: 3,
      sourceMethod: "provider_public_graphql",
    });
    expect(snapshot.events.map((event) => event.externalId).sort()).toEqual([
      "past-1",
      "past-2",
      "upcoming-1",
    ]);
    expect(snapshot.events[0]?.event).toMatchObject({
      coverUrl: "https://example.com/upcoming-1.jpg",
      city: "Lima",
    });
  });
});
