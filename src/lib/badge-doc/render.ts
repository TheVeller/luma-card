// Browser entry point: BadgeDoc -> canvas.
//
// Everything asynchronous (fonts, images, QR) is resolved here so the layout
// pass itself stays pure and synchronous, which is what lets the same pass run
// on the server for the SVG export.

import QRCode from "qrcode";
import { loadGoogleFontPair, validateFontPair } from "@/lib/google-fonts";
import type { StyleSpec } from "@/lib/style-spec";
import { layout, type RenderOp } from "./layout/engine";
import { TableMeasurer } from "./layout/measure";
import { CanvasPainter, type DrawableImage } from "./paint/canvas";
import { paintOps } from "./paint/painter";
import type { BadgeDoc } from "./schema";
import { bindingsFrom, type ImageAsset } from "./tokens";

export type RenderInputs = {
  doc: BadgeDoc;
  spec: StyleSpec;
  event: { name: string; subtitle: string; dateLine: string; url: string; coverUrl: string | null };
  user: { firstName: string; role: string; photo: string | null };
  /** 1 for export, 0.5 for a live preview */
  scale?: number;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function loadAsset(src: string): Promise<ImageAsset | null> {
  try {
    const img = await loadImage(src);
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
    };
  } catch {
    return null;
  }
}

export async function renderToCanvas(inputs: RenderInputs): Promise<HTMLCanvasElement> {
  const { doc, spec, event, user } = inputs;

  const { heading, body } = validateFontPair(spec.fonts.heading, spec.fonts.body);
  await loadGoogleFontPair(heading, body);
  const measurer = await TableMeasurer.forFamilies([heading, body]);

  // Only the images the doc can actually reference.
  const assets: Record<string, ImageAsset> = {};
  const sources = [user.photo, event.coverUrl].filter((s): s is string => Boolean(s));
  await Promise.all(
    sources.map(async (src) => {
      const asset = await loadAsset(src);
      if (asset) assets[src] = asset;
    }),
  );

  const bindings = bindingsFrom(
    { ...spec, fonts: { ...spec.fonts, heading, body } },
    event,
    user,
    assets,
    doc.vars,
  );
  const { ops, width, height } = layout(doc, { bindings, measurer });

  // QR codes need the resolved value, which only exists after layout.
  const qrImages: Record<string, DrawableImage> = {};
  await Promise.all(
    ops
      .filter((o): o is Extract<RenderOp, { k: "qr" }> => o.k === "qr")
      .map(async (op) => {
        const dataUrl = await QRCode.toDataURL(op.value, {
          errorCorrectionLevel: op.ecc as "L" | "M" | "Q" | "H",
          width: op.rect.w * 2,
          margin: op.quietZone,
          color: { dark: op.dark.hex, light: op.light.hex },
        });
        const img = await loadImage(dataUrl);
        qrImages[op.id] = img as unknown as DrawableImage;
      }),
  );

  const scale = inputs.scale ?? 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d")!;
  paintOps(ops, new CanvasPainter({ ctx, scale, qrImages }), { width, height });
  return canvas;
}
