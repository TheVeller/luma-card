// A recording 2D context, so both renderers can run headless under bun and be
// compared by what they would have drawn.
//
// It records the drawing calls together with the state that affects them
// (fill, stroke, font…), not the property assignments themselves — assignment
// order is irrelevant to the resulting image, so comparing it would produce
// false failures.

export type TraceEntry = {
  op: string;
  args: number[];
  text?: string;
  fill?: string;
  stroke?: string;
  lineWidth?: number;
  font?: string;
  image?: string;
};

const round = (n: number) => Math.round(n * 100) / 100;

export class FakeCtx {
  trace: TraceEntry[] = [];

  fillStyle = "#000000";
  strokeStyle = "#000000";
  lineWidth = 1;
  font = "10px sans-serif";
  textAlign = "left";
  textBaseline = "alphabetic";
  fontKerning = "auto";
  letterSpacing = "0px";
  globalAlpha = 1;

  /** measureText is only reachable through the font-loading guard; layout never uses it. */
  measureText(text: string) {
    const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? "10");
    const generic = /(sans-serif|serif|monospace)"?$/.test(this.font);
    // Distinct enough that isFamilyPainting() sees a real family, not a fallback.
    return { width: text.length * size * (generic ? 0.5 : 0.61) };
  }

  private push(op: string, args: number[], extra: Partial<TraceEntry> = {}) {
    this.trace.push({ op, args: args.map(round), ...extra });
  }

  fillRect(x: number, y: number, w: number, h: number) {
    this.push("fillRect", [x, y, w, h], { fill: this.fillStyle });
  }

  strokeRect(x: number, y: number, w: number, h: number) {
    this.push("strokeRect", [x, y, w, h], {
      stroke: this.strokeStyle,
      lineWidth: round(this.lineWidth),
    });
  }

  fillText(text: string, x: number, y: number) {
    this.push("fillText", [x, y], { text, fill: this.fillStyle, font: this.font });
  }

  drawImage(img: { __id?: string }, ...rest: number[]) {
    this.push("drawImage", rest, { image: img?.__id ?? "?" });
  }

  arc(x: number, y: number, r: number, a0: number, a1: number) {
    this.push("arc", [x, y, r, a0, a1]);
  }

  ellipse(x: number, y: number, rx: number, ry: number) {
    this.push("ellipse", [x, y, rx, ry]);
  }

  rect(x: number, y: number, w: number, h: number) {
    this.push("rect", [x, y, w, h]);
  }

  stroke() {
    this.push("stroke", [], { stroke: this.strokeStyle, lineWidth: round(this.lineWidth) });
  }

  fill() {
    this.push("fill", [], { fill: this.fillStyle });
  }

  // State-only calls: they change nothing about the pixels on their own.
  save() {}
  restore() {}
  beginPath() {}
  closePath() {}
  clip() {}
}

type FakeImage = {
  __id: string;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
};

export function fakeImage(id: string, width = 512, height = 512): FakeImage {
  return { __id: id, width, height, naturalWidth: width, naturalHeight: height };
}

/**
 * Minimal browser globals so the legacy renderer runs under bun: a canvas whose
 * context records, an Image that resolves immediately, and a document.fonts
 * that reports ready.
 */
export function installBrowserStubs(images: Record<string, FakeImage>) {
  const contexts: FakeCtx[] = [];

  const doc = {
    createElement(tag: string) {
      if (tag === "canvas") {
        const ctx = new FakeCtx();
        contexts.push(ctx);
        return { width: 0, height: 0, getContext: () => ctx };
      }
      return { rel: "", href: "", set onload(_v: unknown) {} };
    },
    head: { appendChild() {} },
    fonts: {
      size: 1,
      ready: Promise.resolve(),
      load: async () => [],
      check: () => true,
      clear() {},
      [Symbol.iterator]: function* () {},
    },
  };

  class StubImage {
    __id = "";
    width = 512;
    height = 512;
    naturalWidth = 512;
    naturalHeight = 512;
    crossOrigin = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) {
      const found = images[value];
      if (found) {
        this.__id = found.__id;
        this.width = found.width;
        this.height = found.height;
        this.naturalWidth = found.width;
        this.naturalHeight = found.height;
      } else {
        // QR data urls and anything else: a stable id keyed by content length.
        this.__id = `img:${value.slice(0, 24)}…${value.length}`;
      }
      queueMicrotask(() => this.onload?.());
    }
  }

  const g = globalThis as unknown as Record<string, unknown>;
  g.document = doc;
  g.Image = StubImage;
  return { contexts, lastContext: () => contexts[contexts.length - 1] };
}
