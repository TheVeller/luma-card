import { createServerFn } from "@tanstack/react-start";
import { generateText, Output, NoObjectGeneratedError } from "ai";
import { createAIGateway } from "./ai-gateway.server";
import { StyleSpecSchema, normalizeStyleSpec, DEFAULT_STYLE_SPEC, type StyleSpec } from "./style-spec";

const SYSTEM = `You are a senior brand designer. You look at the cover art of an event and return a StyleSpec that a canvas renderer will use to compose a "philatelic stamp" style badge for the event.

Rules:
- Return hex colors like #rrggbb.
- Palette must have good contrast: text on bg should be legible.
- Choose Google Fonts family names that actually exist (e.g. "Space Grotesk", "Inter", "Playfair Display", "Bebas Neue", "IBM Plex Mono", "DM Serif Display", "Instrument Serif", "Manrope", "JetBrains Mono", "Archivo Black", "Cormorant Garamond", "Sora"). Pair a distinctive heading with a clean body.
- heroPrompt must describe a background/hero illustration for the badge. NO text, NO letters, NO logos, NO overlays, NO UI mockups. Keep it under 400 chars.
- heroStyle is one of: "illustration", "photo", "abstract", "3d".
- mood is a short phrase (max 8 words).`;

export const analyzeEventArt = createServerFn({ method: "POST" })
  .inputValidator((d: { coverUrl: string | null; name: string; description?: string }) => d)
  .handler(async ({ data }): Promise<StyleSpec> => {
    const gateway = createAIGateway();
    const model = gateway("google/gemini-3.6-flash");

    const content: Array<
      { type: "text"; text: string } | { type: "image"; image: URL }
    > = [
      {
        type: "text",
        text: `Event name: ${data.name}\n${data.description ? `Description: ${data.description.slice(0, 400)}\n` : ""}\nAnalyze the cover art and produce a StyleSpec that captures its palette and vibe, so the badge feels native to this event.`,
      },
    ];
    if (data.coverUrl) {
      try {
        content.push({ type: "image", image: new URL(data.coverUrl) });
      } catch {
        // ignore invalid URL
      }
    }

    try {
      const { output } = await generateText({
        model,
        system: SYSTEM,
        messages: [{ role: "user", content }],
        output: Output.object({ schema: StyleSpecSchema }),
      });
      return normalizeStyleSpec(output as StyleSpec);
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        try {
          const parsed = JSON.parse(error.text ?? "{}");
          return normalizeStyleSpec(parsed);
        } catch {
          return DEFAULT_STYLE_SPEC;
        }
      }
      throw error;
    }
  });
