import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, tool, stepCountIs, type UIMessage } from "ai";
import { z } from "zod";
import { createAIGateway } from "@/lib/ai-gateway.server";
import { StyleSpecSchema } from "@/lib/style-spec";

type Body = {
  messages?: UIMessage[];
  spec?: unknown;
  eventName?: string;
};

const SYSTEM = (eventName: string, currentSpec: string) => `You help a user iterate on the visual design of a philatelic-stamp-style badge for the event "${eventName}".

The badge is rendered by a canvas from a StyleSpec (palette + Google Fonts + hero prompt). When the user asks for a change ("make it darker", "use a serif heading", "more punk"), respond briefly (1-2 sentences) AND call the "update_style" tool with the NEW complete StyleSpec.

Current StyleSpec:
${currentSpec}

Rules:
- Every StyleSpec property is REQUIRED. Do not omit fields — copy unchanged values from the current spec.
- Colors are #rrggbb hex.
- Fonts are real Google Fonts family names.
- heroPrompt describes the badge background image — NO text, NO letters, NO logos, NO overlays.
- If the user only wants to chat (no visual change), don't call the tool.`;

export const Route = createFileRoute("/api/chat-badge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as Body;
        if (!Array.isArray(body.messages)) {
          return new Response("messages required", { status: 400 });
        }
        const eventName = body.eventName || "this event";
        const currentSpec = JSON.stringify(body.spec ?? {}, null, 2);

        const gateway = createAIGateway();
        const model = gateway("google/gemini-3.6-flash");

        const result = streamText({
          model,
          system: SYSTEM(eventName, currentSpec),
          messages: await convertToModelMessages(body.messages),
          tools: {
            update_style: tool({
              description: "Apply a new StyleSpec to the badge. Include ALL fields.",
              inputSchema: StyleSpecSchema,
              execute: async (spec) => ({ ok: true, spec }),
            }),
          },
          stopWhen: stepCountIs(3),
        });

        return result.toUIMessageStreamResponse();
      },
    },
  },
});
