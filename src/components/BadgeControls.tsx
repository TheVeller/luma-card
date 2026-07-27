// Direct controls for the badge: palette, fonts and the elements themselves.
//
// Everything here goes through the same applyPatch the AI uses, so a manual
// edit cannot produce a document the AI would have been refused — and the
// protected nodes stay protected whoever is doing the editing.

import { useMemo } from "react";
import { GOOGLE_BODY_FONTS, GOOGLE_HEADING_FONTS } from "@/lib/google-fonts";
import { normalizeStyleSpec, type StyleSpec } from "@/lib/style-spec";
import { applyPatch, PROTECTED_NODE_IDS, type PatchOp } from "@/lib/badge-doc/patch";
import { isContainer, walk, type BadgeDoc, type BadgeNode } from "@/lib/badge-doc/schema";

type Props = {
  spec: StyleSpec;
  doc: BadgeDoc;
  onSpecChange: (spec: StyleSpec) => void;
  onDocChange: (doc: BadgeDoc, intent: string) => void;
};

const PALETTE_ROLES = [
  { key: "bg", label: "Background" },
  { key: "surface", label: "Surface" },
  { key: "accent", label: "Accent" },
  { key: "text", label: "Text" },
  { key: "textMuted", label: "Muted" },
] as const;

/** Elements worth offering as toggles — containers and structural wrappers are noise. */
function listToggleable(doc: BadgeDoc): { node: BadgeNode; protected: boolean }[] {
  const out: { node: BadgeNode; protected: boolean }[] = [];
  walk(doc.root, (n) => {
    if (isContainer(n) || n.type === "spacer") return;
    if (n.id.startsWith("corner-") || n.id.startsWith("frame-")) return;
    out.push({ node: n, protected: (PROTECTED_NODE_IDS as readonly string[]).includes(n.id) });
  });
  return out;
}

export function BadgeControls({ spec, doc, onSpecChange, onDocChange }: Props) {
  const toggleable = useMemo(() => listToggleable(doc), [doc]);

  function patch(intent: string, ...ops: PatchOp[]) {
    const result = applyPatch(doc, ops);
    // A refusal here is a bug in the control, not something to show the user,
    // so it fails closed and leaves the badge as it was.
    if (result.ok) onDocChange(result.doc, intent);
  }

  function setColor(role: (typeof PALETTE_ROLES)[number]["key"], value: string) {
    onSpecChange(normalizeStyleSpec({ ...spec, palette: { ...spec.palette, [role]: value } }));
  }

  return (
    <div className="space-y-4 rounded-2xl border border-hairline bg-surface/60 p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
        · Design
      </div>

      <div>
        <div className="mb-1.5 text-xs text-muted-foreground">Palette</div>
        <div className="flex flex-wrap gap-3">
          {PALETTE_ROLES.map((role) => (
            <label key={role.key} className="flex items-center gap-1.5" title={role.label}>
              <input
                type="color"
                value={spec.palette[role.key]}
                onChange={(e) => setColor(role.key, e.target.value)}
                className="h-7 w-7 cursor-pointer rounded border border-hairline bg-transparent p-0"
                aria-label={role.label}
              />
              <span className="font-mono text-[10px] text-muted-foreground">{role.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">Heading</span>
          <select
            value={spec.fonts.heading}
            onChange={(e) =>
              onSpecChange(
                normalizeStyleSpec({ ...spec, fonts: { ...spec.fonts, heading: e.target.value } }),
              )
            }
            className="w-full rounded-lg border border-hairline bg-background px-2 py-1.5 text-xs"
          >
            {GOOGLE_HEADING_FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">Body</span>
          <select
            value={spec.fonts.body}
            onChange={(e) =>
              onSpecChange(
                normalizeStyleSpec({ ...spec, fonts: { ...spec.fonts, body: e.target.value } }),
              )
            }
            className="w-full rounded-lg border border-hairline bg-background px-2 py-1.5 text-xs"
          >
            {GOOGLE_BODY_FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <div className="mb-1.5 text-xs text-muted-foreground">Elements</div>
        <div className="space-y-1">
          {toggleable.map(({ node, protected: locked }) => {
            const hidden = node.opacity === 0;
            return (
              <div key={node.id} className="flex items-center justify-between gap-2 text-xs">
                <span className={hidden ? "text-muted-foreground line-through" : ""}>
                  {node.name ?? node.id}
                </span>
                <div className="flex items-center gap-1">
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
                    className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] hover:bg-surface-2"
                  >
                    {hidden ? "show" : "hide"}
                  </button>
                  {node.type === "text" && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          patch(`smaller ${node.id}`, {
                            op: "set",
                            nodeId: node.id,
                            path: node.fit ? "fit.from" : "size",
                            value: Math.max(8, Math.round((node.fit?.from ?? node.size) * 0.9)),
                          })
                        }
                        className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[10px] hover:bg-surface-2"
                        title="Smaller"
                      >
                        A−
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          patch(`bigger ${node.id}`, {
                            op: "set",
                            nodeId: node.id,
                            path: node.fit ? "fit.from" : "size",
                            value: Math.min(400, Math.round((node.fit?.from ?? node.size) * 1.1)),
                          })
                        }
                        className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[10px] hover:bg-surface-2"
                        title="Bigger"
                      >
                        A+
                      </button>
                    </>
                  )}
                  {locked && (
                    <span
                      className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground"
                      title="Can be restyled and moved, but not deleted"
                    >
                      req
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
