// Dynamic Google Fonts loader for canvas rendering.
// The renderer draws multiple weights/sizes, so we preload each combo and
// wait for `document.fonts` to confirm before letting the canvas paint.

export const GOOGLE_HEADING_FONTS = [
  "Space Grotesk",
  "Space Mono",
  "Archivo Black",
  "Bebas Neue",
  "DM Serif Display",
  "Instrument Serif",
  "Playfair Display",
  "Sora",
  "Syne",
  "Fraunces",
  "JetBrains Mono",
  "IBM Plex Mono",
  "Inter",
] as const;

export const GOOGLE_BODY_FONTS = [
  "Inter",
  "IBM Plex Mono",
  "JetBrains Mono",
  "Space Mono",
  "DM Mono",
  "Manrope",
  "Work Sans",
  "Fira Sans",
] as const;

const HEADING_SET = new Set<string>(GOOGLE_HEADING_FONTS);
const BODY_SET = new Set<string>(GOOGLE_BODY_FONTS);

/** Force spec fonts onto the allow-list so the canvas can actually render them. */
export function validateFontPair(
  heading: string | undefined | null,
  body: string | undefined | null,
): { heading: string; body: string; fallback: boolean } {
  const h = heading && HEADING_SET.has(heading) ? heading : "Space Grotesk";
  const b = body && BODY_SET.has(body) ? body : "Inter";
  return { heading: h, body: b, fallback: h !== heading || b !== body };
}

/**
 * Weights each family actually ships, from the generated metric tables.
 * Asking for one a family does not have gets you a synthesized (faux) bold,
 * which every engine draws differently — and document.fonts.check() reports
 * true for it, so it also masks a font that never loaded.
 */
import { AVAILABLE_WEIGHTS } from "@/lib/badge-doc/layout/metrics/index";

const injectedHrefs = new Set<string>();

function familyToUrl(family: string, weights: string): string {
  const q = family.trim().replace(/\s+/g, "+");
  return `https://fonts.googleapis.com/css2?family=${q}:wght@${weights}&display=swap`;
}

function inject(family: string, weights: string) {
  const href = familyToUrl(family, weights);
  if (injectedHrefs.has(href)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
  injectedHrefs.add(href);
}

/**
 * Proof that a family is really painting: measure a wide sample against the
 * generic fallback the canvas would otherwise use. document.fonts.check() is
 * not enough — it answers "would this font-spec match something", and returns
 * true for a fallback plus a synthesized weight.
 */
function isFamilyPainting(family: string, weight: number): boolean {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return true;
  const sample = "CODE BREW BOGOTÁ — BUILDERS NIGHT";
  ctx.font = `${weight} 88px "${family}"`;
  const actual = ctx.measureText(sample).width;
  for (const generic of ["sans-serif", "serif", "monospace"]) {
    ctx.font = `${weight} 88px ${generic}`;
    if (Math.abs(ctx.measureText(sample).width - actual) < 0.01) return false;
  }
  return true;
}

/**
 * Ensure both families are downloaded and actually painting before the canvas
 * draws. Requests only the weights the families really ship, then verifies by
 * measurement and retries with backoff — a first paint on a cold cache used to
 * silently fall back to a system font.
 */
export async function loadGoogleFontPair(heading: string, body: string): Promise<void> {
  if (typeof document === "undefined") return;

  const headWeights = AVAILABLE_WEIGHTS[heading] ?? [400, 700];
  const bodyWeights = (AVAILABLE_WEIGHTS[body] ?? [400, 700]).filter((w) => w <= 700);
  inject(heading, headWeights.join(";"));
  inject(body, bodyWeights.join(";"));

  const heaviestHead = Math.max(...headWeights);
  const heaviestBody = Math.max(...bodyWeights);
  const specs = [
    ...headWeights.map((w) => `${w} 88px "${heading}"`),
    ...bodyWeights.map((w) => `${w} 22px "${body}"`),
  ];

  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      await Promise.all(specs.map((s) => document.fonts.load(s)));
      await document.fonts.ready;
      if (isFamilyPainting(heading, heaviestHead) && isFamilyPainting(body, heaviestBody)) return;
      await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
    }
    console.warn(`[google-fonts] ${heading} / ${body} still falling back after 5 attempts`);
  } catch {
    // Canvas will fall back to system fonts; better than throwing.
  }
}
