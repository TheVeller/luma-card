// Canvas backend. Draws exactly what the layout decided — no measuring here.
//
// Two settings are not optional: kerning off and real weights (the layout
// already pinned those), because the advance tables the layout measured with
// know nothing about kerning or synthesized bolds.

import type { RenderOp } from "../layout/engine";
import { colorToCss } from "../tokens";
import type { Painter } from "./painter";

export type DrawableImage = CanvasImageSource & { width: number; height: number };

export type CanvasPainterOptions = {
  ctx: CanvasRenderingContext2D;
  /** 1 for export, 0.5 for a cheap live preview */
  scale?: number;
  /** node id -> already-decoded QR bitmap */
  qrImages?: Record<string, DrawableImage>;
};

export class CanvasPainter implements Painter {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly s: number;
  private readonly qrImages: Record<string, DrawableImage>;

  constructor(opts: CanvasPainterOptions) {
    this.ctx = opts.ctx;
    this.s = opts.scale ?? 1;
    this.qrImages = opts.qrImages ?? {};
  }

  begin(): void {
    const ctx = this.ctx;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fontKerning = "none";
    ctx.letterSpacing = "0px";
  }

  end(): void {}

  groupIn(op: Extract<RenderOp, { k: "group-in" }>): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = op.opacity;
    if (op.clip) {
      const r = this.scaleRect(op.clip.rect);
      ctx.beginPath();
      if (op.clip.shape === "circle") {
        ctx.arc(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) / 2, 0, Math.PI * 2);
      } else {
        ctx.rect(r.x, r.y, r.w, r.h);
      }
      ctx.closePath();
      ctx.clip();
    }
  }

  groupOut(): void {
    this.ctx.restore();
  }

  rect(op: Extract<RenderOp, { k: "rect" }>): void {
    const ctx = this.ctx;
    const r = this.scaleRect(op.rect);
    if (op.fill) {
      ctx.fillStyle = colorToCss(op.fill);
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    if (op.stroke) {
      const i = op.stroke.inset * this.s;
      ctx.strokeStyle = colorToCss(op.stroke.color);
      ctx.lineWidth = op.stroke.width * this.s;
      ctx.strokeRect(r.x + i, r.y + i, r.w - i * 2, r.h - i * 2);
    }
  }

  ellipse(op: Extract<RenderOp, { k: "ellipse" }>): void {
    const ctx = this.ctx;
    const r = this.scaleRect(op.rect);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    if (op.fill) {
      ctx.fillStyle = colorToCss(op.fill);
      ctx.beginPath();
      ctx.ellipse(cx, cy, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (op.stroke) {
      ctx.strokeStyle = colorToCss(op.stroke.color);
      ctx.lineWidth = op.stroke.width * this.s;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  text(op: Extract<RenderOp, { k: "text" }>): void {
    const ctx = this.ctx;
    ctx.fillStyle = colorToCss(op.color);
    ctx.font = `${op.weight} ${op.size * this.s}px "${op.family}"`;
    ctx.letterSpacing = op.tracking ? `${op.tracking * op.size * this.s}px` : "0px";
    for (const line of op.lines) {
      ctx.fillText(line.text, line.x * this.s, line.baselineY * this.s);
    }
  }

  image(op: Extract<RenderOp, { k: "image" }>): void {
    const ctx = this.ctx;
    const box = this.scaleRect(op.box);
    const dst = this.scaleRect(op.dstRect);
    const source = op.asset.source as DrawableImage;
    // `cover` overflows its box on purpose; the clip is what crops it.
    const overflows =
      dst.w > box.w + 0.01 || dst.h > box.h + 0.01 || dst.x < box.x - 0.01 || dst.y < box.y - 0.01;
    const clipped = op.shape === "circle" || overflows;

    if (clipped) {
      ctx.save();
      ctx.beginPath();
      if (op.shape === "circle") {
        ctx.arc(box.x + box.w / 2, box.y + box.h / 2, Math.min(box.w, box.h) / 2, 0, Math.PI * 2);
      } else {
        ctx.rect(box.x, box.y, box.w, box.h);
      }
      ctx.closePath();
      ctx.clip();
    }
    if (op.backdrop && op.shape !== "circle") {
      ctx.fillStyle = colorToCss(op.backdrop);
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }

    ctx.drawImage(source, dst.x, dst.y, dst.w, dst.h);

    if (clipped) ctx.restore();

    if (op.stroke) {
      ctx.strokeStyle = colorToCss(op.stroke.color);
      ctx.lineWidth = op.stroke.width * this.s;
      if (op.shape === "circle") {
        ctx.beginPath();
        ctx.arc(box.x + box.w / 2, box.y + box.h / 2, Math.min(box.w, box.h) / 2, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeRect(box.x, box.y, box.w, box.h);
      }
    }
  }

  qr(op: Extract<RenderOp, { k: "qr" }>): void {
    const img = this.qrImages[op.id];
    if (!img) return;
    const r = this.scaleRect(op.rect);
    this.ctx.drawImage(img, r.x, r.y, r.w, r.h);
  }

  private scaleRect(r: { x: number; y: number; w: number; h: number }) {
    return { x: r.x * this.s, y: r.y * this.s, w: r.w * this.s, h: r.h * this.s };
  }
}
