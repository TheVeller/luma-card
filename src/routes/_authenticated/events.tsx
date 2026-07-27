import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listEvents, type EventDTO } from "@/lib/luma.functions";
import { useActiveCalendar } from "@/hooks/use-active-calendar";
import { downloadEventsDataset } from "@/lib/export-events";

export const Route = createFileRoute("/_authenticated/events")({
  head: () => ({
    meta: [
      { title: "Your Luma events — Badge Studio" },
      {
        name: "description",
        content: "Pick a Luma event to generate personalized shareable badges.",
      },
      { property: "og:title", content: "Your Luma events" },
      {
        property: "og:description",
        content: "Personalized badges for every event on your Luma calendar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EventsPage,
});

function formatDate(iso: string) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return iso;
  }
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function proxied(url: string | null): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("lumacdn.com") || u.hostname === "cdn.lu.ma") {
      return `/api/public/image?url=${encodeURIComponent(url)}`;
    }
  } catch {
    // not a parseable URL — use it as-is
  }
  return url;
}

type SortMode = "upcoming" | "latest" | "az";

const SORT_MODES: { key: SortMode; label: string }[] = [
  { key: "upcoming", label: "Upcoming first" },
  { key: "latest", label: "Latest first" },
  { key: "az", label: "A \u2013 Z" },
];

const SORT_LABEL: Record<SortMode, string> = Object.fromEntries(
  SORT_MODES.map((m) => [m.key, m.label]),
) as Record<SortMode, string>;

/**
 * Alphabetical order that behaves for the names these events actually have:
 * accents sort next to their base letter and "Meetup 2" comes before
 * "Meetup 10" instead of after it.
 */
const NAME_COLLATOR = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

function eventTime(ev: EventDTO): number | null {
  const time = Date.parse(ev.startAt);
  return Number.isFinite(time) ? time : null;
}

function compareEventName(a: EventDTO, b: EventDTO): number {
  return NAME_COLLATOR.compare(a.name, b.name) || a.id.localeCompare(b.id);
}

function compareByTimeAsc(a: EventDTO, b: EventDTO): number {
  const aTime = eventTime(a);
  const bTime = eventTime(b);
  if (aTime === null && bTime === null) return compareEventName(a, b);
  if (aTime === null) return 1;
  if (bTime === null) return -1;
  return aTime - bTime || compareEventName(a, b);
}

function compareByTimeDesc(a: EventDTO, b: EventDTO): number {
  const aTime = eventTime(a);
  const bTime = eventTime(b);
  if (aTime === null && bTime === null) return compareEventName(a, b);
  if (aTime === null) return 1;
  if (bTime === null) return -1;
  return bTime - aTime || compareEventName(a, b);
}

function compareByUpcoming(a: EventDTO, b: EventDTO, now: number): number {
  const aTime = eventTime(a);
  const bTime = eventTime(b);
  const aUpcoming = aTime !== null && aTime >= now;
  const bUpcoming = bTime !== null && bTime >= now;

  if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
  if (aTime === null || bTime === null) return compareByTimeAsc(a, b);
  if (aUpcoming) return aTime - bTime || compareEventName(a, b);
  return bTime - aTime || compareEventName(a, b);
}

