import { createServerFn } from "@tanstack/react-start";
import {
  StyleSpecSchema,
  normalizeStyleSpec,
  type StyleSpec,
} from "./style-spec";
import { getVercelKey } from "./ai-gateway.server";

const VERCEL_CHAT_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";

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
- Do NOT invent colors that don't appear in the cover.

OUTPUT — Return ONLY a JSON object (no markdown, no prose) with this exact shape:
{"style":"mono-terminal","bg":"#f7f6f1","surface":"#efece2","text":"#111111","textMuted":"#5b5a56","accent":"#111111","fontHeading":"Space Mono","fontBody":"IBM Plex Mono","mood":"cream paper terminal"}`;

function extractJson(text: string): unknown | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function callVercelChat(
  key: string,
  model: string,
  userText: string,
  coverUrl: string | null,
): Promise<{ ok: true; text: string } | { ok: false; status: number; body: string }> {
  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [{ type: "text", text: userText }];

  if (coverUrl) {
    userContent.push({ type: "image_url", image_url: { url: coverUrl } });
  }

  const body = {
    model,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userContent },
    ],
    temperature: 0.4,
  };

  const res = await fetch(VERCEL_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    return { ok: false, status: res.status, body: errBody };
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  return { ok: true, text };
}

export const analyzeEventArt = createServerFn({ method: "POST" })
  .inputValidator((d: { coverUrl: string | null; name: string; description?: string }) => d)
  .handler(async ({ data }): Promise<StyleSpec> => {
    const key = getVercelKey();

    const userText = `Event name: ${data.name}\n${
      data.description ? `Description: ${data.description.slice(0, 400)}\n` : ""
    }Analyze the cover. First classify it into one of the seven buckets, then emit a StyleSpec whose palette + fonts feel native to THIS cover.`;

    const models = ["google/gemini-2.5-pro", "google/gemini-2.5-flash"];
    const errors: string[] = [];

    for (const model of models) {
      const result = await callVercelChat(key, model, userText, data.coverUrl);
      if (!result.ok) {
        console.error(`[style-analyze] ${model} HTTP ${result.status}:`, result.body);
        errors.push(`${model} → ${result.status}`);
        continue;
      }
      const raw = extractJson(result.text);
      if (!raw) {
        console.error(`[style-analyze] ${model} produced no JSON:`, result.text.slice(0, 200));
        errors.push(`${model} → no JSON`);
        continue;
      }
      const parsed = StyleSpecSchema.safeParse(raw);
      if (parsed.success) return normalizeStyleSpec(parsed.data as StyleSpec);
      // schema mismatch — try to salvage via normalize
      try {
        return normalizeStyleSpec(raw as StyleSpec);
      } catch {
        errors.push(`${model} → schema mismatch`);
      }
    }

    throw new Error(`Style analysis failed: ${errors.join(" · ")}`);
  });
