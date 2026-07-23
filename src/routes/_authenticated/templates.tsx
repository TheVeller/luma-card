// Templates library — reusable badge style presets.
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listTemplates, deleteTemplate, type TemplateDTO } from "@/lib/templates.functions";
import { supabase } from "@/integrations/supabase/client";

import era1 from "@/assets/history/era1-code-brew.png";
import era2 from "@/assets/history/era2-v0-zero-to-agents.png";
import era3 from "@/assets/history/era3-gtm-hackathon.png";
import era4 from "@/assets/history/era4-cursor-meetup.png";
import era5 from "@/assets/history/era5-cursor-buildathon-sv.png";
import era6 from "@/assets/history/era6-codebrew-sv.png";

// System-template preview lookup (bundled with the app).
const SYSTEM_PREVIEWS: Record<string, string> = {
  "era1-code-brew": era1,
  "era2-v0-zero-to-agents": era2,
  "era3-gtm-hackathon": era3,
  "era4-cursor-meetup": era4,
  "era5-cursor-buildathon-sv": era5,
  "era6-codebrew-sv": era6,
};

export const Route = createFileRoute("/_authenticated/templates")({
  head: () => ({
    meta: [
      { title: "Badge templates — reusable design presets" },
      {
        name: "description",
        content: "Reusable badge style presets from historical events. Apply any template to any event.",
      },
      { property: "og:title", content: "Badge templates" },
      { property: "og:description", content: "Reusable badge style presets that you can apply to any event." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TemplatesPage,
});

function previewFor(t: TemplateDTO): string | null {
  if (t.isSystem && SYSTEM_PREVIEWS[t.slug]) return SYSTEM_PREVIEWS[t.slug];
  if (!t.previewPath) return null;
  const { data } = supabase.storage.from("badges").getPublicUrl(t.previewPath);
  return data.publicUrl;
}

function TemplatesPage() {
  const fetchList = useServerFn(listTemplates);
  const del = useServerFn(deleteTemplate);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["templates"],
    queryFn: () => fetchList(),
  });

  const [scope, setScope] = useState<"all" | "system" | "mine">("all");
  const [selected, setSelected] = useState<TemplateDTO | null>(null);

  const filtered = useMemo(() => {
    const list = data ?? [];
    if (scope === "system") return list.filter((t) => t.isSystem);
    if (scope === "mine") return list.filter((t) => !t.isSystem);
    return list;
  }, [data, scope]);

  async function onDelete(t: TemplateDTO) {
    if (!window.confirm(`Delete template "${t.name}"?`)) return;
    try {
      await del({ data: { id: t.id } });
      await qc.invalidateQueries({ queryKey: ["templates"] });
    } catch (e) {
      alert(`Delete failed: ${(e as Error).message}`);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            · Design library
          </div>
          <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">Templates</h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Reusable badge style presets. Built-in eras come from the historical event-badge repo.
            Open any event and apply a template to instantly re-skin the preview.
          </p>
        </div>
        <div className="inline-flex rounded-full border border-hairline bg-surface/60 p-1 text-xs font-medium">
          {(
            [
              ["all", "All"],
              ["system", "Built-in"],
              ["mine", "Mine"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setScope(k)}
              className={
                "rounded-full px-4 py-1.5 transition " +
                (scope === k
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="mt-10 font-mono text-xs text-muted-foreground">LOADING…</div>
      ) : filtered.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-hairline p-10 text-center text-sm text-muted-foreground">
          No templates in this view.
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t) => {
            const preview = previewFor(t);
            return (
              <button
                key={t.id}
                onClick={() => setSelected(t)}
                className="group text-left"
              >
                <div className="overflow-hidden rounded-2xl border border-hairline bg-surface-2">
                  {preview ? (
                    <img
                      src={preview}
                      alt={t.name}
                      loading="lazy"
                      className="aspect-[27/40] w-full object-cover transition-transform group-hover:scale-[1.02]"
                    />
                  ) : (
                    <div className="grid aspect-[27/40] w-full place-items-center font-mono text-[10px] text-muted-foreground">
                      no preview
                    </div>
                  )}
                </div>
                <div className="mt-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-display text-base font-semibold">{t.name}</div>
                    {t.description && (
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {t.description}
                      </div>
                    )}
                    <div className="mt-2 flex items-center gap-1.5">
                      {(["bg", "surface", "accent", "text"] as const).map((k) => (
                        <span
                          key={k}
                          title={`${k}: ${t.styleSpec.palette[k]}`}
                          className="inline-block h-3.5 w-3.5 rounded border border-hairline"
                          style={{ backgroundColor: t.styleSpec.palette[k] }}
                        />
                      ))}
                      <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                        {t.isSystem ? "built-in" : "yours"}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur"
          onClick={() => setSelected(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-hairline bg-background p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-display text-xl font-semibold">{selected.name}</div>
                {selected.description && (
                  <div className="mt-1 text-xs text-muted-foreground">{selected.description}</div>
                )}
                <div className="mt-3 flex items-center gap-1.5">
                  {(["bg", "surface", "accent", "text", "textMuted"] as const).map((k) => (
                    <span
                      key={k}
                      title={`${k}: ${selected.styleSpec.palette[k]}`}
                      className="inline-block h-4 w-4 rounded border border-hairline"
                      style={{ backgroundColor: selected.styleSpec.palette[k] }}
                    />
                  ))}
                </div>
                <div className="mt-3 space-y-0.5 text-xs">
                  <div>style: <b>{selected.styleSpec.style}</b></div>
                  <div>heading: <b>{selected.styleSpec.fonts.heading}</b></div>
                  <div>body: <b>{selected.styleSpec.fonts.body}</b></div>
                  <div className="text-muted-foreground">mood: {selected.styleSpec.mood}</div>
                </div>
              </div>
              {previewFor(selected) && (
                <img
                  src={previewFor(selected) ?? undefined}
                  alt={selected.name}
                  className="h-32 w-auto rounded-lg border border-hairline"
                />
              )}
            </div>
            <div className="mt-5 flex items-center justify-between">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Open any event → apply this template in the AI style panel.
              </div>
              {!selected.isSystem && (
                <button
                  onClick={() => onDelete(selected)}
                  className="rounded-full border border-destructive/60 px-3 py-1 text-xs font-semibold text-destructive hover:bg-destructive hover:text-destructive-foreground"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
