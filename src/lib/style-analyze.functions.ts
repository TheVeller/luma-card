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

STEP 2 — Emit a StyleSpec faithful to the ACTUAL cover:
- All colors are #rrggbb.
- USE THE PIXEL EVIDENCE. The user message lists hex colors physically present in the cover. Your \`bg\`, \`surface\`, \`accent\`, and \`text\` MUST be either verbatim entries from that list OR ±5 in each channel of one of them. Do NOT introduce hues that are not evidenced.
- accent = the single most distinctive (highest-chroma) hue in the evidence. If the evidence says the cover is monochrome (isMonochrome=true), accent MUST equal the darkest ink from evidence, not blue.
- bg   = a paper-tile color derived from the LIGHTEST evidence entry (or its faded version). Never pure white; add ~2–6% warmth or cool bias matching the cover's temperature.
- surface = a version of bg that is 5–10% darker on light bgs, 5–10% lighter on dark bgs.
- text = darkest legible ink. Ensure WCAG contrast(text, bg) ≥ 4.5.
- textMuted = ~55% of text on bg (visually ~gray).
- Fonts must be REAL Google Fonts. Allowed families:
    heading: "Space Grotesk", "Space Mono", "Archivo Black", "Bebas Neue", "DM Serif Display", "Instrument Serif", "Playfair Display", "Sora", "Syne", "Fraunces", "JetBrains Mono", "IBM Plex Mono"
    body:    "Inter", "IBM Plex Mono", "JetBrains Mono", "Space Mono", "DM Mono", "Manrope", "Work Sans", "Fira Sans"
  Prefer monospace pairs for "mono-terminal" and "industrial-mono" buckets. Prefer serifs for "editorial-serif".
- mood ≤ 8 words describing the cover ("cream paper editorial", "terminal-mono workshop", etc.).

HARD RULES:
- NEVER default to #2970ef blue unless the pixel evidence contains a blue.
- NEVER default to Space Grotesk on a monospace/terminal cover.
- NEVER invent hues absent from the pixel evidence.

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
    temperature: 0.3,
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

/** Map either the strict schema or a flat {fontHeading,fontBody,...} shape to StyleSpec. */
function coerceLoose(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = raw as Record<string, unknown>;
  if (o.palette && o.fonts) return o; // already correct shape
  return {
    style: o.style,
    palette: {
      bg: o.bg,
      surface: o.surface,
      accent: o.accent,
      text: o.text,
      textMuted: o.textMuted ?? o.text_muted,
    },
    fonts: {
      heading: o.fontHeading ?? o.font_heading,
      body: o.fontBody ?? o.font_body,
    },
    mood: o.mood,
  };
}

export const analyzeEventArt = createServerFn({ method: "POST" })
  .inputValidator((d: {
    coverUrl: string | null;
    name: string;
    description?: string;
    pixelEvidence?: {
      dominants: string[];
      darkest: string;
      lightest: string;
      isMonochrome: boolean;
    } | null;
  }) => d)
  .handler(async ({ data }): Promise<StyleSpec> => {
    const key = getVercelKey();

    const ev = data.pixelEvidence;
    const evidenceBlock = ev
      ? `PIXEL EVIDENCE (colors physically sampled from the cover):
- dominants (top→): ${ev.dominants.join(", ") || "n/a"}
- darkest ink: ${ev.darkest}
- lightest paper: ${ev.lightest}
- isMonochrome: ${ev.isMonochrome}`
      : "PIXEL EVIDENCE: unavailable — infer purely from the image.";

    const userText = `Event name: ${data.name}
${data.description ? `Description: ${data.description.slice(0, 400)}\n` : ""}
${evidenceBlock}

Analyze the cover. First classify it into one of the seven buckets, then emit a StyleSpec whose palette + fonts feel native to THIS cover and are consistent with the pixel evidence above.`;

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
      const shaped = coerceLoose(raw);
      const parsed = StyleSpecSchema.safeParse(shaped);
      if (parsed.success) return normalizeStyleSpec(parsed.data as StyleSpec);
      try {
        return normalizeStyleSpec(shaped as StyleSpec);
      } catch {
        errors.push(`${model} → schema mismatch`);
      }
    }

    throw new Error(`Style analysis failed: ${errors.join(" · ")}`);
  });
