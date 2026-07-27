import { describe, expect, test } from "bun:test";
import { applyPatch, outline, validateDoc, type PatchOp } from "../patch";
import { CLASSIC_BADGE_DOC } from "../presets/classic";
import { findNode, type BadgeDoc } from "../schema";

const doc = CLASSIC_BADGE_DOC;

function apply(...ops: PatchOp[]) {
  return applyPatch(doc, ops);
}

describe("the classic document is valid", () => {
  test("passes every structural check", () => {
    expect(validateDoc(doc)).toEqual([]);
  });
});

describe("set", () => {
  test("changes a property and leaves the original alone", () => {
    const r = apply({ op: "set", nodeId: "kicker", path: "text", value: "· HELLO?" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((findNode(r.doc.root, "kicker") as { text: string }).text).toBe("· HELLO?");
    expect((findNode(doc.root, "kicker") as { text: string }).text).toBe("· WHAT'S BREWING?");
  });

  test("reaches nested properties", () => {
    const r = apply({ op: "set", nodeId: "headline", path: "fit.to", value: 60 });
    expect(r.ok).toBe(true);
    if (r.ok) expect((findNode(r.doc.root, "headline") as { fit: { to: number } }).fit.to).toBe(60);
  });

  test("rejects an unknown node", () => {
    const r = apply({ op: "set", nodeId: "nope", path: "size", value: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe("unknown_node");
  });

  test("a value the schema refuses is rejected, not written", () => {
    const r = apply({ op: "set", nodeId: "kicker", path: "size", value: 9999 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe("schema");
  });
});

describe("structure", () => {
  test("moves a node between containers", () => {
    const r = apply({ op: "move", nodeId: "caption", parentId: "header-text", index: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const header = findNode(r.doc.root, "header-text") as { children: { id: string }[] };
    expect(header.children[0].id).toBe("caption");
  });

  test("reorders children", () => {
    const r = apply({
      op: "reorder",
      parentId: "header-text",
      order: ["meta", "headline", "kicker"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const header = findNode(r.doc.root, "header-text") as { children: { id: string }[] };
    expect(header.children.map((c) => c.id)).toEqual(["meta", "headline", "kicker"]);
  });

  test("removes an unprotected node", () => {
    const r = apply({ op: "remove", nodeId: "kicker" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(findNode(r.doc.root, "kicker")).toBeNull();
  });

  test("inserts a new node", () => {
    const r = apply({
      op: "insert",
      parentId: "header-text",
      index: 0,
      node: {
        type: "text",
        id: "tagline",
        text: "HELLO",
        font: "body",
        weight: 400,
        size: 18,
        lineHeight: 1.08,
        tracking: 0,
        color: "$palette.text",
        align: "left",
        transform: "none",
        grow: 0,
        shrink: 0,
        alignSelf: "auto",
        opacity: 1,
        snap: false,
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(findNode(r.doc.root, "tagline")).not.toBeNull();
  });

  test("refuses a duplicate id", () => {
    const r = apply({
      op: "insert",
      parentId: "header-text",
      index: 0,
      node: { ...(findNode(doc.root, "kicker") as never) },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe("duplicate_id");
  });

  test("refuses to move a node inside itself", () => {
    const r = apply({ op: "move", nodeId: "content", parentId: "header-text", index: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe("cycle");
  });
});

describe("protected nodes", () => {
  for (const id of ["photo", "qr", "name", "headline"]) {
    test(`${id} cannot be removed`, () => {
      const r = apply({ op: "remove", nodeId: id });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.some((e) => e.code === "protected_removed")).toBe(true);
    });
  }

  test("but they can be moved and restyled", () => {
    const r = apply(
      { op: "move", nodeId: "qr-frame", parentId: "content", index: 0 },
      { op: "set", nodeId: "name", path: "align", value: "center" },
    );
    expect(r.ok).toBe(true);
  });
});

describe("hostile input", () => {
  test("cannot write __proto__ — the path is an allow-list", () => {
    const op = { op: "set", nodeId: "kicker", path: "__proto__", value: { polluted: true } };
    const r = applyPatch(doc, [op as never]);
    expect(r.ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("rejects an unknown token namespace", () => {
    const r = apply({ op: "set", nodeId: "kicker", path: "color", value: "$secrets.apiKey" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "unknown_namespace")).toBe(true);
  });

  test("rejects an unknown filter", () => {
    const r = apply({ op: "set", nodeId: "kicker", path: "text", value: "$event.name|exec(rm)" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "unknown_filter")).toBe(true);
  });

  test("a failed op in a batch leaves the document untouched", () => {
    const r = apply(
      { op: "set", nodeId: "kicker", path: "text", value: "· FIRST" },
      { op: "remove", nodeId: "qr" },
    );
    expect(r.ok).toBe(false);
    expect((findNode(doc.root, "kicker") as { text: string }).text).toBe("· WHAT'S BREWING?");
  });
});

describe("outline", () => {
  test("names every node and stays small", () => {
    const text = outline(doc);
    for (const id of ["badge", "headline", "photo", "qr", "footer"]) {
      expect(text).toContain(id);
    }
    // The point of the outline is that it is cheap to send.
    expect(text.split("\n").length).toBeLessThan(45);
    expect(text.length).toBeLessThan(2600);
  });
});

describe("validateDoc", () => {
  test("catches a duplicate id anywhere in the tree", () => {
    const broken = structuredClone(doc) as BadgeDoc;
    const header = findNode(broken.root, "header-text") as { children: { id: string }[] };
    header.children[0].id = "footer";
    expect(validateDoc(broken).some((e) => e.code === "duplicate_id")).toBe(true);
  });
});
