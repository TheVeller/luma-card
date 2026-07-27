// The AI contract, exercised without a model: these are the cases where a
// plausible-looking tool call has to be refused, and refused in a way the model
// can act on.

import { describe, expect, test } from "bun:test";
import {
  buildLayoutBriefing,
  runApplyLayout,
  runPatchLayout,
  SetFontsInput,
  SetPaletteInput,
} from "../ai-tools";
import { CLASSIC_BADGE_DOC } from "../presets/classic";
import { findNode } from "../schema";

const doc = CLASSIC_BADGE_DOC;

describe("set_fonts", () => {
  test("accepts an allow-listed pair", () => {
    expect(SetFontsInput.safeParse({ heading: "Playfair Display", body: "Inter" }).success).toBe(
      true,
    );
  });

  test("refuses a font that is not on the list", () => {
    expect(SetFontsInput.safeParse({ heading: "Comic Sans MS", body: "Inter" }).success).toBe(
      false,
    );
  });

  test("refuses a body font that is only a heading font", () => {
    expect(SetFontsInput.safeParse({ heading: "Inter", body: "Bebas Neue" }).success).toBe(false);
  });
});

describe("set_palette", () => {
  test("requires all five roles", () => {
    expect(SetPaletteInput.safeParse({ bg: "#000000", accent: "#ffffff" }).success).toBe(false);
  });
});

describe("patch_layout", () => {
  test("moves the QR and reports the intent back", () => {
    const r = runPatchLayout(doc, {
      intent: "put the QR first",
      ops: [{ op: "move", nodeId: "qr-frame", parentId: "content", index: 0 }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.intent).toBe("put the QR first");
  });

  test("refuses to delete the QR and explains why", () => {
    const r = runPatchLayout(doc, {
      intent: "remove the QR",
      ops: [{ op: "remove", nodeId: "qr" }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].code).toBe("protected_removed");
    expect(r.hint).toContain("not removed");
  });

  test("a hallucinated node id is refused, not silently ignored", () => {
    const r = runPatchLayout(doc, {
      intent: "tweak the sticker",
      ops: [{ op: "set", nodeId: "sticker", path: "size", value: 40 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe("unknown_node");
  });

  test("an out-of-range value is refused", () => {
    const r = runPatchLayout(doc, {
      intent: "enormous headline",
      ops: [{ op: "set", nodeId: "headline", path: "size", value: 5000 }],
    });
    expect(r.ok).toBe(false);
  });

  test("the document handed in is never mutated by a refusal", () => {
    const before = JSON.stringify(doc);
    runPatchLayout(doc, { intent: "break it", ops: [{ op: "remove", nodeId: "photo" }] });
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe("apply_layout", () => {
  test("switches to a built-in composition", () => {
    const r = runApplyLayout({ preset: "poster", intent: "make it a poster" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.meta.name).toBe("Poster");
  });

  test("refuses a composition that does not exist", () => {
    const r = runApplyLayout({ preset: "brutalist" as never, intent: "brutalist" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe("unknown_preset");
  });
});

describe("briefing", () => {
  test("carries the ids and the rules, and stays cheap to send", () => {
    const text = buildLayoutBriefing(doc);
    expect(text).toContain("headline");
    expect(text).toContain("never removed");
    // Full document would be tens of KB; the outline has to stay far below that.
    expect(text.length).toBeLessThan(3000);
    expect(text.length).toBeLessThan(JSON.stringify(doc).length / 4);
  });
});
