import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, tool, stepCountIs, type UIMessage } from "ai";
import { createAIGateway } from "@/lib/ai-gateway.server";
import { StyleSpecSchema } from "@/lib/style-spec";
import {
  buildLayoutBriefing,
  PatchLayoutInput,
  ReplaceLayoutInput,
  runPatchLayout,
  runReplaceLayout,
  SetFontsInput,
  SetPaletteInput,
} from "@/lib/badge-doc/ai-tools";
import { BadgeDocSchema } from "@/lib/badge-doc/schema";
import { CLASSIC_BADGE_DOC } from "@/lib/badge-doc/presets/classic";

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
  doc?: unknown;
  eventContext?: EventContext;
};

function buildSystem(eventContext: EventContext, currentSpec: string, briefing: string): string {
  const name = eventContext.name || "this event";
  const meta = [
    eventContext.dateLine ? `Date: ${eventContext.dateLine}` : null,
    eventContext.city ? `City: ${eventContext.city}` : null,
    eventContext.coverUrl ? `Cover: ${eventContext.coverUrl}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const desc = eventContext.description ? eventContext.description.slice(0, 400) : "";

  return `You help a user iterate on a philatelic-stamp-style badge for the event "${name}".

You ALREADY have the event context — the user does not need to re-explain it. Use it to pick tasteful defaults and to answer "why did you choose X?" questions.

EVENT BRIEFING
${meta || "(no metadata)"}
${desc ? `Description: ${desc}` : ""}

CURRENT PALETTE AND FONTS
${currentSpec}

${briefing}

BEHAVIOR
- Respond in 1–2 concise sentences.
- Colour or typography request ("darker", "warmer accent", "use a serif") → set_palette or set_fonts.
- Layout request ("move the photo up", "bigger name", "drop the kicker", "put the QR on the left") → patch_layout.
- Only a request for a genuinely different composition warrants replace_layout.
- Keep text vs background WCAG contrast ≥ 4.5; if a request would break it, propose a nearby correction.
- A tool may answer {ok:false, errors}. Read the errors, fix the ops and retry once; do not repeat the same call.
- If the user only wants to chat, do not call a tool.`;
}

export const Route = createFileRoute("/api/chat-badge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as Body;
        if (!Array.isArray(body.messages)) {
          return new Response("messages required", { status: 400 });
        }

        // An unparseable doc falls back to the classic layout rather than
        // failing the conversation.
        const parsedDoc = BadgeDocSchema.safeParse(body.doc);
        const doc = parsedDoc.success ? parsedDoc.data : CLASSIC_BADGE_DOC;

        const currentSpec = JSON.stringify(body.spec ?? {}, null, 2);
        const gateway = createAIGateway();
        const model = gateway("google/gemini-2.5-flash");

        const result = streamText({
          model,
          system: buildSystem(body.eventContext ?? {}, currentSpec, buildLayoutBriefing(doc)),
          messages: await convertToModelMessages(body.messages),
          tools: {
            set_palette: tool({
              description: "Change the badge colours. Provide all five roles.",
              inputSchema: SetPaletteInput,
              execute: async (palette) => ({ ok: true, palette }),
            }),
            set_fonts: tool({
              description: "Change the font pair. Both must come from the allowed lists.",
              inputSchema: SetFontsInput,
              execute: async (fonts) => ({ ok: true, fonts }),
            }),
            patch_layout: tool({
              description:
                "Apply small structural edits to the layout: move, resize, restyle, reorder, " +
                "add or remove nodes. Address nodes by the ids in the layout outline. " +
                "Prefer this over replace_layout.",
              inputSchema: PatchLayoutInput,
              execute: async (input) => runPatchLayout(doc, input),
            }),
            replace_layout: tool({
              description:
                "Replace the whole layout with a new document. Use only for a fundamentally " +
                "different composition; the canvas size must stay the same.",
              inputSchema: ReplaceLayoutInput,
              execute: async (input) => runReplaceLayout(doc, input),
            }),
            // Kept during the transition so an older client still works; the
            // new client uses set_palette + set_fonts.
            update_style: tool({
              description: "Deprecated. Prefer set_palette and set_fonts.",
              inputSchema: StyleSpecSchema,
              execute: async (spec) => ({ ok: true, spec }),
            }),
          },
          stopWhen: stepCountIs(6),
        });

        return result.toUIMessageStreamResponse();
      },
    },
  },
});