function EventsPage() {
  const fetchEvents = useServerFn(listEvents);
  const { activeCalendarId } = useActiveCalendar();
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["luma-events", activeCalendarId ?? "default"],
    queryFn: () => fetchEvents({ data: { calendarId: activeCalendarId ?? undefined } }),
  });

  const [filter, setFilter] = useState<"all" | "upcoming" | "past">("all");
  const [sortMode, setSortMode] = useState<SortMode>("upcoming");
  const [exportMenu, setExportMenu] = useState(false);
  const [sortMenu, setSortMenu] = useState(false);

  const errorMessage = error ? ((error as Error).message ?? "") : "";
  const isMissingKey = errorMessage.includes("NO_LUMA_KEY");
  // The server has no Supabase credentials here — a misconfigured environment,
  // not something the user did wrong. Worth saying plainly: it used to surface
  // as a blank screen.
  const isUnconfigured =
    errorMessage.includes("SUPABASE_NOT_CONFIGURED") ||
    errorMessage.includes("Missing Supabase environment variable");

  const filtered = useMemo(() => {
    if (!data) return [];
    const now = Date.now();
    return data.filter((ev: EventDTO) => {
      const t = eventTime(ev);
      if (t === null) return filter === "all";
      if (filter === "upcoming") return t >= now;
      if (filter === "past") return t < now;
      return true;
    });
  }, [data, filter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const now = Date.now();
    if (sortMode === "upcoming") arr.sort((a, b) => compareByUpcoming(a, b, now));
    else if (sortMode === "latest") arr.sort(compareByTimeDesc);
    else arr.sort(compareEventName);
    return arr;
  }, [filtered, sortMode]);

  function exportDataset(kind: "json" | "csv") {
    if (!data) return;
    downloadEventsDataset(data, kind, activeCalendarId ?? "default");
    setExportMenu(false);
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            · Discover
          </div>
          <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">Your events</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Pick an event to generate a personalized badge for it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => {
                setSortMenu((v) => !v);
                setExportMenu(false);
              }}
              disabled={!data || data.length === 0}
              className="inline-flex items-center gap-1 rounded-full border border-hairline px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface hover:text-foreground disabled:opacity-40"
              title="Sort events"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18M6 12h12M10 18h4" />
              </svg>
              {SORT_LABEL[sortMode]}
              <span className="text-[9px] opacity-60">▾</span>
            </button>
            {sortMenu && (
              <div className="absolute right-0 top-full z-40 mt-1 w-36 overflow-hidden rounded-xl border border-hairline bg-surface shadow-xl">
                {SORT_MODES.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => {
                      setSortMode(key);
                      setSortMenu(false);
                    }}
                    className={
                      "flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium hover:bg-surface-2 " +
                      (sortMode === key ? "text-foreground" : "text-muted-foreground")
                    }
                  >
                    {label}
                    {sortMode === key && <span className="text-accent">•</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <button
              onClick={() => {
                setExportMenu((v) => !v);
                setSortMenu(false);
              }}
              disabled={!data || data.length === 0}
              className="rounded-full border border-hairline px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface hover:text-foreground disabled:opacity-40"
            >
              Export ▾
            </button>
            {exportMenu && (
              <div className="absolute right-0 top-full z-40 mt-1 w-40 overflow-hidden rounded-xl border border-hairline bg-surface shadow-xl">
                <button
                  onClick={() => exportDataset("json")}
                  className="block w-full px-3 py-2 text-left text-xs font-medium hover:bg-surface-2"
                >
                  Download JSON
                </button>
                <button
                  onClick={() => exportDataset("csv")}
                  className="block w-full px-3 py-2 text-left text-xs font-medium hover:bg-surface-2"
                >
                  Download CSV
                </button>
              </div>
            )}
          </div>
          <Link
            to="/import"
            className="rounded-full border border-hairline px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface hover:text-foreground"
          >
            + Import link
          </Link>
          <button
            onClick={() => refetch()}
            className="rounded-full border border-hairline px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface hover:text-foreground"
          >
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {data && data.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-full border border-hairline bg-surface/60 p-1 text-xs font-medium">
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

      {isUnconfigured ? (
        <div className="mt-10 rounded-2xl border border-hairline bg-surface/70 p-8">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">
            · Environment not connected
          </div>
          <h2 className="mt-2 font-display text-2xl font-semibold">
            This environment has no Supabase credentials
          </h2>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            Reading your calendars needs the server-side key, and it is not set here. Connect
            Supabase for this environment in Lovable Cloud (it is a deploy-time secret, so a preview
            or sandbox will not have it until you add it).
          </p>
          <div className="mt-4 font-mono text-xs text-muted-foreground">{errorMessage}</div>
        </div>
      ) : isMissingKey ? (
        <div className="mt-10 rounded-2xl border border-hairline bg-surface/70 p-8">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">
            · Setup required
          </div>
          <h2 className="mt-2 font-display text-2xl font-semibold">Add your Luma API key</h2>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            We need your Luma calendar API key to read your events. It's stored encrypted and only
            you can read it.
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
          <div className="mt-1 font-mono text-xs opacity-80">
            {String((error as Error).message)}
          </div>
        </div>
      ) : null}

      {data && data.length === 0 && (
        <p className="mt-10 text-sm text-muted-foreground">No events on this calendar yet.</p>
      )}

      {sorted.length > 0 && (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((ev) => (
            <Link
              key={`${ev.calendarId ?? "d"}:${ev.id}`}
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
                  {ev.city && (
                    <span className="rounded-full bg-black/40 px-2 py-0.5">{ev.city}</span>
                  )}
                </div>
                {activeCalendarId === "__all__" && ev.calendarName && (
                  <div className="absolute left-3 top-3 rounded-full border border-white/20 bg-black/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur">
                    {ev.calendarName}
                  </div>
                )}
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
