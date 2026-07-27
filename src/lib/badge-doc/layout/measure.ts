// Text measurement for the badge layout.
//
// The layout pass never calls ctx.measureText: it has to produce the same
// numbers in the browser and on the server, and measureText exists only in the
// browser and applies engine-specific kerning. Everything measures against the
// generated advance-width tables instead (scripts/gen-font-metrics.ts).
//
// Two consequences the painters MUST honour, or painted glyphs stop matching
// the boxes the layout reserved for them:
//   1. kerning off   (canvas: ctx.fontKerning = "none"; svg: font-kerning="none")
//   2. real weights  (see resolveWeight — no faux bold)

import { AVAILABLE_WEIGHTS, METRIC_LOADERS } from "./metrics/index";
import type { FamilyMetrics, WeightMetrics } from "./metrics/types";

export type FontRequest = {
  family: string;
  weight: number;
  size: number;
  /** letter spacing in em; 0 for everything the classic badge draws */
  tracking?: number;
};

export interface TextMeasurer {
  /** Advance width in px. Deterministic and backend-independent. */
  width(text: string, f: FontRequest): number;
  /** Vertical metrics scaled to `f.size`. */
  vmetrics(f: FontRequest): { ascent: number; descent: number; lineGap: number };
  /** Weight actually available for the family (never synthesized). */
  resolveWeight(family: string, weight: number): number;
  /** Codepoints absent from the table — the caller may warn in dev. */
  missing(text: string, f: FontRequest): string[];
}

/**
 * Closest weight the family really ships.
 *
 * 10 of the 13 allow-listed heading families have no 900 (Space Grotesk, the
 * default, stops at 700) and DM Mono has no 700. Asking for those makes the
 * browser synthesize a bold, every engine synthesizes differently, and Figma
 * differs again — so the layout pins the request to a real weight and the
 * painters draw exactly that.
 */
export function resolveWeightFor(available: number[], weight: number): number {
  if (available.length === 0) return weight;
  if (available.includes(weight)) return weight;
  // Prefer the heaviest weight at or below the request, else the lightest above.
  const below = available.filter((w) => w < weight);
  if (below.length > 0) return Math.max(...below);
  return Math.min(...available);
}

export class TableMeasurer implements TextMeasurer {
  constructor(private readonly tables: Map<string, FamilyMetrics>) {}

  /** Loads the metric tables for the families a render needs. */
  static async forFamilies(families: string[]): Promise<TableMeasurer> {
    const tables = new Map<string, FamilyMetrics>();
    await Promise.all(
      [...new Set(families)].map(async (family) => {
        const load = METRIC_LOADERS[family];
        if (!load) return;
        tables.set(family, await load());
      }),
    );
    return new TableMeasurer(tables);
  }

  /** Synchronous variant for callers that already hold the tables (tests, server). */
  static fromTables(tables: Iterable<FamilyMetrics>): TableMeasurer {
    return new TableMeasurer(new Map([...tables].map((t) => [t.family, t])));
  }

  resolveWeight(family: string, weight: number): number {
    const available =
      AVAILABLE_WEIGHTS[family] ?? Object.keys(this.tables.get(family)?.weights ?? {}).map(Number);
    return resolveWeightFor(available, weight);
  }

  private entry(f: FontRequest): { table: FamilyMetrics; wm: WeightMetrics } | null {
    const table = this.tables.get(f.family);
    if (!table) return null;
    const wm = table.weights[this.resolveWeight(f.family, f.weight)];
    return wm ? { table, wm } : null;
  }

  width(text: string, f: FontRequest): number {
    const e = this.entry(f);
    // No table (font outside the allow-list): approximate rather than throw —
    // validateFontPair should have prevented this upstream.
    if (!e) return text.length * f.size * 0.5;
    const scale = f.size / e.table.unitsPerEm;
    let units = 0;
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      units += e.wm.advances[cp] ?? e.wm.fallbackAdvance;
    }
    const tracking = (f.tracking ?? 0) * f.size * [...text].length;
    return units * scale + tracking;
  }

  vmetrics(f: FontRequest): { ascent: number; descent: number; lineGap: number } {
    const e = this.entry(f);
    if (!e) return { ascent: f.size * 0.8, descent: f.size * 0.2, lineGap: 0 };
    const scale = f.size / e.table.unitsPerEm;
    return {
      ascent: e.wm.ascender * scale,
      // hhea descender is negative; callers want a positive depth.
      descent: Math.abs(e.wm.descender) * scale,
      lineGap: e.wm.lineGap * scale,
    };
  }

  missing(text: string, f: FontRequest): string[] {
    const e = this.entry(f);
    if (!e) return [];
    const out: string[] = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (e.wm.advances[cp] === undefined) out.push(ch);
    }
    return out;
  }
}
