import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listBadgesForEvent, deleteMyBadges, type BadgeEntry } from "@/lib/badges.functions";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  eventId: string;
  accent: string;
  textColor: string;
  refreshKey?: number;
};

export function EventBadgeGallery({ eventId, accent, refreshKey = 0 }: Props) {
  const fetchList = useServerFn(listBadgesForEvent);
  const del = useServerFn(deleteMyBadges);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["badges", eventId, refreshKey],
    queryFn: () => fetchList({ data: { eventId, limit: 30 } }),
  });
  const [selected, setSelected] = useState<BadgeEntry | null>(null);
  const [me, setMe] = useState<string | null>(null);

  // Cache current user id lazily so we can show delete on rows we own
  useState(() => {
    void supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
    return null;
  });

  const delMut = useMutation({
    mutationFn: (ids: string[]) => del({ data: { ids } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["badges", eventId] });
      qc.invalidateQueries({ queryKey: ["all-badges"] });
      setSelected(null);
    },
  });

  async function confirmDelete(b: BadgeEntry) {
    if (!window.confirm(`Delete this badge for "${b.firstName}"?`)) return;
    delMut.mutate([b.id]);
  }

  return (
    <section className="mt-12">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            · Badge gallery
          </div>
          <h2 className="mt-1 font-display text-xl font-semibold">Who's brewing</h2>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
          {data?.length ?? 0} badges
        </div>
      </div>

      {isLoading ? (
        <div className="font-mono text-xs text-muted-foreground">LOADING…</div>
      ) : !data || data.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-hairline p-8 text-center text-xs text-muted-foreground">
          Be the first to make a badge for this event.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {data.map((b) => {
            const isMine = me && b.ownerId === me;
            return (
              <div key={b.id} className="group relative">
                <button onClick={() => setSelected(b)} className="w-full text-left">
                  <div className="aspect-square overflow-hidden rounded-xl border border-hairline bg-surface-2">
                    <img
                      src={b.publicUrl}
                      alt={b.firstName}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                    />
                  </div>
                  <div className="mt-2 truncate text-xs font-semibold">{b.firstName}</div>
                  {b.role && (
                    <div className="truncate text-[11px] text-muted-foreground">{b.role}</div>
                  )}
                </button>
                {isMine && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      confirmDelete(b);
                    }}
                    title="Delete badge"
                    className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur transition-opacity hover:bg-destructive group-hover:opacity-100"
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur"
          onClick={() => setSelected(null)}
        >
          <div className="max-w-md" onClick={(e) => e.stopPropagation()}>
            <img src={selected.publicUrl} alt={selected.firstName} className="w-full rounded-xl" />
            <div className="mt-3 flex items-center justify-between text-white">
              <div>
                <div className="font-display text-lg font-semibold">{selected.firstName}</div>
                {selected.role && <div className="text-xs text-white/70">{selected.role}</div>}
              </div>
              <div className="flex gap-2">
                {me && selected.ownerId === me && (
                  <button
                    onClick={() => confirmDelete(selected)}
                    disabled={delMut.isPending}
                    className="rounded-full border border-destructive/60 px-4 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive hover:text-destructive-foreground"
                  >
                    {delMut.isPending ? "…" : "Delete"}
                  </button>
                )}
                <a
                  href={selected.publicUrl}
                  download={`${selected.firstName}-badge.png`}
                  className="rounded-full border border-white/30 px-4 py-1.5 text-xs font-semibold"
                >
                  Download
                </a>
                <button
                  onClick={() => setSelected(null)}
                  className="rounded-full px-4 py-1.5 text-xs font-semibold"
                  style={{ backgroundColor: accent, color: "#0a0a0a" }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
