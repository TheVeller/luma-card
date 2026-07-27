// Editing a BadgeDoc, safely.
//
// Both the manual controls and the AI go through these operations, so there is
// one place that decides what a valid edit is. Ops address nodes by id rather
// than by path: a JSON pointer like /root/children/3/children/1 breaks the
// moment a sibling moves, and it is unreadable to a model.
//
// Nothing here mutates the input. A rejected patch leaves the document alone.

import { z } from "zod";
import {
  BadgeDocSchema,
  BadgeNodeSchema,
  isContainer,
  NodeId,
  walk,
  type BadgeDoc,
  type BadgeNode,
  type ContainerNode,
} from "./schema";
import { FILTER_NAMES, NAMESPACES } from "./tokens";

/**
 * Properties an edit may touch. An allow-list, not a free path: it keeps
 * `__proto__`, `id` (which would break addressing) and `type` (which would
 * break the node union) out of reach.
 */
export const PATCH_PATHS = [
  "text",
  "size",
  "weight",
  "color",
  "fill",
  "gap",
  "pad",
  "align",
  "justify",
  "alignSelf",
  "grow",
  "shrink",
  "width",
  "height",
  "margin",
  "opacity",
  "radius",
  "lineHeight",
  "tracking",
  "transform",
  "visibleIf",
  "name",
  "font",
  "clip",
  "fit.from",
  "fit.to",
  "fit.maxLines",
  "stroke.color",
  "stroke.width",
  "position.anchor",
  "position.dx",
  "position.dy",
] as const;

export const PatchOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), nodeId: NodeId, path: z.enum(PATCH_PATHS), value: z.unknown() }),
  z.object({
    op: z.literal("insert"),
    parentId: NodeId,
    index: z.number().int().min(0).max(60),
    node: BadgeNodeSchema,
  }),
  z.object({ op: z.literal("remove"), nodeId: NodeId }),
  z.object({
    op: z.literal("move"),
    nodeId: NodeId,
    parentId: NodeId,
    index: z.number().int().min(0).max(60),
  }),
  z.object({ op: z.literal("reorder"), parentId: NodeId, order: z.array(NodeId).max(60) }),
  z.object({
    op: z.literal("setVar"),
    key: z.string().max(40),
    value: z.union([z.number(), z.string()]),
  }),
]);

export type PatchOp = z.infer<typeof PatchOpSchema>;

export type PatchError = { code: string; nodeId?: string; message: string };
export type PatchResult = { ok: true; doc: BadgeDoc } | { ok: false; errors: PatchError[] };

/**
 * Nodes a patch may restyle or move but never delete. A badge that has lost the
 * person's face, their name, the event it belongs to or the way to register for
 * it has stopped doing its job.
 */
export const PROTECTED_NODE_IDS = [
  "photo",
  "photo-image",
  "qr",
  "name",
  "headline",
  "scan-url",
  "meta",
] as const;

const MAX_NODES = 120;
const MAX_DEPTH = 8;

/* ---------- helpers ---------- */

function clone(doc: BadgeDoc): BadgeDoc {
  return structuredClone(doc);
}

function parentOf(doc: BadgeDoc, id: string): ContainerNode | null {
  let found: ContainerNode | null = null;
  walk(doc.root, (n) => {
    if (!found && isContainer(n) && n.children.some((c) => c.id === id)) found = n;
  });
  return found;
}

function nodeById(doc: BadgeDoc, id: string): BadgeNode | null {
  let found: BadgeNode | null = null;
  walk(doc.root, (n) => {
    if (!found && n.id === id) found = n;
  });
  return found;
}

function containerById(doc: BadgeDoc, id: string): ContainerNode | null {
  const n = nodeById(doc, id);
  return n && isContainer(n) ? n : null;
}

function contains(root: BadgeNode, id: string): boolean {
  let hit = false;
  walk(root, (n) => {
    if (n.id === id) hit = true;
  });
  return hit;
}

