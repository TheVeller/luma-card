// The layout pass: BadgeDoc + bindings -> a flat list of paint operations.
//
// Pure and synchronous on purpose. No DOM, no fetch, no measureText — image
// sizes arrive through bindings.assets and text is measured off the tables.
// That is what lets the same numbers come out in the browser and on the server,
// which is the whole reason the SVG export can match the canvas preview.
//
// Passes: resolve -> widths (top-down) -> heights (bottom-up, autofit here) ->
// shrink -> position -> emit.

import { isContainer, type BadgeDoc, type BadgeNode, type ContainerNode } from "../schema";
import {
  resolveColor,
  resolveString,
  resolveTruthy,
  type BindingContext,
  type ImageAsset,
  type ResolvedColor,
} from "../tokens";
import { fitSingleLine, fitWrapped, type FittedText } from "./fit";
import type { FontRequest, TextMeasurer } from "./measure";

export type Rect = { x: number; y: number; w: number; h: number };

export type StrokeOp = { color: ResolvedColor; width: number; inset: number };

export type RenderOp =
  | {
      k: "group-in";
      id: string;
      name: string;
      opacity: number;
      clip?: { shape: "rect" | "circle"; rect: Rect };
    }
  | { k: "group-out" }
  | { k: "rect"; id: string; rect: Rect; fill?: ResolvedColor; stroke?: StrokeOp; radius: number }
  | { k: "ellipse"; id: string; rect: Rect; fill?: ResolvedColor; stroke?: StrokeOp }
  | {
      k: "text";
      id: string;
      name: string;
      lines: { text: string; x: number; baselineY: number; width: number }[];
      family: string;
      weight: number;
      size: number;
      tracking: number;
      color: ResolvedColor;
    }
  | {
      k: "image";
      id: string;
      asset: ImageAsset;
      /** where the pixels land, letterboxing already applied */
      dstRect: Rect;
      /** source crop for `cover` */
      srcRect: Rect;
      shape: "rect" | "circle";
      backdrop?: ResolvedColor;
      /** box the backdrop fills (the node box, not the letterboxed image) */
      box: Rect;
      stroke?: StrokeOp;
    }
  | {
      k: "qr";
      id: string;
      rect: Rect;
      value: string;
      ecc: string;
      quietZone: number;
      dark: ResolvedColor;
      light: ResolvedColor;
    };

/* ---------- edges ---------- */

type Box = { top: number; right: number; bottom: number; left: number };
const NO_BOX: Box = { top: 0, right: 0, bottom: 0, left: 0 };

function edges(e: number | [number, number] | [number, number, number, number] | undefined): Box {
  if (e === undefined) return NO_BOX;
  if (typeof e === "number") return { top: e, right: e, bottom: e, left: e };
  if (e.length === 2) return { top: e[0], right: e[1], bottom: e[0], left: e[1] };
  return { top: e[0], right: e[1], bottom: e[2], left: e[3] };
}

/* ---------- resolved tree ---------- */

type Measured = {
  node: BadgeNode;
  children: Measured[];
  /** content of text nodes after transform + token resolution */
  text?: string;
  fitted?: FittedText;
  asset?: ImageAsset;
  margin: Box;
  pad: Box;
  w: number;
  h: number;
  x: number;
  y: number;
};

function transformText(s: string, mode: "none" | "upper" | "lower"): string {
  return mode === "upper" ? s.toUpperCase() : mode === "lower" ? s.toLowerCase() : s;
}

function clamp(v: number, min: number | undefined, max: number | undefined): number {
  let out = v;
  if (min !== undefined) out = Math.max(min, out);
  if (max !== undefined) out = Math.min(max, out);
  return out;
}

export type LayoutContext = {
  bindings: BindingContext;
  measurer: TextMeasurer;
};

function fontFor(
  node: Extract<BadgeNode, { type: "text" }>,
  ctx: LayoutContext,
): Omit<FontRequest, "size"> {
  const family = node.font === "heading" ? ctx.bindings.fonts.heading : ctx.bindings.fonts.body;
  return {
    family,
    // Never a synthesized weight: the tables only know real ones.
    weight: ctx.measurer.resolveWeight(family, node.weight),
    tracking: node.tracking,
  };
}

