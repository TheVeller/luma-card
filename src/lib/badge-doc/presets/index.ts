// The compositions a badge can use.
//
// Palette and fonts alone never changed how a badge is composed, so every badge
// looked the same however it was coloured. These are genuinely different
// layouts sharing one schema, one set of tokens and one engine — so the
// controls, the highlight and the AI work identically in all of them.

import { CURRENT_DOC_VERSION, type BadgeDoc } from "../schema";
import { CLASSIC_BADGE_DOC } from "./classic";
import { image, qr, rect, row, sponsorRow, stack, text } from "./build";

export const LAYOUT_PRESET_IDS = ["classic", "poster", "spotlight", "minimal"] as const;
export type LayoutPresetId = (typeof LAYOUT_PRESET_IDS)[number];

const W = 1080;
const H = 1600;

function doc(name: string, root: BadgeDoc["root"]): BadgeDoc {
  return {
    version: CURRENT_DOC_VERSION,
    meta: { name, origin: "system" },
    canvas: { width: W, height: H, background: "$palette.bg" },
    vars: {},
    root,
  };
}

/** Headline dominates the top third; the photo is a wide cropped band. */
const POSTER: BadgeDoc = doc(
  "Poster",
  stack("badge", { width: W, height: H, pad: 64, gap: 28 }, [
    text("headline", "$event.name", {
      font: "heading",
      weight: 900,
      size: 128,
      transform: "upper",
      width: "fill",
      fit: { mode: "shrinkWrap", from: 128, to: 52, step: 4, maxLines: 3 },
      lineHeight: 0.98,
    }),
    row("meta", { width: "fill", height: 24, justify: "between" }, [
      text("city", "$event.subtitle", {
        weight: 700,
        size: 22,
        color: "$accent",
        transform: "upper",
        width: "auto",
      }),
      text("date", "$event.dateLine", {
        size: 22,
        color: "$palette.text|alpha(0.7)",
        width: "auto",
        align: "right",
      }),
    ]),
    image("photo-image", "$photo", {
      width: "fill",
      height: 520,
      minHeight: 300,
      shrink: 1,
      fit: "cover",
      backdrop: "$palette.surface",
    }),
    stack("identity", { width: "fill", gap: 8 }, [
      text("name", "$user.firstName", {
        font: "heading",
        weight: 900,
        size: 96,
        transform: "upper",
        fit: { mode: "shrinkWrap", from: 96, to: 40, step: 4, maxLines: 2 },
      }),
      text("role", "$user.role|upper", {
        weight: 700,
        size: 26,
        color: "$accent",
        fit: { mode: "shrink", from: 26, to: 16, step: 2, maxLines: 1 },
        lineHeight: 1,
      }),
    ]),
    sponsorRow("sponsors", { margin: [8, 0, 0, 0] }),
    row("scan", { width: "fill", height: 120, justify: "between", align: "end" }, [
      text("scan-url", "$event.url|displayUrl", {
        weight: 700,
        size: 20,
        grow: 1,
        fit: { mode: "shrinkWrap", from: 20, to: 12, step: 2, maxLines: 2 },
      }),
      qr("qr", { width: 120, height: 120 }),
    ]),
  ]),
);

/** The person is the subject: a big circular portrait, everything orbits it. */
const SPOTLIGHT: BadgeDoc = doc(
  "Spotlight",
  stack("badge", { width: W, height: H, pad: 72, gap: 22, align: "center", justify: "between" }, [
    text("kicker", "$event.subtitle", {
      weight: 700,
      size: 22,
      color: "$accent",
      transform: "upper",
      align: "center",
      width: "fill",
      tracking: 0.24,
    }),
    text("headline", "$event.name", {
      font: "heading",
      weight: 700,
      size: 54,
      transform: "upper",
      align: "center",
      width: "fill",
      fit: { mode: "shrinkWrap", from: 54, to: 28, step: 2, maxLines: 2 },
    }),
    image("photo-image", "$photo", {
      width: 620,
      aspect: 1,
      minHeight: 340,
      shrink: 1,
      fit: "cover",
      shape: "circle",
      alignSelf: "center",
      stroke: { color: "$accent", width: 6, inset: 0 },
      margin: [18, 0, 18, 0],
    }),
    text("name", "$user.firstName", {
      font: "heading",
      weight: 900,
      size: 112,
      transform: "upper",
      align: "center",
      width: "fill",
      fit: { mode: "shrinkWrap", from: 112, to: 44, step: 4, maxLines: 2 },
    }),
    text("role", "$user.role|upper", {
      weight: 700,
      size: 24,
      color: "$accent",
      align: "center",
      width: "fill",
      fit: { mode: "shrink", from: 24, to: 14, step: 2, maxLines: 1 },
      lineHeight: 1,
    }),
    text("date", "$event.dateLine", {
      size: 20,
      color: "$palette.text|alpha(0.6)",
      align: "center",
      width: "fill",
    }),
    sponsorRow("sponsors"),
    qr("qr", { width: 108, height: 108, alignSelf: "center" }),
    text("scan-url", "$event.url|displayUrl", {
      size: 14,
      color: "$palette.text|alpha(0.5)",
      align: "center",
      width: "fill",
      fit: { mode: "shrink", from: 14, to: 10, step: 1, maxLines: 1 },
    }),
  ]),
);

