/**
 * Generates the font metrics tables the badge layout engine measures with.
 *
 * Why a table instead of ctx.measureText: layout has to run identically in the
 * browser (canvas preview) and on the server (SVG export). measureText only
 * exists in the browser and its kerning is engine-specific, so it can never be
 * the source of truth for a layout that must match in Figma.
 *
 * Run: bun run scripts/gen-font-metrics.ts
 * Output: src/lib/badge-doc/layout/metrics/*.json  (committed — no network at build time)
 *
 * Note on the fetch: Google Fonts picks the file format from the User-Agent.
 * Sending NO User-Agent yields plain TTF, which opentype.js parses directly.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import opentype from "opentype.js";
import { GOOGLE_BODY_FONTS, GOOGLE_HEADING_FONTS } from "../src/lib/google-fonts";

const OUT_DIR = join(import.meta.dir, "..", "src", "lib", "badge-doc", "layout", "metrics");
const REQUESTED_WEIGHTS = [400, 500, 600, 700, 800, 900];

/** Codepoints the badge can actually draw. */
function codepoints(): number[] {
  const cps: number[] = [];
  for (let c = 0x20; c <= 0x7e; c++) cps.push(c); // ASCII
  for (let c = 0xa0; c <= 0xff; c++) cps.push(c); // Latin-1 Supplement (incl. · and accented vowels)
  for (let c = 0x100; c <= 0x17f; c++) cps.push(c); // Latin Extended-A
  // Punctuation and arrows the renderer writes literally.
  cps.push(0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026, 0x2190, 0x2192, 0x21b4);
  return cps;
}

export type WeightMetrics = {
  ascender: number;
  descender: number;
  lineGap: number;
  /** codepoint -> advance width, in font units */
  advances: Record<number, number>;
  /** advance used for codepoints missing from the table */
  fallbackAdvance: number;
};

export type FamilyMetrics = {
  family: string;
  unitsPerEm: number;
  /** Only the weights the family actually ships. */
  weights: Record<number, WeightMetrics>;
};

function slug(family: string): string {
  return family.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/** Ask Google for every weight at once; the response only declares the real ones. */
async function fetchFaceUrls(family: string): Promise<Map<number, string>> {
  const q = family.trim().replace(/\s+/g, "+");
  const url = `https://fonts.googleapis.com/css2?family=${q}:wght@${REQUESTED_WEIGHTS.join(";")}`;
  const res = await fetch(url); // no User-Agent => TTF
  if (!res.ok) throw new Error(`${family}: css2 responded ${res.status}`);
  const css = await res.text();

  const faces = new Map<number, string>();
  // Each @font-face block carries one font-weight and one src url.
  for (const block of css.split("@font-face")) {
    const weight = block.match(/font-weight:\s*(\d+)\s*;/)?.[1];
    const src = block.match(/src:\s*url\((https:[^)]+)\)/)?.[1];
    if (weight && src) faces.set(Number(weight), src);
  }
  if (faces.size === 0) throw new Error(`${family}: no @font-face blocks in css2 response`);
  return faces;
}

async function metricsForFamily(family: string): Promise<FamilyMetrics> {
  const faces = await fetchFaceUrls(family);
  const cps = codepoints();
  let unitsPerEm = 1000;
  const weights: Record<number, WeightMetrics> = {};

  for (const [weight, url] of [...faces].sort((a, b) => a[0] - b[0])) {
    const buf = await (await fetch(url)).arrayBuffer();
    const font = opentype.parse(buf);
    unitsPerEm = font.unitsPerEm;

    const advances: Record<number, number> = {};
    for (const cp of cps) {
      const glyph = font.charToGlyph(String.fromCodePoint(cp));
      // .notdef means the family has no glyph for it; leave it out so the
      // measurer's fallback (and the dev-mode drift auditor) can flag it.
      if (!glyph || glyph.index === 0) continue;
      const adv = glyph.advanceWidth;
      if (typeof adv === "number") advances[cp] = adv;
    }

    const hhea = font.tables.hhea as { ascender: number; descender: number; lineGap: number };
    weights[weight] = {
      ascender: hhea?.ascender ?? font.ascender,
      descender: hhea?.descender ?? font.descender,
      lineGap: hhea?.lineGap ?? 0,
      advances,
      fallbackAdvance: advances[0x6e] ?? Math.round(unitsPerEm * 0.5), // width of "n"
    };
  }

  return { family, unitsPerEm, weights };
}

async function main() {
  const families = [...new Set([...GOOGLE_HEADING_FONTS, ...GOOGLE_BODY_FONTS])];
  await mkdir(OUT_DIR, { recursive: true });

  const index: { family: string; slug: string; weights: number[] }[] = [];

  for (const family of families) {
    process.stdout.write(`${family} … `);
    const m = await metricsForFamily(family);
    const available = Object.keys(m.weights)
      .map(Number)
      .sort((a, b) => a - b);
    await writeFile(join(OUT_DIR, `${slug(family)}.json`), JSON.stringify(m), "utf8");
    index.push({ family, slug: slug(family), weights: available });
    console.log(
      `${available.length} weight(s) [${available.join(",")}], ` +
        `${Object.keys(m.weights[available[0]].advances).length} glyphs`,
    );
  }

  // Static import map: the browser pulls only the two families in use; the
  // server bundle can import them all.
  const lines = [
    "// AUTO-GENERATED by scripts/gen-font-metrics.ts — do not edit by hand.",
    'import type { FamilyMetrics } from "./types";',
    "",
    "/** Weights each family actually ships. Requesting anything else means faux bold. */",
    "export const AVAILABLE_WEIGHTS: Record<string, number[]> = {",
    ...index.map((e) => `  ${JSON.stringify(e.family)}: [${e.weights.join(", ")}],`),
    "};",
    "",
    "export const METRIC_LOADERS: Record<string, () => Promise<FamilyMetrics>> = {",
    ...index.map(
      (e) =>
        `  ${JSON.stringify(e.family)}: () => import("./${e.slug}.json").then((m) => m.default as unknown as FamilyMetrics),`,
    ),
    "};",
    "",
  ];
  await writeFile(join(OUT_DIR, "index.ts"), lines.join("\n"), "utf8");

  console.log(`\nWrote ${index.length} families to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
