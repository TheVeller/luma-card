import { describe, expect, test } from "bun:test";
import { normalizeSourceUrl, parseBulkSources } from "../owner-curated-catalog";

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
});