function setDeep(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur = target;
  for (const key of parts.slice(0, -1)) {
    if (typeof cur[key] !== "object" || cur[key] === null) cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

/* ---------- structural checks ---------- */

function depthOf(node: BadgeNode, level = 1): number {
  if (!isContainer(node)) return level;
  return Math.max(level, ...node.children.map((c) => depthOf(c, level + 1)));
}

const TOKEN_RE = /\$([a-zA-Z]+)((?:\.[a-zA-Z0-9_]+)*)((?:\|[a-zA-Z]+(?:\([^)]*\))?)*)/g;

function checkTokens(doc: BadgeDoc, errors: PatchError[]): void {
  const inspect = (value: unknown, nodeId: string) => {
    if (typeof value !== "string" || !value.includes("$")) return;
    for (const m of value.matchAll(TOKEN_RE)) {
      if (!NAMESPACES.includes(m[1]) && m[1] !== "photo" && m[1] !== "accent") {
        errors.push({ code: "unknown_namespace", nodeId, message: `unknown $${m[1]}` });
      }
      for (const pipe of m[3].split("|").filter(Boolean)) {
        const name = pipe.split("(")[0];
        if (!FILTER_NAMES.includes(name)) {
          errors.push({ code: "unknown_filter", nodeId, message: `unknown filter |${name}` });
        }
      }
    }
  };
  walk(doc.root, (n) => {
    for (const v of Object.values(n as Record<string, unknown>)) {
      if (typeof v === "string") inspect(v, n.id);
      else if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const inner of Object.values(v as Record<string, unknown>)) inspect(inner, n.id);
      }
    }
  });
}

/** Everything that must hold before a document is allowed to render. */
export function validateDoc(
  doc: BadgeDoc,
  opts: { protect?: readonly string[] } = {},
): PatchError[] {
  const errors: PatchError[] = [];

  const parsed = BadgeDocSchema.safeParse(doc);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 8)) {
      errors.push({ code: "schema", message: `${issue.path.join(".")}: ${issue.message}` });
    }
    return errors;
  }

  const seen = new Set<string>();
  let count = 0;
  walk(doc.root, (n) => {
    count++;
    if (seen.has(n.id))
      errors.push({ code: "duplicate_id", nodeId: n.id, message: `duplicate id ${n.id}` });
    seen.add(n.id);
  });
  if (count > MAX_NODES)
    errors.push({ code: "too_many_nodes", message: `${count} nodes, max ${MAX_NODES}` });
  if (depthOf(doc.root) > MAX_DEPTH)
    errors.push({ code: "too_deep", message: `deeper than ${MAX_DEPTH}` });

  for (const id of opts.protect ?? PROTECTED_NODE_IDS) {
    if (!seen.has(id)) {
      errors.push({
        code: "protected_removed",
        nodeId: id,
        message: `${id} may be moved or restyled, not removed`,
      });
    }
  }

  checkTokens(doc, errors);
  return errors;
}

/* ---------- apply ---------- */

