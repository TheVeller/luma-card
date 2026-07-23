import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listEvents } from "@/lib/luma.functions";

export const Route = createFileRoute("/_authenticated/events")({
  head: () => ({
    meta: [
      { title: "Your Luma events — Badge Studio" },
      { name: "description", content: "Pick a Luma event to generate personalized shareable badges." },
      { property: "og:title", content: "Your Luma events" },
      { property: "og:description", content: "Personalized badges for every event on your Luma calendar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EventsPage,
});

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function proxied(url: string | null): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("lumacdn.com") || u.hostname === "cdn.lu.ma") {
      return `/api/public/image?url=${encodeURIComponent(url)}`;
    }
  } catch {}
  return url;
}

function EventsPage() {
  const fetchEvents = useServerFn(listEvents);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["luma-events"],
    queryFn: () => fetchEvents(),
  });

  const [filter, setFilter] = useState<"all" | "upcoming" | "past">("all");

  const isMissingKey =
    error && (error as Error).message?.includes("NO_LUMA_KEY");

  const filtered = useMemo(() => {
    if (!data) return [];
    const now = Date.now();
    return data.filter((ev) => {
      const t = new Date(ev.startAt).getTime();
      if (filter === "upcoming") return t >= now;
      if (filter === "past") return t < now;
      return true;
    });
  }, [data, filter]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            · Discover
          </div>
          <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">
            Your events
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Pick an event to generate a personalized badge for it.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="rounded-full border border-hairline px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface hover:text-foreground"
        >
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {data && data.length > 0 && (
        <div className="mt-6 inline-flex rounded-full border border-hairline bg-surface/60 p-1 text-xs font-medium">
          {(["all", "upcoming", "past"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={
                "rounded-full px-4 py-1.5 capitalize transition " +
                (filter === f
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {f}
            </button>
          ))}
        </div>
      )}

      {isLoading && (
        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="animate-pulse overflow-hidden rounded-2xl border border-hairline bg-surface/60"
            >
              <div className="aspect-square w-full bg-surface-2" />
              <div className="space-y-2 p-4">
                <div className="h-3 w-24 rounded bg-surface-2" />
                <div className="h-5 w-3/4 rounded bg-surface-2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {isMissingKey ? (
        <div className="mt-10 rounded-2xl border border-hairline bg-surface/70 p-8">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">
            · Setup required
          </div>
          <h2 className="mt-2 font-display text-2xl font-semibold">Add your Luma API key</h2>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            Necesitamos tu Luma calendar API key para leer tus eventos. Se guarda cifrada y solo tú puedes leerla.
          </p>
          <Link
            to="/settings"
            className="mt-5 inline-flex rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
          >
            Go to Settings →
          </Link>
        </div>
      ) : error ? (
        <div className="mt-10 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <b>Failed to load events.</b>
          <div className="mt-1 font-mono text-xs opacity-80">{String((error as Error).message)}</div>
        </div>
      ) : null}

      {data && data.length === 0 && (
        <p className="mt-10 text-sm text-muted-foreground">No events on this calendar yet.</p>
      )}

      {filtered.length > 0 && (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((ev) => (
            <Link
              key={ev.id}
              to="/e/$eventId"
              params={{ eventId: ev.id }}
              className="group overflow-hidden rounded-2xl border border-hairline bg-surface/70 transition hover:-translate-y-0.5 hover:border-white/20"
            >
              <div className="relative aspect-square w-full overflow-hidden bg-surface-2">
                {ev.coverUrl ? (
                  <img
                    src={proxied(ev.coverUrl)}
                    alt={ev.name}
                    className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
                    NO COVER
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/70 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between p-3 text-[11px] font-medium text-white/90">
                  <span>{formatDate(ev.startAt)}</span>
                  {ev.city && <span className="rounded-full bg-black/40 px-2 py-0.5">{ev.city}</span>}
                </div>
              </div>
              <div className="p-4">
                <h3 className="line-clamp-2 font-display text-lg font-semibold leading-tight">
                  {ev.name}
                </h3>
                <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent">
                  Generate badge <span aria-hidden>→</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