/* ---------- pass 1: visibility ---------- */

function visible(node: BadgeNode, ctx: LayoutContext): boolean {
  if (!node.visibleIf) return true;
  return resolveTruthy(node.visibleIf, ctx.bindings);
}

function build(node: BadgeNode, ctx: LayoutContext): Measured | null {
  if (!visible(node, ctx)) return null;
  const m: Measured = {
    node,
    children: [],
    margin: edges(node.margin),
    pad: isContainer(node) ? edges(node.pad) : NO_BOX,
    w: 0,
    h: 0,
    x: 0,
    y: 0,
  };
  if (node.type === "text") {
    m.text = transformText(resolveString(node.text, ctx.bindings), node.transform);
  }
  if (node.type === "image") {
    const key = resolveString(node.src, ctx.bindings);
    m.asset = ctx.bindings.assets[key] ?? ctx.bindings.assets[node.src];
    if (!m.asset) return null; // nothing to draw
  }
  if (isContainer(node)) {
    m.children = node.children.map((c) => build(c, ctx)).filter((c): c is Measured => c !== null);
  }
  return m;
}

/* ---------- pass 2: widths, top-down ---------- */

function resolveSize(size: BadgeNode["width"], available: number, intrinsic: () => number): number {
  if (size === undefined || size === "auto") return intrinsic();
  if (size === "fill") return available;
  if (typeof size === "number") return size;
  return (available * size.pct) / 100;
}

function layoutWidths(m: Measured, available: number, ctx: LayoutContext): void {
  const n = m.node;
  const outer = available - m.margin.left - m.margin.right;

  const intrinsic = (): number => {
    if (n.type === "text") {
      // Text with no explicit width takes what it is given; the fit pass decides
      // how it breaks inside that.
      return outer;
    }
    if (n.type === "image" && n.aspect === undefined && m.asset) return m.asset.width;
    return outer;
  };

  m.w = clamp(resolveSize(n.width, outer, intrinsic), n.minWidth, n.maxWidth);
  layoutChildWidths(m, ctx);
}

/** Lays out a container's children inside its already-resolved width. */
function layoutChildWidths(m: Measured, ctx: LayoutContext): void {
  if (isContainer(m.node)) {
    const c = m.node as ContainerNode;
    const inner = m.w - m.pad.left - m.pad.right;
    if (c.type === "stack") {
      for (const child of m.children) layoutWidths(child, inner, ctx);
    } else {
      // row: fixed children first, then grow shares the remainder
      const flowChildren = m.children.filter((ch) => (ch.node.position?.mode ?? "flow") === "flow");
      const gaps = Math.max(0, flowChildren.length - 1) * c.gap;
      let remaining = inner - gaps;
      const growers: Measured[] = [];
      for (const child of m.children) {
        if (child.node.grow > 0 && (child.node.position?.mode ?? "flow") === "flow") {
          growers.push(child);
          continue;
        }
        layoutWidths(child, remaining, ctx);
        if ((child.node.position?.mode ?? "flow") === "flow") {
          remaining -= child.w + child.margin.left + child.margin.right;
        }
      }
      const totalGrow = growers.reduce((a, g) => a + g.node.grow, 0) || 1;
      for (const g of growers) {
        const share = (remaining * g.node.grow) / totalGrow;
        layoutWidths(g, share, ctx);
      }
    }
  }
}

/* ---------- pass 3: heights, bottom-up ---------- */

