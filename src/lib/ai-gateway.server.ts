// Vercel AI Gateway (OpenAI-compatible).
// Chat/text goes through Vercel. Image generation stays on Lovable's
// /v1/images/generations because Vercel AI Gateway doesn't expose that route.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const VERCEL_BASE_URL = "https://ai-gateway.vercel.sh/v1";
const LOVABLE_BASE_URL = "https://ai.gateway.lovable.dev/v1";

export function getVercelKey(): string {
  const key = process.env.VERCEL_AI_GATEWAY_API_KEY;
  if (!key) throw new Error("VERCEL_AI_GATEWAY_API_KEY missing");
  return key;
}

export function getLovableKey(): string {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  return key;
}

// Text/chat provider — Vercel AI Gateway.
export function createAIGateway() {
  const key = getVercelKey();
  return createOpenAICompatible({
    name: "vercel",
    baseURL: VERCEL_BASE_URL,
    headers: {
      Authorization: `Bearer ${key}`,
    },
  });
}

// Image generation via Lovable AI Gateway (Vercel gateway has no /images route).
export async function callImageGeneration(body: unknown): Promise<Response> {
  const key = getLovableKey();
  return fetch(`${LOVABLE_BASE_URL}/images/generations`, {
    method: "POST",
    headers: {
      "Lovable-API-Key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
