// BadgeDoc — the badge as data instead of code.
//
// The renderer used to hardcode every position, so nothing but a code edit could
// change a layout. Here a badge is a tree of nodes that the layout engine
// measures and a painter draws, which is what lets the AI (and, later, direct
// controls) recompose it.
//
// Two rules keep it safe to hand to a model:
//   - node ids are stable and human-readable; they double as Figma layer names
//   - colours, text and images are either literals or `$token` references that
//     resolve against a binding context, never arbitrary expressions

import { z } from "zod";

export const CURRENT_DOC_VERSION = 1;

/* ---------- primitives ---------- */

// "$ns.path" with optional "|filter(arg)" pipes, e.g. "$palette.text|alpha(0.7)"
const TOKEN_RE = /^\$[a-zA-Z]+(\.[a-zA-Z0-9_]+)*(\|[a-z]+(\([^)]*\))?)*$/;
export const Tokenized = z.string().regex(TOKEN_RE, "not a valid $token reference");

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
export const ColorRef = z.union([z.string().regex(HEX_RE), Tokenized]);
export const StringRef = z.union([z.string().max(400), Tokenized]);

export const NodeId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, "invalid node id");

/** number = all sides; [y,x]; [top,right,bottom,left] */
export const Edges = z.union([
  z.number(),
  z.tuple([z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number(), z.number()]),
]);

/** px | "auto" (intrinsic) | "fill" (all remaining) | {pct} of the parent content box */
export const Size = z.union([
  z.number().min(0).max(8000),
  z.literal("auto"),
  z.literal("fill"),
  z.object({ pct: z.number().min(0).max(100) }),
]);

export const Position = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("flow") }),
  z.object({
    mode: z.literal("absolute"),
    /** corner of the PARENT box the offsets are measured from */
    anchor: z.enum(["tl", "tc", "tr", "cl", "cc", "cr", "bl", "bc", "br"]).default("tl"),
    dx: z.number().default(0),
    dy: z.number().default(0),
  }),
]);

export const Stroke = z.object({
  color: ColorRef,
  width: z.number().min(0).max(80),
  /** inset from the node box; negative bleeds outward */
  inset: z.number().default(0),
});

/* ---------- shared node base ---------- */

const NodeBase = {
  id: NodeId,
  /** Figma layer name; defaults to a title-cased id */
  name: z.string().max(48).optional(),
  /** render only when this token resolves truthy */
  visibleIf: Tokenized.optional(),
  position: Position.optional(),
  width: Size.optional(),
  height: Size.optional(),
  minWidth: z.number().optional(),
  maxWidth: z.number().optional(),
  minHeight: z.number().optional(),
  maxHeight: z.number().optional(),
  /** height = width / aspect */
  aspect: z.number().positive().optional(),
  grow: z.number().min(0).max(10).default(0),
  shrink: z.number().min(0).max(10).default(0),
  margin: Edges.optional(),
  opacity: z.number().min(0).max(1).default(1),
  /** floor the resolved box to whole pixels (the photo does this today) */
  snap: z.boolean().default(false),
};

const ContainerBase = {
  ...NodeBase,
  pad: Edges.optional(),
  gap: z.number().min(0).max(400).default(0),
  /** cross axis */
  align: z.enum(["start", "center", "end", "stretch"]).default("start"),
  /** main axis */
  justify: z.enum(["start", "center", "end", "between"]).default("start"),
  fill: ColorRef.optional(),
  stroke: Stroke.optional(),
  radius: z.number().min(0).default(0),
  clip: z.enum(["none", "rect", "circle"]).default("none"),
};

/* ---------- leaves ---------- */

export const TextFit = z.object({
  /** none = draw at `size`; shrink = single line; shrinkWrap = wrap then shrink */
  mode: z.enum(["none", "shrink", "shrinkWrap"]),
  from: z.number().min(6).max(400),
  to: z.number().min(6).max(400),
  step: z.number().min(1).max(16).default(2),
  maxLines: z.number().int().min(1).max(8).default(1),
});

