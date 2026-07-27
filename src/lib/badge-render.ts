// Badge composer.
//
// The layout no longer lives here: this is a thin adapter over the BadgeDoc
// engine (src/lib/badge-doc), which measures the classic layout as data and
// paints it through a backend. Keeping the signature means the editor did not
// have to change, and a parity test asserts the engine draws exactly what the
// hand-written version drew (src/lib/badge-doc/__tests__/parity.test.ts).

import type { StyleSpec } from "./style-spec";
import { renderToCanvas } from "./badge-doc/render";
import { CLASSIC_BADGE_DOC } from "./badge-doc/presets/classic";

export type EventTheme = {
  eventId: string;
  name: string;
  subtitle: string;
  url: string;
  coverUrl: string | null;
  dateLine: string;
};

export type BadgeInputs = {
  theme: EventTheme;
  spec: StyleSpec;
  photoDataUrl: string;
  firstName: string;
  role: string;
  heroDataUrl?: string | null; // ignored, kept for back-compat
};

export async function renderBadge(inputs: BadgeInputs): Promise<HTMLCanvasElement> {
  const { theme, spec, photoDataUrl, firstName, role } = inputs;
  return renderToCanvas({
    doc: CLASSIC_BADGE_DOC,
    spec,
    event: {
      name: theme.name,
      subtitle: theme.subtitle,
      dateLine: theme.dateLine,
      url: theme.url,
      coverUrl: theme.coverUrl,
    },
    user: { firstName, role, photo: photoDataUrl },
  });
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Legacy pixel accent (kept for callers that still import it).
export async function extractAccent(imageUrl: string, fallback = "#2970ef"): Promise<string> {
  try {
    const img = await loadImage(imageUrl);
    const c = document.createElement("canvas");
    const S = 64;
    c.width = S;
    c.height = S;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, S, S);
    const { data } = ctx.getImageData(0, 0, S, S);
    const buckets = new Map<
      string,
      { r: number; g: number; b: number; n: number; score: number }
    >();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2],
        a = data[i + 3];
      if (a < 200) continue;
      const max = Math.max(r, g, b),
        min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      const light = (max + min) / 2 / 255;
      if (light < 0.15 || light > 0.9) continue;
      if (sat < 0.25) continue;
      const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
      const b0 = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0, score: 0 };
      b0.r += r;
      b0.g += g;
      b0.b += b;
      b0.n += 1;
      b0.score += sat * (1 - Math.abs(light - 0.5));
      buckets.set(key, b0);
    }
    if (buckets.size === 0) return fallback;
    let best: { r: number; g: number; b: number; n: number; score: number } | null = null;
    for (const v of buckets.values()) if (!best || v.score > best.score) best = v;
    if (!best) return fallback;
    const rr = Math.round(best.r / best.n);
    const gg = Math.round(best.g / best.n);
    const bb = Math.round(best.b / best.n);
    return `#${[rr, gg, bb].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return fallback;
  }
}
