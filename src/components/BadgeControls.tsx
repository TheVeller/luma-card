// Direct controls for the badge: palette, typography and the pieces themselves.
//
// Everything goes through the same applyPatch the AI uses, so a manual edit can
// never produce a document the AI would have been refused, and the required
// pieces stay required whoever is doing the editing.
//
// The list shows one row per piece with its controls collapsed; only the
// selected row opens. Pointing at a row highlights that piece on the badge —
// which is the whole reason these controls are legible at all.

import { useMemo, useState } from "react";
import { GOOGLE_BODY_FONTS, GOOGLE_HEADING_FONTS } from "@/lib/google-fonts";
import { AVAILABLE_WEIGHTS } from "@/lib/badge-doc/layout/metrics/index";
import { normalizeStyleSpec, type StyleSpec } from "@/lib/style-spec";
import { applyPatch, PROTECTED_NODE_IDS, type PatchOp } from "@/lib/badge-doc/patch";
import { isContainer, walk, type BadgeDoc, type BadgeNode } from "@/lib/badge-doc/schema";

type Props = {
  spec: StyleSpec;
  doc: BadgeDoc;
  onSpecChange: (spec: StyleSpec) => void;
  onDocChange: (doc: BadgeDoc, intent: string) => void;
  onHoverNode: (id: string | null) => void;
};

const PALETTE_ROLES = [
  { key: "bg", label: "Background" },
  { key: "surface", label: "Surface" },
  { key: "accent", label: "Accent" },
  { key: "text", label: "Text" },
  { key: "textMuted", label: "Muted" },
] as const;

type Piece = { node: BadgeNode; required: boolean };
type Group = { name: string; pieces: Piece[] };

