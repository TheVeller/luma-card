import { describe, expect, test } from "bun:test";
import { AVAILABLE_WEIGHTS, METRIC_LOADERS } from "../metrics/index";
import { resolveWeightFor, TableMeasurer } from "../measure";

const load = async (family: string) => METRIC_LOADERS[family]();

describe("resolveWeightFor", () => {
  test("keeps the weight when the family ships it", () => {
    expect(resolveWeightFor([400, 500, 600, 700], 700)).toBe(700);
  });

  test("clamps down to the heaviest real weight", () => {
    // Space Grotesk (the default heading) stops at 700 but the badge asks 900.
    expect(resolveWeightFor([400, 500, 600, 700], 900)).toBe(700);
    expect(resolveWeightFor([400], 900)).toBe(400);
  });

  test("clamps up when nothing lighter exists", () => {
    expect(resolveWeightFor([700, 900], 400)).toBe(700);
  });
});

describe("AVAILABLE_WEIGHTS", () => {
  test("records the families that cannot render 900", () => {
    expect(AVAILABLE_WEIGHTS["Space Grotesk"]).toEqual([400, 500, 600, 700]);
    expect(AVAILABLE_WEIGHTS["Archivo Black"]).toEqual([400]);
    expect(AVAILABLE_WEIGHTS["Inter"]).toContain(900);
  });
});

describe("TableMeasurer", () => {
  test("width grows with the string and scales linearly with size", async () => {
    const m = TableMeasurer.fromTables([await load("Inter")]);
    const f = { family: "Inter", weight: 400, size: 100 };
    const one = m.width("n", f);
    const two = m.width("nn", f);
    expect(two).toBeCloseTo(one * 2, 6);
    expect(m.width("nn", { ...f, size: 50 })).toBeCloseTo(two / 2, 6);
  });

  test("a space is narrower than a letter, and empty text is zero", async () => {
    const m = TableMeasurer.fromTables([await load("Inter")]);
    const f = { family: "Inter", weight: 400, size: 40 };
    expect(m.width(" ", f)).toBeLessThan(m.width("n", f));
    expect(m.width("", f)).toBe(0);
  });

  test("bolder real weights are not narrower", async () => {
    const m = TableMeasurer.fromTables([await load("Inter")]);
    const base = { family: "Inter", size: 60 } as const;
    expect(m.width("BREWING", { ...base, weight: 900 })).toBeGreaterThanOrEqual(
      m.width("BREWING", { ...base, weight: 400 }),
    );
  });

  test("a 900 request on Space Grotesk measures its real 700", async () => {
    const m = TableMeasurer.fromTables([await load("Space Grotesk")]);
    const f = { family: "Space Grotesk", size: 88 } as const;
    expect(m.resolveWeight("Space Grotesk", 900)).toBe(700);
    expect(m.width("HELLO", { ...f, weight: 900 })).toBe(m.width("HELLO", { ...f, weight: 700 }));
  });

  test("covers the accented and symbol codepoints the badge draws", async () => {
    const m = TableMeasurer.fromTables([await load("Inter"), await load("Space Grotesk")]);
    const f = { family: "Inter", weight: 400, size: 22 };
    expect(m.missing("BOGOTÁ · MAÑANA — 20:00 → …", f)).toEqual([]);
    expect(m.missing("ÑÁÉÍÓÚÜ", { family: "Space Grotesk", weight: 700, size: 88 })).toEqual([]);
  });

  test("vmetrics returns a positive ascent and descent under the size", async () => {
    const m = TableMeasurer.fromTables([await load("Inter")]);
    const v = m.vmetrics({ family: "Inter", weight: 400, size: 100 });
    expect(v.ascent).toBeGreaterThan(0);
    expect(v.descent).toBeGreaterThan(0);
    expect(v.ascent).toBeLessThan(150);
  });

  test("every allow-listed family has a loadable table", async () => {
    for (const family of Object.keys(METRIC_LOADERS)) {
      const table = await load(family);
      expect(table.unitsPerEm).toBeGreaterThan(0);
      expect(Object.keys(table.weights).length).toBeGreaterThan(0);
    }
  });
});