function layoutHeights(m: Measured, ctx: LayoutContext): void {
  const n = m.node;

  if (isContainer(m.node)) {
    for (const child of m.children) layoutHeights(child, ctx);
  }

  // Text always fits, even when the node declares a fixed height — the fit
  // decides the drawn size and line breaks, not just how tall the box is.
  if (n.type === "text") {
    const font = fontFor(n, ctx);
    const text = m.text ?? "";
    const params = {
      from: n.fit?.from ?? n.size,
      to: n.fit?.to ?? n.size,
      step: n.fit?.step ?? 2,
      maxLines: n.fit?.maxLines ?? 1,
      lineHeight: n.lineHeight,
    };
    m.fitted =
      n.fit?.mode === "shrinkWrap"
        ? fitWrapped(ctx.measurer, text, font, m.w, params)
        : n.fit?.mode === "shrink"
          ? fitSingleLine(ctx.measurer, text, font, m.w, params)
          : { lines: [text], size: n.size, lineHeight: Math.round(n.size * n.lineHeight) };
  }

  const intrinsic = (): number => {
    switch (n.type) {
      case "text":
        return m.fitted!.lines.length * m.fitted!.lineHeight;
      case "image":
        if (n.aspect) return m.w / n.aspect;
        return m.asset ? (m.w * m.asset.height) / m.asset.width : 0;
      case "qr":
        return m.w;
      case "spacer":
      case "rect":
      case "ellipse":
        return 0;
      default: {
        const c = m.node as ContainerNode;
        const flow = m.children.filter((ch) => (ch.node.position?.mode ?? "flow") === "flow");
        const gaps = Math.max(0, flow.length - 1) * c.gap;
        const sizes = flow.map((ch) => ch.h + ch.margin.top + ch.margin.bottom);
        const content =
          c.type === "stack" ? sizes.reduce((a, b) => a + b, 0) + gaps : Math.max(0, ...sizes);
        return content + m.pad.top + m.pad.bottom;
      }
    }
  };

  if (n.aspect && n.height === undefined) {
    m.h = clamp(m.w / n.aspect, n.minHeight, n.maxHeight);
  } else {
    m.h = clamp(resolveSize(n.height, 0, intrinsic), n.minHeight, n.maxHeight);
  }
}

/* ---------- pass 4: shrink to fit the parent ---------- */

/**
 * Generalises the photo fit the renderer does by hand: when a stack's flow
 * children overflow, take the deficit out of whatever declared `shrink`,
 * proportionally, down to each node's minimum.
 */
function applyShrink(m: Measured, ctx: LayoutContext): void {
  if (!isContainer(m.node)) return;
  const c = m.node as ContainerNode;

  if (c.type === "stack" && m.node.height !== undefined) {
    const flow = m.children.filter((ch) => (ch.node.position?.mode ?? "flow") === "flow");
    const gaps = Math.max(0, flow.length - 1) * c.gap;
    const used = flow.reduce((a, ch) => a + ch.h + ch.margin.top + ch.margin.bottom, 0) + gaps;
    const avail = m.h - m.pad.top - m.pad.bottom;
    const deficit = used - avail;
    if (deficit > 0) {
      const shrinkers = flow.filter((ch) => ch.node.shrink > 0);
      const total = shrinkers.reduce((a, s) => a + s.node.shrink, 0);
      if (total > 0) {
        for (const s of shrinkers) {
          const take = (deficit * s.node.shrink) / total;
          const next = clamp(s.h - take, s.node.minHeight, s.node.maxHeight);
          const scale = s.h > 0 ? next / s.h : 1;
          s.h = s.node.snap ? Math.floor(next) : next;
          // aspect-locked nodes shrink in both directions
          if (s.node.aspect || s.node.type === "qr") {
            const w = s.w * scale;
            s.w = s.node.snap ? Math.floor(w) : w;
          }
          // The node's contents were measured against its old size, so they
          // have to be measured again inside the new one.
          layoutChildWidths(s, ctx);
          for (const child of s.children) layoutHeights(child, ctx);
        }
      }
    }
  }

  for (const child of m.children) applyShrink(child, ctx);
}

/* ---------- pass 5: position ---------- */

function anchorOffset(
  anchor: string,
  parent: Rect,
  pad: Box,
  w: number,
  h: number,
): { x: number; y: number } {
  const left = parent.x + pad.left;
  const right = parent.x + parent.w - pad.right;
  const top = parent.y + pad.top;
  const bottom = parent.y + parent.h - pad.bottom;
  const cx = (left + right) / 2 - w / 2;
  const cy = (top + bottom) / 2 - h / 2;
  const xs: Record<string, number> = { l: left, c: cx, r: right - w };
  const ys: Record<string, number> = { t: top, c: cy, b: bottom - h };
  return { x: xs[anchor[1]] ?? left, y: ys[anchor[0]] ?? top };
}

