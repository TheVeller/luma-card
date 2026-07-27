// Saved styles and system templates in one place.
//
// These used to be two near-identical 3-column grids stacked on each other,
// which made two different things look like one. Same shape, one block, an
// explicit switch: what you saved vs what ships with the app.

import { useState } from "react";
import type { StyleSpec } from "@/lib/style-spec";
import type { EventStylePresetDTO } from "@/lib/event-style-presets.functions";
import type { TemplateDTO } from "@/lib/templates.functions";

type Props = {
  presets: EventStylePresetDTO[];
  templates: TemplateDTO[];
  activeStyle: StyleSpec;
  onApply: (spec: StyleSpec) => void;
  onDeletePreset: (id: string) => void;
};

function Swatches({ spec }: { spec: StyleSpec }) {
  return (
    <span className="flex h-8 overflow-hidden rounded-md border border-hairline">
      {(["bg", "surface", "accent", "text"] as const).map((k) => (
        <span key={k} className="flex-1" style={{ backgroundColor: spec.palette[k] }} />
      ))}
    </span>
  );
}

function sameStyle(a: StyleSpec, b: StyleSpec): boolean {
  return (
    a.palette.bg === b.palette.bg &&
    a.palette.accent === b.palette.accent &&
    a.palette.text === b.palette.text &&
    a.fonts.heading === b.fonts.heading &&
    a.fonts.body === b.fonts.body
  );
}

export function BadgeLibrary({ presets, templates, activeStyle, onApply, onDeletePreset }: Props) {
  const [tab, setTab] = useState<"saved" | "templates">(presets.length > 0 ? "saved" : "templates");

  const items =
    tab === "saved"
      ? presets.map((p) => ({
          id: p.id,
          name: p.label ?? p.styleSpec.style,
          spec: p.styleSpec,
          removable: true,
        }))
      : templates.map((t) => ({ id: t.id, name: t.name, spec: t.styleSpec, removable: false }));

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
          Library
        </h3>
        <div className="flex rounded-full border border-hairline p-0.5">
          {[
            {
              key: "saved" as const,
              label: `Saved ${presets.length ? `(${presets.length})` : ""}`,
            },
            { key: "templates" as const, label: "Templates" },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-full px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] transition-colors ${
                tab === t.key
                  ? "bg-surface-2 text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label.trim()}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-hairline px-3 py-4 text-center text-[11px] leading-snug text-muted-foreground">
          {tab === "saved"
            ? "Styles you generate or edit get saved here for this event."
            : "No templates available."}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {items.map((item) => {
            const active = sameStyle(item.spec, activeStyle);
            return (
              <div key={item.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onApply(item.spec)}
                  className={`w-full rounded-lg border p-1.5 text-left transition-colors ${
                    active ? "border-accent" : "border-hairline hover:border-accent/50"
                  }`}
                  title={`${item.spec.fonts.heading} · ${item.spec.fonts.body}`}
                >
                  <Swatches spec={item.spec} />
                  <span className="mt-1 block truncate text-[10px] font-semibold">{item.name}</span>
                  <span className="block truncate font-mono text-[9px] text-muted-foreground">
                    {item.spec.fonts.heading}
                  </span>
                </button>
                {item.removable && (
                  <button
                    type="button"
                    onClick={() => onDeletePreset(item.id)}
                    className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100"
                    title="Delete this saved style"
                    aria-label={`Delete ${item.name}`}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