/** Applies ops in order to a copy. Any failure leaves the original untouched. */
export function applyPatch(
  doc: BadgeDoc,
  ops: PatchOp[],
  opts: { protect?: readonly string[] } = {},
): PatchResult {
  const next = clone(doc);
  const errors: PatchError[] = [];
  // Only ids present before the patch are protected; a node the patch itself
  // adds and removes again is nobody's business.
  const protect = (opts.protect ?? PROTECTED_NODE_IDS).filter((id) => nodeById(doc, id) !== null);

  // Re-check the ops here rather than trusting the caller: this is the single
  // door both the AI tools and the manual controls come through, and it is what
  // keeps `path` an allow-list instead of an arbitrary property write.
  const checked: PatchOp[] = [];
  for (const raw of ops) {
    const parsed = PatchOpSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push({
        code: "invalid_op",
        message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
      return { ok: false, errors };
    }
    checked.push(parsed.data);
  }

  for (const op of checked) {
    switch (op.op) {
      case "set": {
        const node = nodeById(next, op.nodeId);
        if (!node) {
          errors.push({ code: "unknown_node", nodeId: op.nodeId, message: `no node ${op.nodeId}` });
          break;
        }
        setDeep(node as unknown as Record<string, unknown>, op.path, op.value);
        break;
      }

      case "insert": {
        const parent = containerById(next, op.parentId);
        if (!parent) {
          errors.push({
            code: "unknown_parent",
            nodeId: op.parentId,
            message: `${op.parentId} is not a container`,
          });
          break;
        }
        if (nodeById(next, op.node.id)) {
          errors.push({
            code: "duplicate_id",
            nodeId: op.node.id,
            message: `${op.node.id} already exists`,
          });
          break;
        }
        parent.children.splice(Math.min(op.index, parent.children.length), 0, op.node);
        break;
      }

      case "remove": {
        if (op.nodeId === next.root.id) {
          errors.push({ code: "remove_root", message: "the root cannot be removed" });
          break;
        }
        const parent = parentOf(next, op.nodeId);
        if (!parent) {
          errors.push({ code: "unknown_node", nodeId: op.nodeId, message: `no node ${op.nodeId}` });
          break;
        }
        parent.children = parent.children.filter((c) => c.id !== op.nodeId);
        break;
      }

      case "move": {
        const node = nodeById(next, op.nodeId);
        const parent = containerById(next, op.parentId);
        if (!node || !parent) {
          errors.push({
            code: "unknown_node",
            nodeId: op.nodeId,
            message: "node or target parent not found",
          });
          break;
        }
        if (contains(node, op.parentId)) {
          errors.push({
            code: "cycle",
            nodeId: op.nodeId,
            message: "a node cannot be moved inside itself",
          });
          break;
        }
        const from = parentOf(next, op.nodeId);
        if (from) from.children = from.children.filter((c) => c.id !== op.nodeId);
        parent.children.splice(Math.min(op.index, parent.children.length), 0, node);
        break;
      }

      case "reorder": {
        const parent = containerById(next, op.parentId);
        if (!parent) {
          errors.push({
            code: "unknown_parent",
            nodeId: op.parentId,
            message: `${op.parentId} is not a container`,
          });
          break;
        }
        const byId = new Map(parent.children.map((c) => [c.id, c]));
        const ordered = op.order
          .map((id) => byId.get(id))
          .filter((c): c is BadgeNode => Boolean(c));
        const rest = parent.children.filter((c) => !op.order.includes(c.id));
        if (ordered.length !== op.order.length) {
          errors.push({
            code: "unknown_node",
            nodeId: op.parentId,
            message: "reorder listed a node that is not a child",
          });
          break;
        }
        parent.children = [...ordered, ...rest];
        break;
      }

      case "setVar":
        next.vars[op.key] = op.value;
        break;
    }
    if (errors.length) return { ok: false, errors };
  }

  const invalid = validateDoc(next, { protect });
  if (invalid.length) return { ok: false, errors: invalid };
  return { ok: true, doc: next };
}

/* ---------- outline ---------- */

/**
 * A compact tree summary for the AI: ids, types and the few properties that
 * matter. Sending the whole document every turn would be 10-30x the tokens and
 * invites the model to drop fields it did not mean to touch.
 */
export function outline(doc: BadgeDoc): string {
  const lines: string[] = [];
  const rec = (node: BadgeNode, depth: number) => {
    const pad = "  ".repeat(depth);
    const bits: string[] = [node.type];
    if (node.type === "text") {
      bits.push(
        `"${node.text}"`,
        `w${node.weight}`,
        `${node.fit ? `fit ${node.fit.from}→${node.fit.to}` : `${node.size}px`}`,
      );
      if (node.align !== "left") bits.push(node.align);
    }
    if (isContainer(node) && node.gap) bits.push(`gap ${node.gap}`);
    if (node.grow) bits.push(`grow ${node.grow}`);
    if (node.shrink) bits.push(`shrink ${node.shrink}`);
    if (node.position?.mode === "absolute") bits.push(`abs ${node.position.anchor}`);
    if (node.visibleIf) bits.push(`if ${node.visibleIf}`);
    lines.push(`${pad}${node.id} (${bits.join(", ")})`);
    if (isContainer(node)) for (const c of node.children) rec(c, depth + 1);
  };
  rec(doc.root, 0);
  return lines.join("\n");
}
