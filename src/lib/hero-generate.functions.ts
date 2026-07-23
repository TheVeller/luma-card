import { createServerFn } from "@tanstack/react-start";
import { callImageGeneration } from "./ai-gateway.server";
import { StyleSpecSchema, type StyleSpec } from "./style-spec";
import { z } from "zod";

const InputSchema = z.object({
  spec: StyleSpecSchema,
  eventName: z.string(),
  coverUrl: z.string().nullable().optional(),
});

// Non-streaming image generation. Returns a base64 PNG data URL.
// Uses google/gemini-3-pro-image for max quality.
export const generateHeroArt = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }): Promise<{ dataUrl: string }> => {
    const { spec, eventName, coverUrl } = data;

    // Build a prompt that explicitly forbids text/overlays.
    const prompt = `${spec.heroPrompt}. Style: ${spec.heroStyle}, ${spec.mood}. Palette centered on ${spec.palette.accent} with ${spec.palette.bg} background tones. Aspect ratio portrait (approx 3:4). Absolutely no text, no letters, no words, no logos, no watermarks, no UI, no borders. Pure imagery only. Event context: ${eventName}.`;

    // Gemini image body: messages + modalities
    const messageContent: Array<
      { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
    > = [{ type: "text", text: prompt }];
    if (coverUrl) {
      messageContent.push({ type: "image_url", image_url: { url: coverUrl } });
    }

    const body = {
      model: "google/gemini-3-pro-image",
      messages: [{ role: "user", content: messageContent }],
      modalities: ["image", "text"],
      // non-streaming: single JSON response
    };

    const res = await callImageGeneration(body);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`image gen failed ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error("no image returned");
    return { dataUrl: `data:image/png;base64,${b64}` };
  });
