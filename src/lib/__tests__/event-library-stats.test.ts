import { describe, expect, test } from "bun:test";
import {
  summarizePersistedEventStats,
  summarizeSourceEventStats,
} from "../event-library-stats.functions";
import type { SourceEventInput } from "../canonical-events";

const NOW = Date.parse("2026-07-28T12:00:00Z");

function source(
  calendarRowId: string,
  calendarId: string,
  eventId: string,
  startAt: string,
  endAt?: string,
): SourceEventInput {
  return {
    sourceType: "api",
    calendarRowId,
    calendarId,
    externalEventId: eventId,
    event: {
      id: eventId,
      name: eventId,
      coverUrl: null,
      url: `https://luma.com/${eventId}`,
      startAt,
      endAt,
    },
  };
}

describe("event library stats", () => {
  test("deduplicates the global total but counts the event in each calendar", () => {
    const stats = summarizeSourceEventStats(
      [
        source("row-one", "cal-one", "evt-shared", "2026-07-29T12:00:00Z"),
        source("row-two", "cal-two", "evt-shared", "2026-07-29T12:00:00Z"),
      ],
      NOW,
    );
    expect(stats).toMatchObject({ total: 1, upcoming: 1, past: 0, unknown: 0 });
    expect(stats.calendars).toEqual([
      {
        calendarRowId: "row-one",
        total: 1,
        upcoming: 1,
        past: 0,
        unknown: 0,
      },
      {
        calendarRowId: "row-two",
        total: 1,
        upcoming: 1,
        past: 0,
        unknown: 0,
      },
    ]);
  });

  test("counts ongoing as upcoming and keeps total partitioned", () => {
    const stats = summarizeSourceEventStats(
      [
        source("row-one", "cal-one", "evt-live", "2026-07-28T11:00:00Z", "2026-07-28T13:00:00Z"),
        source("row-one", "cal-one", "evt-past", "2026-07-27T12:00:00Z"),
        source("row-one", "cal-one", "evt-unknown", "invalid"),
      ],
      NOW,
    );
    expect(stats).toMatchObject({ total: 3, upcoming: 1, past: 1, unknown: 1 });
    expect(stats.upcoming + stats.past + stats.unknown).toBe(stats.total);
  });

  test("summarizes RLS-readable persisted rows and includes empty calendars", () => {
    const stats = summarizePersistedEventStats(
      ["row-one", "row-empty"],
      [
        {
          calendar_row_id: "row-one",
          canonical_event_id: "canonical-shared",
          canonical_events: {
            id: "canonical-shared",
            start_at: "2026-07-29T12:00:00Z",
            end_at: null,
          },
        },
        {
          calendar_row_id: "row-one",
          canonical_event_id: "canonical-shared",
          canonical_events: {
            id: "canonical-shared",
            start_at: "2026-07-29T12:00:00Z",
            end_at: null,
          },
        },
      ],
      NOW,
    );
    expect(stats).toMatchObject({ total: 1, upcoming: 1 });
    expect(stats.calendars).toEqual([
      {
        calendarRowId: "row-one",
        total: 1,
        upcoming: 1,
        past: 0,
        unknown: 0,
      },
      {
        calendarRowId: "row-empty",
        total: 0,
        upcoming: 0,
        past: 0,
        unknown: 0,
      },
    ]);
  });
});
