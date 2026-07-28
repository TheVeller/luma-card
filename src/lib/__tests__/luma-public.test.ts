import { afterEach, describe, expect, test } from "bun:test";
import { fetchPublicCalendarEvents, resolveLumaCalendar } from "../luma-public.server";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("public Luma calendars", () => {
  test("resolves the public calendar id and display name", async () => {
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      if (String(input).includes("/calendar/get?")) {
        return Response.json({
          calendar: {
            api_id: "cal-abc123",
            name: "Hack0",
            slug: "hack0",
            avatar_url: "https://images.lumacdn.com/hack0.png",
            cover_image_url: "https://images.lumacdn.com/hack0-cover.png",
            description_short: "Builders in Lima",
            tint_color: "#ff6600",
            timezone: "America/Lima",
          },
        });
      }
      return new Response(
        '<meta property="og:title" content="Hack0 · Luma"><script>{"api_id":"cal-abc123"}</script>',
      );
    }) as unknown as typeof fetch;

    expect(await resolveLumaCalendar("https://lu.ma/hack0?utm_source=test")).toEqual({
      apiId: "cal-abc123",
      name: "Hack0",
      slug: "hack0",
      url: "https://luma.com/hack0",
      avatarUrl: "https://images.lumacdn.com/hack0.png",
      coverUrl: "https://images.lumacdn.com/hack0-cover.png",
      description: "Builders in Lima",
      tintColor: "#ff6600",
      timezone: "America/Lima",
      personalUserId: null,
      personalUsername: null,
    });
  });

  test("paginates, deduplicates, and stops at the requested limit", async () => {
    const requested: string[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      requested.push(url);
      const cursor = new URL(url).searchParams.get("pagination_cursor");
      if (!cursor) {
        return Response.json({
          entries: [
            {
              event: {
                api_id: "evt-1",
                calendar_api_id: "cal-abc123",
                name: "One",
                url: "one",
              },
            },
            {
              event: {
                api_id: "evt-2",
                calendar_api_id: "cal-abc123",
                name: "Two",
                url: "two",
              },
            },
          ],
          has_more: true,
          next_cursor: "page-2",
        });
      }
      return Response.json({
        entries: [
          {
            event: {
              api_id: "evt-2",
              calendar_api_id: "cal-abc123",
              name: "Two",
              url: "two",
            },
          },
          {
            event: {
              api_id: "evt-3",
              calendar_api_id: "cal-abc123",
              name: "Three",
              url: "three",
            },
          },
        ],
        has_more: false,
      });
    }) as unknown as typeof fetch;

    const events = await fetchPublicCalendarEvents("cal-abc123", 3);

    expect(events.map((event) => event.apiId)).toEqual(["evt-1", "evt-2", "evt-3"]);
    expect(requested).toHaveLength(2);
    expect(requested[1]).toContain("pagination_cursor=page-2");
  });

  test("keeps events listed by an aggregator calendar and records their origin", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        entries: [
          {
            event: {
              api_id: "evt-wrong",
              calendar_api_id: "cal-other",
              name: "Wrong calendar",
              url: "wrong",
            },
          },
        ],
        has_more: false,
      })) as unknown as typeof fetch;

    const events = await fetchPublicCalendarEvents("cal-requested", 80);
    expect(events).toHaveLength(1);
    expect(events[0]?.originCalendarApiId).toBe("cal-other");
  });

  test("an unbounded sync reads both future and past feeds to exhaustion", async () => {
    const periods: string[] = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      const period = url.searchParams.get("period")!;
      periods.push(period);
      return Response.json({
        entries: [
          {
            event: {
              api_id: period === "future" ? "evt-future" : "evt-past",
              calendar_api_id: "cal-origin",
              name: period,
              url: period,
            },
          },
        ],
        has_more: false,
      });
    }) as typeof fetch;

    const events = await fetchPublicCalendarEvents("cal-aggregator", null);
    expect(events.map((event) => event.apiId)).toEqual(["evt-future", "evt-past"]);
    expect(periods).toEqual(["future", "past"]);
  });

  test("maintenance keeps upcoming and only the recent slice of past events", async () => {
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const period = new URL(String(input)).searchParams.get("period");
      return Response.json({
        entries:
          period === "future"
            ? [
                {
                  event: {
                    api_id: "evt-future",
                    name: "Future",
                    url: "future",
                    start_at: "2026-08-01T10:00:00Z",
                  },
                },
              ]
            : [
                {
                  event: {
                    api_id: "evt-recent",
                    name: "Recent",
                    url: "recent",
                    start_at: "2026-07-25T10:00:00Z",
                  },
                },
                {
                  event: {
                    api_id: "evt-old",
                    name: "Old",
                    url: "old",
                    start_at: "2026-06-01T10:00:00Z",
                  },
                },
              ],
        has_more: period === "past",
        next_cursor: "older",
      });
    }) as typeof fetch;

    const events = await fetchPublicCalendarEvents("cal-aggregator", null, {
      kind: "maintenance",
      after: "2026-07-21T00:00:00Z",
    });

    expect(events.map((event) => event.apiId)).toEqual(["evt-future", "evt-recent"]);
  });

  test("surfaces upstream failures instead of reporting an empty calendar", async () => {
    globalThis.fetch = (async () =>
      new Response("unavailable", { status: 503 })) as unknown as typeof fetch;

    expect(fetchPublicCalendarEvents("cal-abc123", 80)).rejects.toThrow(
      "Luma calendar events request failed (503)",
    );
  });
});
