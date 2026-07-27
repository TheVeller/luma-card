// Node builders. Every node carries the same dozen layout defaults, and writing
// them out per node (as classic.ts does, deliberately, to stay a literal
// transcription of the old renderer) makes a new composition unreadable.

import type { BadgeNode } from "../schema";

const BASE = {
  grow: 0,
  shrink: 0,
  alignSelf: "auto",
  opacity: 1,
  snap: false,
} as const;

const CONTAINER = {
  ...BASE,
  gap: 0,
  align: "start",
  justify: "start",
  radius: 0,
  clip: "none",
} as const;

type Extra = Partial<BadgeNode> & Record<string, unknown>;

export function stack(id: string, extra: Extra, children: BadgeNode[]): BadgeNode {
  return { type: "stack", id, ...CONTAINER, ...extra, children } as BadgeNode;
}

export function row(id: string, extra: Extra, children: BadgeNode[]): BadgeNode {
  return { type: "row", id, ...CONTAINER, ...extra, children } as BadgeNode;
}

export function text(id: string, value: string, extra: Extra = {}): BadgeNode {
  return {
    type: "text",
    id,
    text: value,
    font: "body",
    weight: 400,
    size: 18,
    lineHeight: 1.08,
    tracking: 0,
    color: "$palette.text",
    align: "left",
    transform: "none",
    ...BASE,
    ...extra,
  } as BadgeNode;
}

export function image(id: string, src: string, extra: Extra = {}): BadgeNode {
  return {
    type: "image",
    id,
    src,
    fit: "contain",
    shape: "rect",
    ...BASE,
    ...extra,
  } as BadgeNode;
}

export function qr(id: string, extra: Extra = {}): BadgeNode {
  return {
    type: "qr",
    id,
    value: "$event.url",
    ecc: "M",
    quietZone: 2,
    dark: "$palette.text",
    light: "$palette.surface",
    ...BASE,
    ...extra,
  } as BadgeNode;
}

export function rect(id: string, extra: Extra = {}): BadgeNode {
  return { type: "rect", id, radius: 0, ...BASE, ...extra } as BadgeNode;
}

/**
 * The sponsor band: up to six logo slots, each shown only when a logo exists at
 * that index. A repeat node would be nicer but would mean a new node type in the
 * engine; six `visibleIf` slots need nothing new and the cap is explicit.
 */
export const MAX_LOGOS = 6;

export function sponsorRow(id: string, extra: Extra = {}): BadgeNode {
  return row(
    id,
    { width: "fill", height: 44, gap: 18, align: "center", justify: "center", ...extra },
    Array.from({ length: MAX_LOGOS }, (_, i) =>
      image(`logo-${i + 1}`, `$user.logos.${i}`, {
        visibleIf: `$user.logos.${i}`,
        height: 40,
        maxWidth: 130,
        fit: "contain",
      }),
    ),
  );
}
