// Single point of migration: to switch to OmniRoute (self-hosted OpenAI-compatible
// gateway) later, change BASE_URL + AUTH_HEADER here.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const BASE_URL = "https://ai.gateway.lovable.dev/v1";
const AUTH_HEADER = "Lovable-API-Key"; // OmniRoute: "Authorization" with "Bearer <key>"

export function getGatewayKey(): string {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  return key;
}

export function createAIGateway() {
  const key = getGatewayKey();
  return createOpenAICompatible({
    name: "lovable",
    baseURL: BASE_URL,
    headers: {
      [AUTH_HEADER]: key,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
  });
}

// Direct fetch for image generation endpoint (AI SDK doesn't wrap it).
export async function callImageGeneration(body: unknown): Promise<Response> {
  const key = getGatewayKey();
  return fetch(`${BASE_URL}/images/generations`, {
    method: "POST",
    headers: {
      [AUTH_HEADER]: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
