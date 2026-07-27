// What the AI is allowed to do to a badge, and how a bad attempt is handled.
//
// The old contract had one tool that returned the whole StyleSpec every turn.
// That is fine for five colours and two fonts, but a layout document is 10-30x
// larger and the model reliably drops fields it did not mean to touch. So:
// small, addressed edits for the common case, and a full replacement only when
// the user genuinely wants a different composition.
//
// Failures come back as tool RESULTS, not thrown errors, so the model can read
// the diagnostics and correct itself within its step budget.

import { z } from "zod";
import { GOOGLE_BODY_FONTS, GOOGLE_HEADING_FONTS } from "@/lib/google-fonts";
import { StyleSpecSchema } from "@/lib/style-spec";
import { applyPatch, outline, PatchOpSchema, validateDoc, type PatchError } from "./patch";
import { BadgeDocSchema, type BadgeDoc } from "./schema";

export const SetPaletteInput = StyleSpecSchema.shape.palette;

export const SetFontsInput = z.object({
  heading: z.enum(GOOGLE_HEADING_FONTS),
  body: z.enum(GOOGLE_BODY_FONTS),
});

export const PatchLayoutInput = z.object({
  /** shown in the UI and used as the undo label */
  intent: z.string().max(120),
  ops: z.array(PatchOpSchema).min(1).max(20),
});

export const ReplaceLayoutInput = z.object({
  intent: z.string().max(120),
  doc: BadgeDocSchema,
});

export type ToolOutcome =
  | { ok: true; doc: BadgeDoc; intent: string }
  | { ok: false; errors: PatchError[]; hint: string };

function failure(errors: PatchError[]): ToolOutcome {
  return {
    ok: false,
    errors,
    hint:
      "Nothing was changed. Fix the listed problems and try again — " +
      "address nodes by the ids in the layout outline, and remember that the photo, " +
      "the QR, the person's name and the event details can be moved or restyled but not removed.",
  };
}

/** Applies a patch from the model, or explains why it was refused. */
export function runPatchLayout(
  doc: BadgeDoc,
  input: z.infer<typeof PatchLayoutInput>,
): ToolOutcome {
  const result = applyPatch(doc, input.ops);
  if (!result.ok) return failure(result.errors);
  return { ok: true, doc: result.doc, intent: input.intent };
}

/** Accepts a wholesale new composition, held to the same invariants. */
export function runReplaceLayout(
  current: BadgeDoc,
  input: z.infer<typeof ReplaceLayoutInput>,
): ToolOutcome {
  const errors = validateDoc(input.doc);
  if (errors.length) return failure(errors);
  // A replacement still has to keep the canvas it was given.
  if (
    input.doc.canvas.width !== current.canvas.width ||
    input.doc.canvas.height !== current.canvas.height
  ) {
    return failure([
      {
        code: "canvas_changed",
        message: `canvas must stay ${current.canvas.width}x${current.canvas.height}`,
      },
    ]);
  }
  return { ok: true, doc: input.doc, intent: input.intent };
}

/**
 * The context the model needs, kept deliberately small: an outline of the tree
 * rather than the document itself. Sending the full doc every turn is what made
 * the previous contract expensive and lossy.
 */
export function buildLayoutBriefing(doc: BadgeDoc): string {
  return [
    "LAYOUT OUTLINE (address nodes by these ids):",
    outline(doc),
    "",
    "Editing rules:",
    "- Prefer patch_layout with the smallest set of ops that achieves the request.",
    "- Use replace_layout only when the user asks for a fundamentally different composition.",
    "- photo, qr, name, headline, meta and scan-url may be moved, resized or restyled, never removed.",
    "- Colours are #rrggbb or $palette tokens; fonts must come from the allowed lists.",
  ].join("\n");
}