export const TextNode = z.object({
  type: z.literal("text"),
  ...NodeBase,
  text: StringRef,
  /** which of the two spec families to use */
  font: z.enum(["heading", "body"]).default("body"),
  weight: z.number().int().min(100).max(900).default(400),
  size: z.number().min(6).max(400).default(18),
  fit: TextFit.optional(),
  /** multiplier; the classic badge rounds size * 1.08 */
  lineHeight: z.number().min(0.7).max(3).default(1.08),
  /** em */
  tracking: z.number().min(-0.2).max(1).default(0),
  color: ColorRef.default("$palette.text"),
  align: z.enum(["left", "center", "right"]).default("left"),
  transform: z.enum(["none", "upper", "lower"]).default("none"),
});

export const ImageNode = z.object({
  type: z.literal("image"),
  ...NodeBase,
  src: StringRef,
  fit: z.enum(["contain", "cover"]).default("contain"),
  /** painted behind a letterboxed `contain` image */
  backdrop: ColorRef.optional(),
  shape: z.enum(["rect", "circle"]).default("rect"),
  stroke: Stroke.optional(),
});

export const QrNode = z.object({
  type: z.literal("qr"),
  ...NodeBase,
  value: StringRef,
  ecc: z.enum(["L", "M", "Q", "H"]).default("M"),
  /** quiet zone in modules */
  margin: z.number().int().min(0).max(8).default(2),
  dark: ColorRef.default("$palette.text"),
  light: ColorRef.default("$palette.surface"),
});

export const RectNode = z.object({
  type: z.literal("rect"),
  ...NodeBase,
  fill: ColorRef.optional(),
  stroke: Stroke.optional(),
  radius: z.number().min(0).default(0),
});

export const EllipseNode = z.object({
  type: z.literal("ellipse"),
  ...NodeBase,
  fill: ColorRef.optional(),
  stroke: Stroke.optional(),
});

export const SpacerNode = z.object({ type: z.literal("spacer"), ...NodeBase });

/* ---------- recursive union ---------- */

type Container = {
  type: "stack" | "row";
  children: BadgeNode[];
} & z.infer<z.ZodObject<typeof ContainerBase>>;

export type BadgeNode =
  | z.infer<typeof TextNode>
  | z.infer<typeof ImageNode>
  | z.infer<typeof QrNode>
  | z.infer<typeof RectNode>
  | z.infer<typeof EllipseNode>
  | z.infer<typeof SpacerNode>
  | Container;

export const BadgeNodeSchema: z.ZodType<BadgeNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    TextNode,
    ImageNode,
    QrNode,
    RectNode,
    EllipseNode,
    SpacerNode,
    z.object({
      type: z.literal("stack"),
      ...ContainerBase,
      children: z.array(BadgeNodeSchema).max(60),
    }),
    z.object({
      type: z.literal("row"),
      ...ContainerBase,
      children: z.array(BadgeNodeSchema).max(60),
    }),
  ]),
) as z.ZodType<BadgeNode>;

/* ---------- document ---------- */

export const BadgeDocSchema = z.object({
  version: z.literal(CURRENT_DOC_VERSION),
  meta: z
    .object({
      name: z.string().max(80).default("Untitled badge"),
      origin: z.enum(["system", "ai", "user"]).default("system"),
    })
    .default({ name: "Untitled badge", origin: "system" }),
  canvas: z.object({
    width: z.number().int().min(320).max(4096),
    height: z.number().int().min(320).max(4096),
    background: ColorRef.default("$palette.bg"),
  }),
  /** doc-local constants, referenced as $doc.<key> */
  vars: z
    .record(z.string().regex(/^[a-z][a-zA-Z0-9]*$/), z.union([z.number(), z.string()]))
    .default({}),
  root: BadgeNodeSchema,
});

export type BadgeDoc = z.infer<typeof BadgeDocSchema>;
export type ContainerNode = Container;

export function isContainer(node: BadgeNode): node is Container {
  return node.type === "stack" || node.type === "row";
}

/** Every node in paint order, depth first. */
export function walk(node: BadgeNode, visit: (n: BadgeNode, parent: BadgeNode | null) => void) {
  const rec = (n: BadgeNode, parent: BadgeNode | null) => {
    visit(n, parent);
    if (isContainer(n)) for (const c of n.children) rec(c, n);
  };
  rec(node, null);
}

export function findNode(root: BadgeNode, id: string): BadgeNode | null {
  let found: BadgeNode | null = null;
  walk(root, (n) => {
    if (!found && n.id === id) found = n;
  });
  return found;
}