function titleCase(id: string): string {
  return id
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/**
 * Pieces worth listing, grouped by the container they sit in — containers and
 * structural filler are noise, and a flat list of every leaf is a wall. The
 * grouping is derived from the tree, so a layout the AI composed groups itself.
 */
function listGroups(doc: BadgeDoc): Group[] {
  const groups = new Map<string, Group>();
  walk(doc.root, (n, parent) => {
    if (isContainer(n) || n.type === "spacer") return;
    if (n.id.startsWith("corner-") || n.id.startsWith("frame-")) return;
    const container = parent && !["badge", "content"].includes(parent.id) ? parent : null;
    const name = container ? (container.name ?? titleCase(container.id)) : "Badge";
    const group = groups.get(name) ?? { name, pieces: [] };
    group.pieces.push({
      node: n,
      required: (PROTECTED_NODE_IDS as readonly string[]).includes(n.id),
    });
    groups.set(name, group);
  });
  return [...groups.values()];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function BadgeControls({ spec, doc, onSpecChange, onDocChange, onHoverNode }: Props) {
  const groups = useMemo(() => listGroups(doc), [doc]);
  const [openId, setOpenId] = useState<string | null>(null);

  function patch(intent: string, ...ops: PatchOp[]) {
    const result = applyPatch(doc, ops);
    // A refusal here means the control is wrong, not the user; fail closed and
    // leave the badge exactly as it was.
    if (result.ok) onDocChange(result.doc, intent);
  }

  function setColor(role: (typeof PALETTE_ROLES)[number]["key"], value: string) {
    onSpecChange(normalizeStyleSpec({ ...spec, palette: { ...spec.palette, [role]: value } }));
  }

  const headingWeights = AVAILABLE_WEIGHTS[spec.fonts.heading] ?? [];
  const bodyWeights = AVAILABLE_WEIGHTS[spec.fonts.body] ?? [];

  return (
    <div className="space-y-6">
      <Section title="Palette">
        <div className="space-y-1.5">
          {PALETTE_ROLES.map((role) => (
            <label
              key={role.key}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1 transition-colors hover:bg-surface-2/60"
            >
              <span className="relative h-6 w-6 shrink-0 overflow-hidden rounded-md border border-hairline">
                <span
                  className="absolute inset-0"
                  style={{ backgroundColor: spec.palette[role.key] }}
                />
                <input
                  type="color"
                  value={spec.palette[role.key]}
                  onChange={(e) => setColor(role.key, e.target.value)}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label={role.label}
                />
              </span>
              <span className="flex-1 text-xs">{role.label}</span>
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                {spec.palette[role.key]}
              </span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="Typography">
        <div className="space-y-2">
          {(
            [
              {
                label: "Heading",
                value: spec.fonts.heading,
                list: GOOGLE_HEADING_FONTS,
                weights: headingWeights,
                key: "heading" as const,
              },
              {
                label: "Body",
                value: spec.fonts.body,
                list: GOOGLE_BODY_FONTS,
                weights: bodyWeights,
                key: "body" as const,
              },
            ] as const
          ).map((f) => (
            <label key={f.key} className="block">
              <span className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-xs text-muted-foreground">{f.label}</span>
                {/* Which weights the family really ships — Space Grotesk stops
                    at 700, so asking for 900 silently gets you 700. */}
                <span className="font-mono text-[9px] text-muted-foreground">
                  {f.weights.length ? f.weights.join(" · ") : "—"}
                </span>
              </span>
              <select
                value={f.value}
                onChange={(e) =>
                  onSpecChange(
                    normalizeStyleSpec({
                      ...spec,
                      fonts: { ...spec.fonts, [f.key]: e.target.value },
                    }),
                  )
                }
                className="w-full rounded-lg border border-hairline bg-background px-2.5 py-2 text-xs transition-colors hover:border-accent/40 focus:border-accent focus:outline-none"
              >
                {f.list.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </Section>

      <Section title="Pieces">
        {/* Bounded so the library below stays reachable without a long scroll. */}
        <div className="max-h-[340px] space-y-3 overflow-y-auto pr-1">
          {groups.map((group) => (
            <div key={group.name}>
              <div className="mb-1 px-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/70">
                {group.name}
              </div>
              <div className="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline">
                {group.pieces.map(({ node, required }) => {
                  const hidden = node.opacity === 0;
                  const open = openId === node.id;
                  const isText = node.type === "text";
                  const currentSize = isText ? (node.fit?.from ?? node.size) : null;

                  return (
                    <div
                      key={node.id}
                      onMouseEnter={() => onHoverNode(node.id)}
                      onMouseLeave={() => onHoverNode(null)}
                      className={
                        open ? "bg-surface-2/50" : "transition-colors hover:bg-surface-2/40"
                      }
                    >
                      <div className="flex items-center gap-2 px-2.5 py-1.5">
                        <button
                          type="button"
                          onClick={() => setOpenId(open ? null : node.id)}
                          className="flex flex-1 items-center gap-2 text-left"
                          aria-expanded={open}
                        >
                          <span
                            className={`font-mono text-[9px] text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
                            aria-hidden
                          >
                            ▸
                          </span>
                          <span
                            className={`text-xs ${hidden ? "text-muted-foreground line-through" : ""}`}
                          >
                            {node.name ?? node.id}
                          </span>
                          {required && (
                            <span
                              className="text-[10px] text-muted-foreground"
                              title="Can be moved and restyled, but not removed — the badge needs it"
                            >
                              🔒
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            patch(`${hidden ? "show" : "hide"} ${node.id}`, {
                              op: "set",
                              nodeId: node.id,
                              path: "opacity",
                              value: hidden ? 1 : 0,
                            })
                          }
                          className={`grid h-4 w-4 shrink-0 place-items-center rounded border text-[9px] transition-colors ${
                            hidden
                              ? "border-hairline text-transparent hover:border-accent/50"
                              : "border-accent bg-accent text-accent-foreground"
                          }`}
                          title={hidden ? "Show on the badge" : "Hide from the badge"}
                          aria-label={hidden ? `Show ${node.id}` : `Hide ${node.id}`}
                          aria-pressed={!hidden}
                        >
                          ✓
                        </button>
                      </div>

                      {open && (
                        <div className="space-y-2 px-2.5 pb-2.5 pl-7">
                          {isText && currentSize !== null && (
                            <>
                              <div className="flex items-center gap-2">
                                <span className="w-12 text-[10px] text-muted-foreground">Size</span>
                                <input
                                  type="range"
                                  min={8}
                                  max={140}
                                  value={currentSize}
                                  onChange={(e) =>
                                    patch(`resize ${node.id}`, {
                                      op: "set",
                                      nodeId: node.id,
                                      path: node.fit ? "fit.from" : "size",
                                      value: Number(e.target.value),
                                    })
                                  }
                                  className="flex-1 accent-accent"
                                />
                                <span className="w-8 text-right font-mono text-[10px] text-muted-foreground">
                                  {currentSize}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="w-12 text-[10px] text-muted-foreground">
                                  Align
                                </span>
                                <div className="flex gap-1">
                                  {(["left", "center", "right"] as const).map((a) => (
                                    <button
                                      key={a}
                                      type="button"
                                      onClick={() =>
                                        patch(`align ${node.id} ${a}`, {
                                          op: "set",
                                          nodeId: node.id,
                                          path: "align",
                                          value: a,
                                        })
                                      }
                                      className={`rounded-md border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                                        node.align === a
                                          ? "border-accent text-accent"
                                          : "border-hairline text-muted-foreground hover:text-foreground"
                                      }`}
                                    >
                                      {a[0].toUpperCase()}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </>
                          )}
                          {!isText && (
                            <p className="text-[11px] leading-snug text-muted-foreground">
                              Ask the assistant to move or resize this one — “put the QR on the
                              left”.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