function crossOffset(align: string, available: number, size: number): number {
  if (align === "center") return (available - size) / 2;
  if (align === "end") return available - size;
  return 0;
}

function position(m: Measured, ctx: LayoutContext): void {
  if (!isContainer(m.node)) return;
  const c = m.node as ContainerNode;
  const box: Rect = { x: m.x, y: m.y, w: m.w, h: m.h };
  const innerX = m.x + m.pad.left;
  const innerY = m.y + m.pad.top;
  const innerW = m.w - m.pad.left - m.pad.right;
  const innerH = m.h - m.pad.top - m.pad.bottom;

  const flow = m.children.filter((ch) => (ch.node.position?.mode ?? "flow") === "flow");
  const used =
    c.type === "stack"
      ? flow.reduce((a, ch) => a + ch.h + ch.margin.top + ch.margin.bottom, 0)
      : flow.reduce((a, ch) => a + ch.w + ch.margin.left + ch.margin.right, 0);
  const gaps = Math.max(0, flow.length - 1) * c.gap;
  const free = (c.type === "stack" ? innerH : innerW) - used - gaps;

  let cursor = 0;
  let between = c.gap;
  if (c.justify === "center") cursor = free / 2;
  else if (c.justify === "end") cursor = free;
  else if (c.justify === "between" && flow.length > 1) between = c.gap + free / (flow.length - 1);

  for (const child of m.children) {
    const p = child.node.position;
    if (p?.mode === "absolute") {
      const o = anchorOffset(p.anchor, box, m.pad, child.w, child.h);
      child.x = o.x + p.dx;
      child.y = o.y + p.dy;
    } else if (c.type === "stack") {
      const cross = child.node.alignSelf === "auto" ? c.align : child.node.alignSelf;
      child.y = innerY + cursor + child.margin.top;
      child.x =
        innerX +
        child.margin.left +
        crossOffset(cross, innerW - child.margin.left - child.margin.right, child.w);
      cursor += child.h + child.margin.top + child.margin.bottom + between;
    } else {
      child.x = innerX + cursor + child.margin.left;
      child.y =
        innerY +
        child.margin.top +
        crossOffset(
          child.node.alignSelf === "auto" ? c.align : child.node.alignSelf,
          innerH - child.margin.top - child.margin.bottom,
          child.h,
        );
      cursor += child.w + child.margin.left + child.margin.right + between;
    }
    position(child, ctx);
  }
}

/* ---------- pass 6: emit ---------- */

function strokeOp(
  s: { color: string; width: number; inset: number } | undefined,
  ctx: LayoutContext,
): StrokeOp | undefined {
  return s
    ? { color: resolveColor(s.color, ctx.bindings), width: s.width, inset: s.inset }
    : undefined;
}

