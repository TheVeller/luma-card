import { describe, expect, test } from "bun:test";
import { normalizeSourceUrl, parseBulkSources } from "../owner-curated-catalog";
import { maintenanceAfter, resolveSyncScope } from "../calendar-sync.server";

describe("calendar sync inputs", () => {
  test("parses named lines, raw URLs, and markdown table rows", () => {
    const sources = parseBulkSources(`
Hack0 Community — https://luma.com/hack0?k=c
https://luma.com/user/theveller
| AI First Founders | https://luma.com/ai-first-founders?k=c | Found |
`);
    expect(sources).toHaveLength(3);
    expect(sources[0]).toMatchObject({ name: "Hack0 Community", kind: "calendar" });
    expect(sources[1]).toMatchObject({ kind: "profile" });
    expect(sources[2].name).toBe("AI First Founders");
  });

  test("normalizes management links and tracking parameters", () => {
    expect(normalizeSourceUrl("https://luma.com/calendar/manage/cal-abc123?k=c")).toBe(
      "https://luma.com/calendar/cal-abc123",
    );
  });

  test("runs one full import before switching to seven-day maintenance", () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    expect(resolveSyncScope(null, "auto", now)).toEqual({ kind: "full" });
    expect(resolveSyncScope("2026-07-20T00:00:00Z", "auto", now)).toEqual({
      kind: "maintenance",
      after: "2026-07-21T12:00:00.000Z",
    });
    expect(resolveSyncScope("2026-07-20T00:00:00Z", "full", now)).toEqual({
      kind: "full",
    });
    expect(maintenanceAfter(now)).toBe("2026-07-21T12:00:00.000Z");
  });
});
