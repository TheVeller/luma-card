// Unified gallery of every badge the signed-in user has created.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  listAllBadgesForUser,
  deleteMyBadges,
  wipeMyBadges,
  type UserBadgeEntry,
} from "@/lib/badges.functions";
import { listEvents, type EventDTO } from "@/lib/luma.functions";
import { useActiveCalendar } from "@/hooks/use-active-calendar";

export const Route = createFileRoute("/_authenticated/gallery")({
  head: () => ({
    meta: [
      { title: "Badge gallery — Luma Badge Studio" },
      { name: "description", content: "All badges you have generated across every event." },
      { property: "og:title", content: "Your badge gallery" },
      { property: "og:description", content: "Every badge you have generated, in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: GalleryPage,
});

type Sort = "recent" | "oldest" | "name" | "event";

function GalleryPage() {
  const fetchBadges = useServerFn(listAllBadgesForUser);
  const fetchEvents = useServerFn(listEvents);
  const del = useServerFn(deleteMyBadges);
  const wipe = useServerFn(wipeMyBadges);
  const qc = useQueryClient();
  const { activeCalendarId } = useActiveCalendar();

  const { data: badges, isLoading } = useQuery({
    queryKey: ["all-badges"],
    queryFn: () => fetchBadges(),
  });
  const { data: events } = useQuery({
    queryKey: ["luma-events", activeCalendarId ?? "default"],
    queryFn: () => fetchEvents({ data: { calendarId: activeCalendarId ?? undefined } }),
  });

  const delMut = useMutation({
    mutationFn: (ids: string[]) => del({ data: { ids } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["all-badges"] });
      qc.invalidateQueries({ queryKey: ["badges"] });
      setSelected(null);
    },
  });
  const wipeMut = useMutation({
    mutationFn: () => wipe(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["all-badges"] });
      qc.invalidateQueries({ queryKey: ["badges"] });
    },
  });

  const eventById = useMemo(() => {
    const m = new Map<string, EventDTO>();
    (events ?? []).forEach((e) => m.set(e.id, e));
    return m;
  }, [events]);

  const [q, setQ] = useState("");
  const [eventFilter, setEventFilter] = useState<string>("");
  const [sort, setSort] = useState<Sort>("recent");
  const [selected, setSelected] = useState<UserBadgeEntry | null>(null);

  const eventOptions = useMemo(() => {
    if (!badges) return [] as Array<{ id: string; label: string; count: number }>;
    const counts = new Map<string, number>();
    badges.forEach((b) => counts.set(b.eventId, (counts.get(b.eventId) ?? 0) + 1));
    return Array.from(counts.entries())
      .map(([id, count]) => ({ id, count, label: eventById.get(id)?.name ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [badges, eventById]);

  const filtered = useMemo(() => {
    if (!badges) return [];
    const norm = q.trim().toLowerCase();
    const list = badges.filter((b) => {
      if (eventFilter && b.eventId !== eventFilter) return false;
      if (!norm) return true;
      return (
        b.firstName.toLowerCase().includes(norm) ||
        (b.role ?? "").toLowerCase().includes(norm) ||
        (eventById.get(b.eventId)?.name ?? "").toLowerCase().includes(norm)
      );
    });
    const cmp = {
      recent: (a: UserBadgeEntry, b: UserBadgeEntry) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      oldest: (a: UserBadgeEntry, b: UserBadgeEntry) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      name: (a: UserBadgeEntry, b: UserBadgeEntry) => a.firstName.localeCompare(b.firstName),
      event: (a: UserBadgeEntry, b: UserBadgeEntry) => {
        const an = eventById.get(a.eventId)?.name ?? a.eventId;
        const bn = eventById.get(b.eventId)?.name ?? b.eventId;
        return an.localeCompare(bn);
      },
    }[sort];
    return list.sort(cmp);
  }, [badges, q, eventFilter, sort, eventById]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            · Your badges
          </div>
          <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">Gallery</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Every badge you have generated · {badges?.length ?? 0} total
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, role or event…"
          className="min-w-[220px] flex-1 rounded-full border border-hairline bg-surface/70 px-4 py-2 text-sm placeholder:text-muted-foreground focus:border-white/30 focus:outline-none"
        />
        <select
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value)}
          className="rounded-full border border-hairline bg-surface/70 px-4 py-2 text-sm focus:border-white/30 focus:outline-none"
        >
          <option value="">All events</option>
          {eventOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label} ({o.count})
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="rounded-full border border-hairline bg-surface/70 px-4 py-2 text-sm focus:border-white/30 focus:outline-none"
        >
          <option value="recent">Most recent</option>
          <option value="oldest">Oldest first</option>
          <option value="name">Name (A→Z)</option>
          <option value="event">Event (A→Z)</option>
        </select>
      </div>

      {isLoading ? (
        <div className="mt-10 font-mono text-xs text-muted-foreground">LOADING…</div>
      ) : filtered.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-hairline p-10 text-center text-sm text-muted-foreground">
          {badges && badges.length > 0
            ? "No badges match those filters."
            : "You haven't generated any badges yet."}
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filtered.map((b) => {
            const evName = eventById.get(b.eventId)?.name;
            return (
              <button key={b.id} onClick={() => setSelected(b)} className="group text-left">
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
                <div className="mt-1 truncate font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                  {evName ?? b.eventId}
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
          <div className="max-w-md" onClick={(e) => e.stopPropagation()}>
            <img src={selected.publicUrl} alt={selected.firstName} className="w-full rounded-xl" />
            <div className="mt-3 flex items-center justify-between text-white">
              <div className="min-w-0">
                <div className="font-display text-lg font-semibold">{selected.firstName}</div>
                {selected.role && <div className="text-xs text-white/70">{selected.role}</div>}
                <div className="mt-1 truncate font-mono text-[10px] uppercase tracking-[0.18em] text-white/50">
                  {eventById.get(selected.eventId)?.name ?? selected.eventId}
                </div>
              </div>
              <div className="flex gap-2">
                <Link
                  to="/e/$eventId"
                  params={{ eventId: selected.eventId }}
                  className="rounded-full border border-white/30 px-4 py-1.5 text-xs font-semibold"
                >
                  Open event
                </Link>
                <a
                  href={selected.publicUrl}
                  download={`${selected.firstName}-badge.png`}
                  className="rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-accent-foreground"
                >
                  Download
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
