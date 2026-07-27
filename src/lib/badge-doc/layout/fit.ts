// Text autofit — the word-wrap-and-shrink the badge has always used, lifted out
// of the renderer so both painters share one implementation and the server can
// run it too. Measured off the metric tables, never ctx.measureText.

import type { FontRequest, TextMeasurer } from "./measure";

export type FittedText = { lines: string[]; size: number; lineHeight: number };

export type FitParams = {
  from: number;
  to: number;
  step: number;
  maxLines: number;
  /** multiplier applied to the chosen size, then rounded (classic: 1.08) */
  lineHeight: number;
};

function wrap(
  text: string,
  size: number,
  maxWidth: number,
  measure: (t: string, size: number) => number,
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const test = current ? current + " " + w : w;
    if (measure(test, size) > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Shrink until the text wraps into at most maxLines, then ellipsize. */
export function fitWrapped(
  m: TextMeasurer,
  text: string,
  font: Omit<FontRequest, "size">,
  maxWidth: number,
  p: FitParams,
): FittedText {
  const measure = (t: string, size: number) => m.width(t, { ...font, size });
  const lh = (size: number) => Math.round(size * p.lineHeight);

  for (let size = p.from; size >= p.to; size -= p.step) {
    const lines = wrap(text, size, maxWidth, measure);
    if (lines.length <= p.maxLines && lines.every((l) => measure(l, size) <= maxWidth)) {
      return { lines, size, lineHeight: lh(size) };
    }
  }

  // Nothing fit: wrap at the smallest size and ellipsize the last allowed line.
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const test = current ? current + " " + w : w;
    if (measure(test, p.to) > maxWidth && current) {
      if (lines.length + 1 >= p.maxLines) {
        let last = test;
        while (measure(last + "…", p.to) > maxWidth && last.length > 1) last = last.slice(0, -1);
        lines.push(last + "…");
        break;
      }
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current && lines.length < p.maxLines) lines.push(current);

  // A word with no spaces can still be wider than the box at the smallest size
  // — wrapping cannot help it. Without this it simply ran off the badge.
  const clipped = lines.slice(0, p.maxLines).map((line) => {
    if (measure(line, p.to) <= maxWidth) return line;
    let t = line;
    while (t.length > 1 && measure(t + "…", p.to) > maxWidth) t = t.slice(0, -1);
    return t + "…";
  });
  return { lines: clipped, size: p.to, lineHeight: lh(p.to) };
}

/** Single line: shrink to fit, then ellipsize at the smallest size. */
export function fitSingleLine(
  m: TextMeasurer,
  text: string,
  font: Omit<FontRequest, "size">,
  maxWidth: number,
  p: Pick<FitParams, "from" | "to" | "step" | "lineHeight">,
): FittedText {
  const lh = (size: number) => Math.round(size * p.lineHeight);
  for (let size = p.from; size >= p.to; size -= p.step) {
    if (m.width(text, { ...font, size }) <= maxWidth) {
      return { lines: [text], size, lineHeight: lh(size) };
    }
  }
  let t = text;
  while (m.width(t + "…", { ...font, size: p.to }) > maxWidth && t.length > 1) t = t.slice(0, -1);
  return { lines: [t + "…"], size: p.to, lineHeight: lh(p.to) };
}
