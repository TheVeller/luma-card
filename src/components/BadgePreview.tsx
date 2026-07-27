// The badge itself, plus the one thing that makes the controls legible: a
// highlight that lands on the piece you are pointing at.
//
// The layout pass already computes every node's absolute rectangle, so this is
// just those numbers as percentages over the image — which means it scales with
// the container and needs no measuring of its own.

import type { RenderOp } from "@/lib/badge-doc/layout/engine";

type Props = {
  src: string | null;
  ops: RenderOp[];
  canvasWidth: number;
  canvasHeight: number;
  /** node being pointed at in the controls */
  highlightId: string | null;
  saved: boolean;
  busy: boolean;
  /** why the badge cannot be drawn yet, if it cannot */
  missing: string | null;
  onUndo?: () => void;
  undoLabel?: string | null;
};

type Rect = { x: number; y: number; w: number; h: number };

function rectFor(ops: RenderOp[], id: string | null): Rect | null {
  if (!id) return null;
  for (const op of ops) {
    if (!("id" in op) || op.id !== id) continue;
    if (op.k === "rect" || op.k === "ellipse" || op.k === "qr") return op.rect;
    if (op.k === "image") return op.box;
    if (op.k === "text") {
      // Text has no box of its own, so bound the lines it actually drew — the
      // layout measured their widths, no guessing needed here.
      const lines = op.lines;
      if (lines.length === 0) return null;
      const x = Math.min(...lines.map((l) => l.x));
      const right = Math.max(...lines.map((l) => l.x + l.width));
      const top = lines[0].baselineY - op.size;
      const bottom = lines[lines.length - 1].baselineY + op.size * 0.25;
      return { x, y: top, w: right - x, h: bottom - top };
    }
  }
  return null;
}

export function BadgePreview({
  src,
  ops,
  canvasWidth,
  canvasHeight,
  highlightId,
  saved,
  busy,
  missing,
  onUndo,
  undoLabel,
}: Props) {
  const rect = rectFor(ops, highlightId);
  const pct = (value: number, total: number) => `${(value / total) * 100}%`;

  const status = busy ? "saving…" : saved ? "saved" : src ? "live" : null;

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
          <span>· Preview</span>
          {status && (
            <span
              className={
                saved
                  ? "rounded-full bg-accent/15 px-2 py-0.5 text-accent"
                  : "rounded-full bg-surface-2 px-2 py-0.5"
              }
            >
              {status}
            </span>
          )}
        </div>
        {onUndo && (
          <button
            type="button"
            onClick={onUndo}
            className="rounded-full border border-hairline px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            title={undoLabel ? `Undo: ${undoLabel}` : "Undo"}
          >
            ↶ undo
          </button>
        )}
      </div>

      <div className="mt-3 flex justify-center rounded-2xl border border-hairline bg-surface/50 p-6">
        {src ? (
          <div className="relative w-full max-w-md">
            <img src={src} alt="Your badge" className="w-full rounded-xl shadow-2xl" />

            {rect && (
              <>
                {/* Dim everything except the piece being pointed at. */}
                <div
                  className="pointer-events-none absolute inset-0 rounded-xl bg-background/45 transition-opacity duration-150"
                  style={{
                    // A hole cut with two gradients would blur; a clip-path keeps the edges crisp.
                    clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0,
                      ${pct(rect.x, canvasWidth)} ${pct(rect.y, canvasHeight)},
                      ${pct(rect.x, canvasWidth)} ${pct(rect.y + rect.h, canvasHeight)},
                      ${pct(rect.x + rect.w, canvasWidth)} ${pct(rect.y + rect.h, canvasHeight)},
                      ${pct(rect.x + rect.w, canvasWidth)} ${pct(rect.y, canvasHeight)},
                      ${pct(rect.x, canvasWidth)} ${pct(rect.y, canvasHeight)})`,
                  }}
                />
                <div
                  className="pointer-events-none absolute rounded-[3px] border-2 border-accent transition-all duration-150"
                  style={{
                    left: pct(rect.x, canvasWidth),
                    top: pct(rect.y, canvasHeight),
                    width: pct(rect.w, canvasWidth),
                    height: pct(rect.h, canvasHeight),
                    boxShadow: "0 0 0 1px rgba(0,0,0,0.35), 0 0 18px -4px var(--accent)",
                  }}
                />
              </>
            )}
          </div>
        ) : (
          <div className="flex aspect-[27/40] w-full max-w-md items-center justify-center rounded-xl border border-dashed border-hairline text-center">
            <div className="px-6">
              <div className="text-2xl text-muted-foreground">↴</div>
              <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                {missing ?? "Fill in the details"}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
