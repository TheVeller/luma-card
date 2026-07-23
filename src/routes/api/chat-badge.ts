import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, tool, stepCountIs, type UIMessage } from "ai";
import { createAIGateway } from "@/lib/ai-gateway.server";
import { StyleSpecSchema } from "@/lib/style-spec";

type EventContext = {
  name?: string;
  city?: string | null;
  dateLine?: string;
  description?: string | null;
  coverUrl?: string | null;
};

type Body = {
  messages?: UIMessage[];
  spec?: unknown;
  eventContext?: EventContext;
};

function buildSystem(eventContext: EventContext, currentSpec: string): string {
  const name = eventContext.name || "this event";
  const meta = [
    eventContext.dateLine ? `Date: ${eventContext.dateLine}` : null,
    eventContext.city ? `City: ${eventContext.city}` : null,
    eventContext.coverUrl ? `Cover: ${eventContext.coverUrl}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const desc = eventContext.description ? eventContext.description.slice(0, 400) : "";

  return `You help a user iterate on the visual design of a philatelic-stamp-style badge for the event "${name}".

You ALREADY have the event context — the user does not need to re-explain it. Use it to pick tasteful defaults and answer "why did you choose X?" style questions.

EVENT BRIEFING
${meta || "(no metadata)"}
${desc ? `Description: ${desc}` : ""}

CURRENT StyleSpec (canvas is rendering this right now):
${currentSpec}

BEHAVIOR
- Respond in 1–2 concise sentences.
- When the user asks for a visual change ("make it darker", "use a serif", "warmer accent", "more punk"), CALL the "update_style" tool with the NEW COMPLETE StyleSpec — copy unchanged fields from the current spec, never omit any.
- Colors are #rrggbb. Fonts are real Google Fonts family names.
- Keep text vs bg WCAG contrast ≥ 4.5. If a user request would break this, propose a nearby correction.
- If the user only wants to chat (no visual change), don't call the tool.`;
}

export const Route = createFileRoute("/api/chat-badge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as Body;
        if (!Array.isArray(body.messages)) {
          return new Response("messages required", { status: 400 });
        }
        const currentSpec = JSON.stringify(body.spec ?? {}, null, 2);
        const gateway = createAIGateway();
        const model = gateway("google/gemini-2.5-flash");

        const result = streamText({
          model,
          system: buildSystem(body.eventContext ?? {}, currentSpec),
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
