import { createServerFn } from "@tanstack/react-start";
import { generateObject, NoObjectGeneratedError } from "ai";
import { createAIGateway } from "./ai-gateway.server";
import { StyleSpecSchema, normalizeStyleSpec, DEFAULT_STYLE_SPEC, type StyleSpec } from "./style-spec";

const SYSTEM = `You are a senior brand designer trained on the Crafter Station "code-brew-bog" philatelic stamp badge system. You look at the cover art of an event and return a StyleSpec that a canvas renderer uses to compose a stamp-style badge native to the event.

Reference eras (proven palettes from crafter-station/event-badge-history — use them as taste anchors, do NOT copy verbatim unless the cover matches):
- Era 1 · Code Brew: bg #f5f5f5, ink #0a0a0a, accent #f03d44 (punk red)
- Era 2 · v0 Zero-to-Agent: bg #0a0a0a, surface #1a1a1a, text #f5f5f5, accent #f03d44 (dark mode)
- Era 3 · GTM Hackathon: bg #fafafa, ink #22242f, accent #f03d44
- Era 4 · Cursor Meetup: bg #fafafa, ink #26251e, accent #22242f (mono-industrial)
- Era 5 · Cursor Buildathon SV: bg #f7f6f1, ink #16100b, accent #f04e1f (warm orange)
- Era 6 · Code Brew SV: bg #e9e5d8 paper, tile #f2efe6, ink #17150f, accent #2970ef

Typography lineage: Geist / Geist Mono are the house pair. Portable Google Fonts equivalents to reach for: heading = "Space Grotesk", "Archivo Black", "Bebas Neue", "DM Serif Display", "Instrument Serif", "Playfair Display", "Sora", "Syne"; body/mono = "Inter", "IBM Plex Mono", "JetBrains Mono", "Space Mono", "Manrope".

Rules:
- Return hex colors like #rrggbb. Palette must have strong contrast: text on bg legible; accent must pop against bg AND against surface.
- Pick 1 accent that echoes the cover's most distinctive hue (not gray/near-white/near-black).
- Pair a distinctive heading font with a clean body/mono. Fonts must exist on Google Fonts (verify names).
- heroPrompt describes a background/hero illustration for the badge. NO text, NO letters, NO logos, NO overlays, NO UI mockups. <400 chars.
- heroStyle ∈ {"illustration","photo","abstract","3d"}. mood ≤ 8 words.`;

export const analyzeEventArt = createServerFn({ method: "POST" })
  .inputValidator((d: { coverUrl: string | null; name: string; description?: string }) => d)
  .handler(async ({ data }): Promise<StyleSpec> => {
    const gateway = createAIGateway();
    const model = gateway("google/gemini-2.5-flash");

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
      const { object } = await generateObject({
        model,
        system: SYSTEM,
        messages: [{ role: "user", content }],
        schema: StyleSpecSchema,
      });
      return normalizeStyleSpec(object as StyleSpec);
    } catch (error) {
      console.error("[style-analyze] failed:", error);
      if (NoObjectGeneratedError.isInstance(error)) {
        try {
          const parsed = JSON.parse(error.text ?? "{}");
          return normalizeStyleSpec(parsed);
        } catch {
          return DEFAULT_STYLE_SPEC;
        }
      }
      // Last-resort fallback so the UI never blocks on AI failure.
      return DEFAULT_STYLE_SPEC;
    }
  });
