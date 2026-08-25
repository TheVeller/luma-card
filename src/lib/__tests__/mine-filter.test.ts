import { describe, expect, test } from "bun:test";
import { isMineRow } from "../events-aggregate.server";

describe("isMineRow derivation", () => {
  test("explicit is_mine flag wins", () => {
    expect(isMineRow({ is_mine: true, ownership: "external", source: "scrape" })).toBe(true);
    expect(isMineRow({ is_mine: false, ownership: "connected", source: "api" })).toBe(false);
  });

  test("falls back to ownership when is_mine is null", () => {
    expect(isMineRow({ is_mine: null, ownership: "connected", source: "api" })).toBe(true);
    expect(isMineRow({ is_mine: null, ownership: "external", source: "scrape" })).toBe(false);
  });

  test("falls back to source when ownership is missing", () => {
    expect(isMineRow({ is_mine: null, ownership: null, source: "api" })).toBe(true);
    expect(isMineRow({ is_mine: null, ownership: null, source: "scrape" })).toBe(false);
  });
});

describe("API mine param mapping", () => {
  function mineOwnership(mineParam: string | null) {
    if (mineParam && !["true", "false"].includes(mineParam)) return "invalid";
    return mineParam === "true" ? "mine" : mineParam === "false" ? "not_mine" : "all";
  }

  test("maps true/false/absent to ownership filters", () => {
    expect(mineOwnership("true")).toBe("mine");
    expect(mineOwnership("false")).toBe("not_mine");
    expect(mineOwnership(null)).toBe("all");
  });

  test("rejects invalid values", () => {
    expect(mineOwnership("yes")).toBe("invalid");
    expect(mineOwnership("1")).toBe("invalid");
  });
});
