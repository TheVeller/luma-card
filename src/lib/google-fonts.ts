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
 * Ensure both families are downloaded and reported ready by the browser for
 * every weight/size the canvas renderer will request.
 */
export async function loadGoogleFontPair(heading: string, body: string): Promise<void> {
  if (typeof document === "undefined") return;

  inject(heading, "400;500;600;700;800;900");
  inject(body, "400;500;700");

  // Representative combos actually used by badge-render.ts
  const specs: string[] = [
    `900 104px "${heading}"`,
    `900 88px "${heading}"`,
    `900 42px "${heading}"`,
    `700 26px "${heading}"`,
    `700 22px "${body}"`,
    `400 22px "${body}"`,
    `700 16px "${body}"`,
    `400 14px "${body}"`,
    `400 18px "${body}"`,
  ];

  try {
    await Promise.all(specs.map((s) => document.fonts.load(s)));
    await document.fonts.ready;
    if (!specs.every((s) => document.fonts.check(s))) {
      await new Promise((r) => setTimeout(r, 250));
      await Promise.all(specs.map((s) => document.fonts.load(s)));
      await document.fonts.ready;
    }
  } catch {
    // Canvas will fall back to system fonts; better than throwing.
  }
}