/** No frame, no kicker: air, a typographic grid, and a discreet QR. */
const MINIMAL: BadgeDoc = doc(
  "Minimal",
  stack("badge", { width: W, height: H, pad: [96, 84, 84, 84], gap: 0, justify: "between" }, [
    text("headline", "$event.name", {
      font: "heading",
      weight: 500,
      size: 44,
      width: "fill",
      fit: { mode: "shrinkWrap", from: 44, to: 24, step: 2, maxLines: 2 },
      color: "$palette.text|alpha(0.75)",
      margin: [0, 0, 12, 0],
    }),
    row("meta", { width: "fill", height: 22, justify: "between", margin: [0, 0, 56, 0] }, [
      text("city", "$event.subtitle", {
        size: 18,
        color: "$accent",
        transform: "upper",
        width: "auto",
        tracking: 0.18,
      }),
      text("date", "$event.dateLine", {
        size: 18,
        color: "$palette.text|alpha(0.5)",
        width: "auto",
        align: "right",
      }),
    ]),
    image("photo-image", "$photo", {
      width: "fill",
      aspect: 1.35,
      minHeight: 280,
      shrink: 1,
      fit: "cover",
      backdrop: "$palette.surface",
    }),
    stack("identity", { width: "fill", gap: 10, margin: [56, 0, 0, 0] }, [
      text("name", "$user.firstName", {
        font: "heading",
        weight: 400,
        size: 92,
        fit: { mode: "shrinkWrap", from: 92, to: 40, step: 4, maxLines: 2 },
        lineHeight: 1,
      }),
      text("role", "$user.role", {
        size: 22,
        color: "$palette.text|alpha(0.6)",
        fit: { mode: "shrink", from: 22, to: 14, step: 2, maxLines: 1 },
        lineHeight: 1,
      }),
    ]),
    rect("rule", {
      width: "fill",
      height: 1,
      fill: "$palette.text|alpha(0.18)",
      margin: [40, 0, 24, 0],
    }),
    sponsorRow("sponsors", { justify: "start", height: 36 }),
    row(
      "scan",
      { width: "fill", height: 96, justify: "between", align: "center", margin: [24, 0, 0, 0] },
      [
        text("scan-url", "$event.url|displayUrl", {
          size: 14,
          color: "$palette.text|alpha(0.5)",
          grow: 1,
          fit: { mode: "shrink", from: 14, to: 10, step: 1, maxLines: 1 },
        }),
        qr("qr", { width: 88, height: 88 }),
      ],
    ),
  ]),
);

const REGISTRY: Record<LayoutPresetId, BadgeDoc> = {
  classic: CLASSIC_BADGE_DOC,
  poster: POSTER,
  spotlight: SPOTLIGHT,
  minimal: MINIMAL,
};

export function layoutPreset(id: string): BadgeDoc | null {
  return REGISTRY[id as LayoutPresetId] ?? null;
}

export const LAYOUT_PRESETS: { id: LayoutPresetId; name: string; doc: BadgeDoc }[] =
  LAYOUT_PRESET_IDS.map((id) => ({ id, name: REGISTRY[id].meta.name, doc: REGISTRY[id] }));

export { CLASSIC_BADGE_DOC };
