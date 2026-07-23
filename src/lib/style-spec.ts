import { z } from "zod";

// StyleSpec: contrato entre AI y canvas. Sin bounds duros en el schema.
// Los rangos van en el prompt; clampamos en código.
export const StyleSpecSchema = z.object({
  style: z.string(), // classifier bucket (mono-terminal, editorial-serif, ...)
  palette: z.object({
    bg: z.string(),
    surface: z.string(),
    accent: z.string(),
    text: z.string(),
    textMuted: z.string(),
  }),
  fonts: z.object({
    heading: z.string(),
    body: z.string(),
  }),
  mood: z.string(),
});

export type StyleSpec = z.infer<typeof StyleSpecSchema>;

const HEX = /^#[0-9a-fA-F]{6}$/;
function safeHex(v: string, fallback: string): string {
  return HEX.test(v) ? v.toLowerCase() : fallback;
}

export function normalizeStyleSpec(input: Partial<StyleSpec> | StyleSpec): StyleSpec {
  const d = DEFAULT_STYLE_SPEC;
  return {
    style: (input.style || d.style).slice(0, 40),
    palette: {
      bg: safeHex(input.palette?.bg ?? d.palette.bg, d.palette.bg),
      surface: safeHex(input.palette?.surface ?? d.palette.surface, d.palette.surface),
      accent: safeHex(input.palette?.accent ?? d.palette.accent, d.palette.accent),
      text: safeHex(input.palette?.text ?? d.palette.text, d.palette.text),
      textMuted: input.palette?.textMuted ?? d.palette.textMuted,
    },
    fonts: {
      heading: input.fonts?.heading || d.fonts.heading,
      body: input.fonts?.body || d.fonts.body,
    },
    mood: (input.mood || d.mood).slice(0, 120),
  };
}

export const DEFAULT_STYLE_SPEC: StyleSpec = {
  style: "warm-paper",
  palette: {
    bg: "#e9e5d8",
    surface: "#f2efe6",
    accent: "#2970ef",
    text: "#17150f",
    textMuted: "#736f5f",
  },
  fonts: {
    heading: "Space Grotesk",
    body: "Inter",
  },
  mood: "editorial minimal",
};

// -------------- helpers used by the renderer & analyzer --------------

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbSat([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/** True when the accent is essentially achromatic (mono / paper / terminal covers). */
export function isMonoPalette(spec: StyleSpec): boolean {
  const rgb = hexToRgb(spec.palette.accent);
  if (!rgb) return true;
  return rgbSat(rgb) < 0.18;
}

/** Accent color to actually paint with: text color when the palette is mono. */
export function effectiveAccent(spec: StyleSpec): string {
  return isMonoPalette(spec) ? spec.palette.text : spec.palette.accent;
}
