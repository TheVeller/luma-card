// Guards the failure that killed the chat.
//
// Tool declarations travel together in one request, so a single schema the
// provider refuses takes the whole conversation down — the symptom is not "the
// layout tool misbehaves", it is "the assistant answers nothing at all".
//
// The cause was embedding the recursive node schema: 22 KB of JSON Schema with
// $ref. These bounds are deliberately loose; they only catch a return to that
// class of mistake.

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { ApplyLayoutInput, PatchLayoutInput, SetFontsInput, SetPaletteInput } from "../ai-tools";

const TOOLS: [string, z.ZodType][] = [
  ["set_palette", SetPaletteInput],
  ["set_fonts", SetFontsInput],
  ["patch_layout", PatchLayoutInput],
  ["apply_layout", ApplyLayoutInput],
];

const MAX_BYTES = 6000;
const MAX_DEPTH = 9;

function emitted(schema: z.ZodType): { text: string; depth: number } {
  const text = JSON.stringify(z.toJSONSchema(schema, { io: "input" }));
  let depth = 0;
  let max = 0;
  for (const c of text) {
    if (c === "{") max = Math.max(max, ++depth);
    if (c === "}") depth--;
  }
  return { text, depth: max };
}

describe("AI tool schemas stay flat", () => {
  for (const [name, schema] of TOOLS) {
    test(`${name} emits no $ref`, () => {
      // $ref means a recursive or shared definition; providers that accept only
      // a restricted OpenAPI subset reject the declaration outright.
      expect(emitted(schema).text).not.toContain('"$ref"');
    });

    test(`${name} stays small and shallow`, () => {
      const { text, depth } = emitted(schema);
      expect({ tool: name, bytes: text.length < MAX_BYTES }).toEqual({ tool: name, bytes: true });
      expect({ tool: name, depth: depth <= MAX_DEPTH }).toEqual({ tool: name, depth: true });
    });

    test(`${name} declares a type for every property`, () => {
      // z.unknown() emits {}, which some providers reject as an untyped field.
      expect(emitted(schema).text).not.toContain('"value":{}');
    });
  }

  test("the whole tool surface fits well inside a request", () => {
    const total = TOOLS.reduce((sum, [, s]) => sum + emitted(s).text.length, 0);
    expect(total).toBeLessThan(12000);
  });
});
