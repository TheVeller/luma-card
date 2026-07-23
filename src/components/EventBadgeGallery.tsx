import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listBadgesForEvent, type BadgeEntry } from "@/lib/badges.functions";

type Props = {
  eventId: string;
  accent: string;
  textColor: string;
  refreshKey?: number;
};

export function EventBadgeGallery({ eventId, accent, textColor, refreshKey = 0 }: Props) {
  const fetchList = useServerFn(listBadgesForEvent);
  const { data, isLoading } = useQuery({
    queryKey: ["badges", eventId, refreshKey],
    queryFn: () => fetchList({ data: { eventId, limit: 30 } }),
  });
  const [selected, setSelected] = useState<BadgeEntry | null>(null);

  return (
    <section className="mt-12">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <div className="font-mono text-xs tracking-[0.24em]" style={{ color: `${textColor}88` }}>
            · BADGE GALLERY
          </div>
          <h2 className="mt-1 text-xl font-black">Who's brewing</h2>
        </div>
        <div className="font-mono text-[10px] tracking-[0.24em]" style={{ color: `${textColor}88` }}>
          {data?.length ?? 0} BADGES
        </div>
      </div>

      {isLoading ? (
        <div className="font-mono text-xs opacity-60">LOADING…</div>
      ) : !data || data.length === 0 ? (
        <div
          className="rounded-md border-2 border-dashed p-8 text-center font-mono text-xs"
          style={{ borderColor: `${textColor}30`, color: `${textColor}88` }}
        >
          Be the first to make a badge for this event.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {data.map((b) => (
            <button
              key={b.id}
              onClick={() => setSelected(b)}
              className="group text-left"
            >
              <div
                className="aspect-square overflow-hidden rounded-md border-2"
                style={{ borderColor: `${textColor}20` }}
              >
                <img
                  src={b.publicUrl}
                  alt={b.firstName}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                />
              </div>
              <div className="mt-2 font-mono text-[10px] tracking-[0.2em] uppercase">
                {b.firstName}
              </div>
              {b.role && (
                <div className="font-mono text-[10px]" style={{ color: `${textColor}88` }}>
                  {b.role}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
          onClick={() => setSelected(null)}
        >
          <div className="max-w-md" onClick={(e) => e.stopPropagation()}>
            <img src={selected.publicUrl} alt={selected.firstName} className="w-full rounded-md" />
            <div className="mt-3 flex items-center justify-between text-[#f2efe6]">
              <div>
                <div className="font-black uppercase">{selected.firstName}</div>
                {selected.role && <div className="text-xs opacity-70">{selected.role}</div>}
              </div>
              <div className="flex gap-2">
                <a
                  href={selected.publicUrl}
                  download={`${selected.firstName}-badge.png`}
                  className="rounded-md border border-white/40 px-3 py-1.5 text-xs font-semibold"
                >
                  Download
                </a>
                <button
                  onClick={() => setSelected(null)}
                  className="rounded-md px-3 py-1.5 text-xs font-semibold text-[#17150f]"
                  style={{ backgroundColor: accent }}
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
