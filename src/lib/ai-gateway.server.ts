// Single AI provider for the app: Vercel AI Gateway (OpenAI-compatible).
// Every AI call — style analysis, badge chat, and any future model use —
// routes through here so we have one key, one base URL, one place to swap.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export const VERCEL_BASE_URL = "https://ai-gateway.vercel.sh/v1";
export const VERCEL_CHAT_URL = `${VERCEL_BASE_URL}/chat/completions`;

export function getVercelKey(): string {
  const key = process.env.VERCEL_AI_GATEWAY_API_KEY;
  if (!key) throw new Error("VERCEL_AI_GATEWAY_API_KEY missing");
  return key;
}

/** AI SDK provider factory bound to the Vercel gateway. */
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
