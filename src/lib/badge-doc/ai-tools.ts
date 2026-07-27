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
//
// Every input schema here must stay FLAT. Tool declarations are sent together,
// so one schema the provider refuses takes the whole conversation with it —
// which is exactly what happened when these embedded the recursive node schema:
// 22 KB of JSON Schema with $ref, and the chat answered nothing at all. The
// same operations expressed flatly are 1.8 KB with no $ref. schema-size.test.ts
// fails the build if that ever creeps back.

import { z } from "zod";
import { GOOGLE_BODY_FONTS, GOOGLE_HEADING_FONTS } from "@/lib/google-fonts";
import { StyleSpecSchema } from "@/lib/style-spec";
import {
  applyPatch,
  outline,
  PATCH_PATHS,
  validateDoc,
  type PatchError,
  type PatchOp,
} from "./patch";
import { LAYOUT_PRESET_IDS, layoutPreset } from "./presets";
import type { BadgeDoc } from "./schema";

export const SetPaletteInput = StyleSpecSchema.shape.palette;

export const SetFontsInput = z.object({
  heading: z.enum(GOOGLE_HEADING_FONTS),
  body: z.enum(GOOGLE_BODY_FONTS),
});

const NodeIdRef = z.string().max(40).describe("id of a node from the layout outline");

/**
 * The model's view of an edit. Narrower than PatchOp on purpose: `add_text`
 * replaces the generic `insert` (which carried the recursive node schema), and
 * `value` is limited to primitives instead of `unknown`.
 */
const ModelOp = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("set"),
    nodeId: NodeIdRef,
    path: z.enum(PATCH_PATHS),
    value: z.union([z.string(), z.number(), z.boolean()]),
  }),
  z.object({ op: z.literal("remove"), nodeId: NodeIdRef }),
  z.object({
    op: z.literal("move"),
    nodeId: NodeIdRef,
    parentId: NodeIdRef,
    index: z.number().int().min(0).max(60),
  }),
  z.object({ op: z.literal("reorder"), parentId: NodeIdRef, order: z.array(NodeIdRef).max(60) }),
  z.object({
    op: z.literal("add_text"),
    parentId: NodeIdRef,
    index: z.number().int().min(0).max(60),
    id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
    text: z.string().max(400),
    font: z.enum(["heading", "body"]),
    size: z.number().min(6).max(400),
    weight: z.number().int().min(100).max(900),
    color: z.string().max(60),
    align: z.enum(["left", "center", "right"]),
  }),
]);

export type ModelOpInput = z.infer<typeof ModelOp>;

export const PatchLayoutInput = z.object({
  /** shown in the UI and used as the undo label */
  intent: z.string().max(120),
  ops: z.array(ModelOp).min(1).max(20),
});

export const ApplyLayoutInput = z.object({
  preset: z.enum(LAYOUT_PRESET_IDS),
  intent: z.string().max(120),
});

/** Expands the model's narrow op into the full one applyPatch understands. */
function toPatchOp(op: ModelOpInput): PatchOp {
  if (op.op !== "add_text") return op as PatchOp;
  return {
    op: "insert",
    parentId: op.parentId,
    index: op.index,
    node: {
      type: "text",
      id: op.id,
      text: op.text,
      font: op.font,
      weight: op.weight,
      size: op.size,
      lineHeight: 1.08,
      tracking: 0,
      color: op.color,
      align: op.align,
      transform: "none",
      grow: 0,
      shrink: 0,
      alignSelf: "auto",
      opacity: 1,
      snap: false,
    },
  };
}

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
  const result = applyPatch(doc, input.ops.map(toPatchOp));
  if (!result.ok) return failure(result.errors);
  return { ok: true, doc: result.doc, intent: input.intent };
}

/**
 * Switches to a different built-in composition. The model picks a base and then
 * patches it, rather than authoring a whole document — which is both what the
 * user asked for and what keeps the tool schema small.
 */
export function runApplyLayout(input: z.infer<typeof ApplyLayoutInput>): ToolOutcome {
  const doc = layoutPreset(input.preset);
  if (!doc) {
    return failure([{ code: "unknown_preset", message: `no layout called ${input.preset}` }]);
  }
  const errors = validateDoc(doc);
  if (errors.length) return failure(errors);
  return { ok: true, doc, intent: input.intent };
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
    "- Use apply_layout (classic/poster/spotlight/minimal) for a fundamentally different look, then patch it.",
    "- The portrait, the name, the event headline, the QR and the link may be moved, resized or restyled, never removed.",
    "- Colours are #rrggbb or $palette tokens; fonts must come from the allowed lists.",
  ].join("\n");
}
