import { createServerFn } from "@tanstack/react-start";
import { generateObject, NoObjectGeneratedError } from "ai";
import { createAIGateway } from "./ai-gateway.server";
import {
  StyleSpecSchema,
  normalizeStyleSpec,
  DEFAULT_STYLE_SPEC,
  type StyleSpec,
} from "./style-spec";

const SYSTEM = `You are a senior brand designer. You look at an event cover and produce a StyleSpec that lets a canvas renderer compose a philatelic-stamp badge whose color, typography, and mood are FAITHFUL to the cover.

STEP 1 — Classify the cover into ONE of these buckets (put the id in \`style\`):
- "mono-terminal"       Black/near-black on cream or off-white. Pixel or terminal typography (Space Mono, JetBrains Mono, IBM Plex Mono). Very low chroma.
- "industrial-mono"     Cool grays and near-black, hairline geometry. Neue-Haas / IBM Plex feel.
- "editorial-serif"     Warm off-white with high-contrast serif display (Playfair, Instrument Serif, DM Serif Display).
- "bold-punk"           Saturated red/orange accent (#f03d44 / #f04e1f) on cream or black. Archivo Black / Bebas Neue.
- "dark-mode-tech"      Deep near-black background, bright neon accent, sans display (Sora, Syne).
- "warm-paper"          Cream / paper background, muted colored accent (blue/rust/olive). Space Grotesk / Inter.
- "vibrant-illustration" Multi-color cartoon/illustration cover. Round friendly sans (Fraunces, Manrope).

STEP 2 — Emit a StyleSpec matching the bucket:
- Colors are #rrggbb. Contrast must be legible: text on bg, accent on both bg AND surface.
- accent = the single most distinctive hue of the cover. If the cover has NO chroma (pure B&W), accent MUST be near-black (#111111 or the darkest ink of the cover), NEVER a default blue.
- text = the darkest legible ink; textMuted = ~55% of text on bg.
- surface = a slightly lighter or darker version of bg (paper tile).
- Fonts must be REAL Google Fonts. Allowed families:
    heading: "Space Grotesk", "Space Mono", "Archivo Black", "Bebas Neue", "DM Serif Display", "Instrument Serif", "Playfair Display", "Sora", "Syne", "Fraunces", "JetBrains Mono", "IBM Plex Mono"
    body:    "Inter", "IBM Plex Mono", "JetBrains Mono", "Space Mono", "DM Mono", "Manrope", "Work Sans", "Fira Sans"
  Prefer monospace pairs for "mono-terminal" and "industrial-mono" buckets.
- mood ≤ 8 words describing the cover ("cream paper editorial", "terminal-mono workshop", etc.).

HARD RULES:
- Do NOT default to #2970ef blue unless the cover clearly uses that blue.
- Do NOT default to Space Grotesk when the cover is monospace/terminal.
- Do NOT invent colors that don't appear in the cover.`;

export const analyzeEventArt = createServerFn({ method: "POST" })
  .inputValidator((d: { coverUrl: string | null; name: string; description?: string }) => d)
  .handler(async ({ data }): Promise<StyleSpec> => {
    const gateway = createAIGateway();

    // Prefer stronger vision when available; fall back to flash.
    const primary = gateway("google/gemini-2.5-pro");
    const fallback = gateway("google/gemini-2.5-flash");

    const userText = `Event name: ${data.name}\n${
      data.description ? `Description: ${data.description.slice(0, 400)}\n` : ""
    }Analyze the cover. First classify it into one of the seven buckets, then emit a StyleSpec whose palette + fonts feel native to THIS cover.`;

    const content: Array<
      | { type: "text"; text: string }
      | { type: "image"; image: URL }
    > = [{ type: "text", text: userText }];

    if (data.coverUrl) {
      try {
        content.push({ type: "image", image: new URL(data.coverUrl) });
      } catch {
        // invalid URL — proceed without image
      }
    }

    async function attempt(model: ReturnType<typeof gateway>): Promise<StyleSpec | null> {
      try {
        const { object } = await generateObject({
          model,
          system: SYSTEM,
          messages: [{ role: "user", content }],
          schema: StyleSpecSchema,
        });
        return normalizeStyleSpec(object as StyleSpec);
      } catch (error) {
        console.error("[style-analyze] model failed:", error);
        if (NoObjectGeneratedError.isInstance(error)) {
          try {
            const parsed = JSON.parse(error.text ?? "{}");
            return normalizeStyleSpec(parsed);
          } catch {
            return null;
          }
        }
        return null;
      }
    }

    const first = await attempt(primary);
    if (first) return first;
    const second = await attempt(fallback);
    if (second) return second;

    // If both attempts return null, throw so the UI surfaces the failure
    // instead of silently displaying the default.
    throw new Error("Style analysis failed on both primary and fallback models");
  });
