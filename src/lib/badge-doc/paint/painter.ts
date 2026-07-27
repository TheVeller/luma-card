// Painter interface. Painters are deliberately dumb: they receive absolute
// geometry and already-resolved colours and just draw. All measuring and
// positioning happened in the layout pass, which is what keeps the canvas
// preview and the SVG export on the same numbers.

import type { RenderOp } from "../layout/engine";

export interface Painter {
  begin(size: { width: number; height: number }): void;
  groupIn(op: Extract<RenderOp, { k: "group-in" }>): void;
  groupOut(): void;
  rect(op: Extract<RenderOp, { k: "rect" }>): void;
  ellipse(op: Extract<RenderOp, { k: "ellipse" }>): void;
  text(op: Extract<RenderOp, { k: "text" }>): void;
  image(op: Extract<RenderOp, { k: "image" }>): void;
  qr(op: Extract<RenderOp, { k: "qr" }>): void;
  end(): void;
}

export function paintOps(
  ops: RenderOp[],
  painter: Painter,
  size: { width: number; height: number },
) {
  painter.begin(size);
  for (const op of ops) {
    switch (op.k) {
      case "group-in":
        painter.groupIn(op);
        break;
      case "group-out":
        painter.groupOut();
        break;
      case "rect":
        painter.rect(op);
        break;
      case "ellipse":
        painter.ellipse(op);
        break;
      case "text":
        painter.text(op);
        break;
      case "image":
        painter.image(op);
        break;
      case "qr":
        painter.qr(op);
        break;
    }
  }
  painter.end();
}
