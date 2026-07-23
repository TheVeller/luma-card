import { z } from "zod";

// StyleSpec: contrato entre AI y canvas. Sin bounds duros en el schema
// (regla ai-sdk-lovable-gateway). Los rangos van en el prompt; clampamos en código.
export const StyleSpecSchema = z.object({
  palette: z.object({
    bg: z.string(),        // hex, fondo del badge
    surface: z.string(),   // hex, superficie interior / tiles
    accent: z.string(),    // hex, color de acento
    text: z.string(),      // hex, texto principal
    textMuted: z.string(), // hex, texto secundario
  }),
  fonts: z.object({
    heading: z.string(),   // Google Font family (ej. "Space Grotesk")
    body: z.string(),      // Google Font family (ej. "Inter")
  }),
  mood: z.string(),        // descripción libre ("cyberpunk neon", "editorial minimal")
  heroPrompt: z.string(),  // prompt para image gen — SIN texto, SIN overlays
  heroStyle: z.string(),   // "illustration" | "photo" | "abstract" | "3d" (libre)
});

export type StyleSpec = z.infer<typeof StyleSpecSchema>;

const HEX = /^#[0-9a-fA-F]{6}$/;
function safeHex(v: string, fallback: string): string {
  return HEX.test(v) ? v.toLowerCase() : fallback;
}

// Clampea y sanea cualquier StyleSpec (venga de AI o de un parcial).
export function normalizeStyleSpec(input: Partial<StyleSpec> | StyleSpec): StyleSpec {
  const d = DEFAULT_STYLE_SPEC;
  return {
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
    heroPrompt: (input.heroPrompt || d.heroPrompt).slice(0, 500),
    heroStyle: input.heroStyle || d.heroStyle,
  };
}

export const DEFAULT_STYLE_SPEC: StyleSpec = {
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
  heroPrompt: "abstract geometric composition, muted paper palette, editorial minimal",
  heroStyle: "abstract",
};