function titleCase(id: string): string {
  return id
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function emit(m: Measured, ctx: LayoutContext, out: RenderOp[]): void {
  const n = m.node;
  const rect: Rect = { x: m.x, y: m.y, w: m.w, h: m.h };
  const name = n.name ?? titleCase(n.id);

  switch (n.type) {
    case "rect":
      out.push({
        k: "rect",
        id: n.id,
        rect,
        fill: n.fill ? resolveColor(n.fill, ctx.bindings) : undefined,
        stroke: strokeOp(n.stroke, ctx),
        radius: n.radius,
      });
      break;

    case "ellipse":
      out.push({
        k: "ellipse",
        id: n.id,
        rect,
        fill: n.fill ? resolveColor(n.fill, ctx.bindings) : undefined,
        stroke: strokeOp(n.stroke, ctx),
      });
      break;

    case "text": {
      const font = fontFor(n, ctx);
      const fitted = m.fitted!;
      const { ascent } = ctx.measurer.vmetrics({ ...font, size: fitted.size });
      const lines = fitted.lines.map((text, i) => {
        const w = ctx.measurer.width(text, { ...font, size: fitted.size });
        const x =
          n.align === "center" ? m.x + (m.w - w) / 2 : n.align === "right" ? m.x + m.w - w : m.x;
        return { text, x, width: w, baselineY: m.y + i * fitted.lineHeight + ascent };
      });
      out.push({
        k: "text",
        id: n.id,
        name,
        lines,
        family: font.family,
        weight: font.weight,
        size: fitted.size,
        tracking: n.tracking,
        color: resolveColor(n.color, ctx.bindings),
      });
      break;
    }

    case "image": {
      const asset = m.asset!;
      // Both fits resolve to a destination rect over the full source: `cover`
      // overflows the box and is cut by the clip, `contain` letterboxes inside
      // it. Keeping the whole source means the SVG can emit one <image> with
      // preserveAspectRatio="none" and land on the same pixels as the canvas.
      const src: Rect = { x: 0, y: 0, w: asset.width, h: asset.height };
      const ratio =
        n.fit === "cover"
          ? Math.max(m.w / asset.width, m.h / asset.height)
          : Math.min(m.w / asset.width, m.h / asset.height);
      const iw = asset.width * ratio;
      const ih = asset.height * ratio;
      const dst: Rect = { x: m.x + (m.w - iw) / 2, y: m.y + (m.h - ih) / 2, w: iw, h: ih };
      out.push({
        k: "image",
        id: n.id,
        asset,
        dstRect: dst,
        srcRect: src,
        shape: n.shape,
        backdrop: n.backdrop ? resolveColor(n.backdrop, ctx.bindings) : undefined,
        box: rect,
        stroke: strokeOp(n.stroke, ctx),
      });
      break;
    }

    case "qr":
      out.push({
        k: "qr",
        id: n.id,
        rect,
        value: resolveString(n.value, ctx.bindings),
        ecc: n.ecc,
        quietZone: n.quietZone,
        dark: resolveColor(n.dark, ctx.bindings),
        light: resolveColor(n.light, ctx.bindings),
      });
      break;

    case "spacer":
      break;

    default: {
      const c = m.node as ContainerNode;
      const needsGroup = c.clip !== "none" || n.opacity < 1;
      if (needsGroup) {
        out.push({
          k: "group-in",
          id: n.id,
          name,
          opacity: n.opacity,
          clip: c.clip === "none" ? undefined : { shape: c.clip, rect },
        });
      }
      if (c.fill || c.stroke) {
        out.push({
          k: "rect",
          id: `${n.id}-bg`,
          rect,
          fill: c.fill ? resolveColor(c.fill, ctx.bindings) : undefined,
          stroke: strokeOp(c.stroke, ctx),
          radius: c.radius,
        });
      }
      for (const child of m.children) emit(child, ctx, out);
      if (needsGroup) out.push({ k: "group-out" });
    }
  }
}

/* ---------- entry point ---------- */

export type LayoutResult = { ops: RenderOp[]; width: number; height: number };

export function layout(doc: BadgeDoc, ctx: LayoutContext): LayoutResult {
  const root = build(doc.root, ctx);
  if (!root) return { ops: [], width: doc.canvas.width, height: doc.canvas.height };

  layoutWidths(root, doc.canvas.width, ctx);
  layoutHeights(root, ctx);
  applyShrink(root, ctx);
  root.x = 0;
  root.y = 0;
  position(root, ctx);

  const ops: RenderOp[] = [
    {
      k: "rect",
      id: "canvas",
      rect: { x: 0, y: 0, w: doc.canvas.width, h: doc.canvas.height },
      fill: resolveColor(doc.canvas.background, ctx.bindings),
      radius: 0,
    },
  ];
  emit(root, ctx, ops);
  return { ops, width: doc.canvas.width, height: doc.canvas.height };
}

/** Dev guard: flow siblings must not overlap. Returns offending pairs. */
export function findOverlaps(ops: RenderOp[]): [string, string][] {
  const boxes = ops
    .filter((o): o is Extract<RenderOp, { k: "rect" }> => o.k === "rect" && o.id !== "canvas")
    .map((o) => ({ id: o.id, r: o.rect }));
  const hits: [string, string][] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r;
      const b = boxes[j].r;
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) {
        hits.push([boxes[i].id, boxes[j].id]);
      }
    }
  }
  return hits;
}
