import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Grid3X3, List, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { listEvents, type EventDTO } from "@/lib/luma.functions";
import { useActiveCalendar } from "@/hooks/use-active-calendar";
import { downloadEventsDataset } from "@/lib/export-events";
import { syncEventLibrary } from "@/lib/event-sync.functions";
import { EventSourceImporter } from "@/components/EventSourceImporter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  compareEventsStartDesc,
  compareEventsUpcomingFirst,
  eventTemporalStatus,
  parseEventTime,
} from "@/lib/event-time";

type EventsSearch = {
  q: string;
  provider: string;
  labels: string[];
};

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return value.split(",").filter(Boolean);
  return [];
}

export const Route = createFileRoute("/_authenticated/events")({
  validateSearch: (search: Record<string, unknown>): EventsSearch => ({
    q: typeof search.q === "string" ? search.q : "",
    provider: typeof search.provider === "string" ? search.provider : "all",
    labels: toStringArray(search.labels),
  }),
  head: () => ({
    meta: [
      { title: "Your events — Event Router" },
      {
        name: "description",
        content: "Browse aggregated events and generate personalized shareable badges.",
      },
      { property: "og:title", content: "Your aggregated events" },
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
type ViewMode = "gallery" | "list" | "calendar";

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
const VIEW_STORAGE_KEY = "luma-card.events.view";

const VIEW_MODES: { key: ViewMode; label: string; Icon: typeof Grid3X3 }[] = [
  { key: "gallery", label: "Gallery", Icon: Grid3X3 },
  { key: "list", label: "List", Icon: List },
  { key: "calendar", label: "Calendar", Icon: CalendarDays },
];

function eventTime(ev: EventDTO): number | null {
  return parseEventTime(ev.startAt);
}

function compareEventName(a: EventDTO, b: EventDTO): number {
  return NAME_COLLATOR.compare(a.name, b.name) || a.id.localeCompare(b.id);
}

function formatMonthTitle(date: Date) {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatDayLabel(date: Date) {
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

function eventKey(ev: EventDTO) {
  return `${ev.calendarId ?? "d"}:${ev.id}`;
}

function sourceLabel(ev: EventDTO) {
  return ev.calendarName ?? ev.calendarId ?? "Default calendar";
}

function EventsPage() {
  const fetchEvents = useServerFn(listEvents);
  const runSync = useServerFn(syncEventLibrary);
  const qc = useQueryClient();
  const { activeCalendarId } = useActiveCalendar();
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["luma-events", activeCalendarId ?? "default"],
    queryFn: () => fetchEvents({ data: { calendarId: activeCalendarId ?? undefined } }),
  });
  const syncMut = useMutation({
    mutationFn: () => runSync(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["luma-events"] });
    },
  });

  const [filter, setFilter] = useState<"all" | "upcoming" | "past">("all");
  const [sortMode, setSortMode] = useState<SortMode>("upcoming");
  const [viewMode, setViewMode] = useState<ViewMode>("gallery");
  const [exportMenu, setExportMenu] = useState(false);
  const [sortMenu, setSortMenu] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const saved = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (saved === "gallery" || saved === "list" || saved === "calendar") {
      setViewMode(saved);
    }
  }, []);

  useEffect(() => {
    const refreshNow = () => setNow(Date.now());
    window.addEventListener("focus", refreshNow);
    const timer = window.setInterval(refreshNow, 60_000);
    return () => {
      window.removeEventListener("focus", refreshNow);
      window.clearInterval(timer);
    };
  }, []);

  function setView(next: ViewMode) {
    setViewMode(next);
    window.localStorage.setItem(VIEW_STORAGE_KEY, next);
  }

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
    return data.filter((ev: EventDTO) => {
      const status = eventTemporalStatus(ev, now);
      if (filter === "upcoming") return status === "upcoming" || status === "ongoing";
      if (filter === "past") return status === "past";
      return true;
    });
  }, [data, filter, now]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortMode === "upcoming") arr.sort((a, b) => compareEventsUpcomingFirst(a, b, now));
    else if (sortMode === "latest") arr.sort(compareEventsStartDesc);
    else arr.sort(compareEventName);
    return arr;
  }, [filtered, sortMode, now]);

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
          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="rounded-full border border-hairline px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface hover:text-foreground"
            >
              + Import link
            </button>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Import event source</DialogTitle>
                <DialogDescription>
                  Paste a public Luma, Eventbrite, or Meetup link. The provider and source type are
                  detected automatically.
                </DialogDescription>
              </DialogHeader>
              <EventSourceImporter
                compact
                onImported={async () => {
                  await refetch();
                }}
              />
            </DialogContent>
          </Dialog>
          <button
            onClick={() => refetch()}
            className="rounded-full border border-hairline px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface hover:text-foreground"
          >
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
          <button
            onClick={() => syncMut.mutate()}
            disabled={!data || data.length === 0 || syncMut.isPending}
            className="rounded-full border border-hairline px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface hover:text-foreground disabled:opacity-40"
          >
            {syncMut.isPending ? "Syncing…" : "Sync library"}
          </button>
        </div>
      </div>

      {syncMut.isSuccess && (
        <div className="mt-4 rounded-xl border border-hairline bg-surface/60 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          Synced {syncMut.data.synced}/{syncMut.data.scanned} sources
          {syncMut.data.failed > 0 ? ` · ${syncMut.data.failed} failed` : ""}
        </div>
      )}
      {syncMut.isError && (
        <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          Sync failed: {(syncMut.error as Error).message}
        </div>
      )}

      {data && data.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
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
          <div className="inline-flex rounded-full border border-hairline bg-surface/60 p-1 text-xs font-medium">
            {VIEW_MODES.map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={
                  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 transition " +
                  (viewMode === key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground")
                }
                title={`${label} view`}
              >
                <Icon className="size-3.5" aria-hidden />
                <span>{label}</span>
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

      {sorted.length > 0 && viewMode === "gallery" && (
        <GalleryView events={sorted} showCalendarName={activeCalendarId === "__all__"} />
      )}
      {sorted.length > 0 && viewMode === "list" && (
        <ListView events={sorted} showCalendarName={activeCalendarId === "__all__"} />
      )}
      {sorted.length > 0 && viewMode === "calendar" && <CalendarView events={sorted} />}
    </div>
  );
}

function EventImage({ ev, className }: { ev: EventDTO; className: string }) {
  return ev.coverUrl ? (
    <img src={proxied(ev.coverUrl)} alt={ev.name} className={className} />
  ) : (
    <div className="flex h-full w-full items-center justify-center bg-surface-2 font-mono text-xs text-muted-foreground">
      NO COVER
    </div>
  );
}

function GalleryView({
  events,
  showCalendarName,
}: {
  events: EventDTO[];
  showCalendarName: boolean;
}) {
  return (
    <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {events.map((ev) => (
        <Link
          key={eventKey(ev)}
          to="/e/$eventId"
          params={{ eventId: ev.id }}
          className="group overflow-hidden rounded-2xl border border-hairline bg-surface/70 transition hover:-translate-y-0.5 hover:border-white/20"
        >
          <div className="relative aspect-square w-full overflow-hidden bg-surface-2">
            <EventImage
              ev={ev}
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
            />
            <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/70 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 p-3 text-[11px] font-medium text-white/90">
              <span>{formatDate(ev.startAt)}</span>
              {ev.city && <span className="rounded-full bg-black/40 px-2 py-0.5">{ev.city}</span>}
            </div>
            {showCalendarName && ev.calendarName && (
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
  );
}

function ListView({ events, showCalendarName }: { events: EventDTO[]; showCalendarName: boolean }) {
  return (
    <div className="mt-8 overflow-hidden rounded-2xl border border-hairline bg-surface/50">
      {events.map((ev) => (
        <Link
          key={eventKey(ev)}
          to="/e/$eventId"
          params={{ eventId: ev.id }}
          className="grid grid-cols-[88px_minmax(0,1fr)] gap-4 border-b border-hairline p-3 transition last:border-b-0 hover:bg-surface sm:grid-cols-[112px_minmax(0,1fr)_auto] sm:items-center"
        >
          <div className="h-20 overflow-hidden rounded-xl bg-surface-2 sm:h-24">
            <EventImage ev={ev} className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <span>{formatDate(ev.startAt)}</span>
              {ev.city && <span>{ev.city}</span>}
              {showCalendarName && <span>{sourceLabel(ev)}</span>}
            </div>
            <h3 className="mt-1 line-clamp-2 font-display text-lg font-semibold leading-tight">
              {ev.name}
            </h3>
            {ev.description && (
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {ev.description}
              </p>
            )}
          </div>
          <div className="col-span-2 flex items-center justify-between gap-3 sm:col-span-1 sm:block sm:text-right">
            <span className="rounded-full border border-hairline px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {ev.id.startsWith("scr-") ? "Scrape" : "API"}
            </span>
            <div className="text-xs font-medium text-accent sm:mt-3">
              Generate badge <span aria-hidden>→</span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function CalendarView({ events }: { events: EventDTO[] }) {
  const firstVisible = events.find((ev) => eventTime(ev) !== null);
  const baseDate = firstVisible ? new Date(firstVisible.startAt) : new Date();
  const monthStart = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay());

  const days = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });

  const eventsByDay = new Map<string, EventDTO[]>();
  for (const ev of events) {
    const time = eventTime(ev);
    if (time === null) continue;
    const date = new Date(time);
    if (date.getMonth() !== baseDate.getMonth() || date.getFullYear() !== baseDate.getFullYear()) {
      continue;
    }
    const key = date.toISOString().slice(0, 10);
    const bucket = eventsByDay.get(key) ?? [];
    bucket.push(ev);
    eventsByDay.set(key, bucket);
  }

  return (
    <div className="mt-8 rounded-2xl border border-hairline bg-surface/50 p-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-display text-xl font-semibold">{formatMonthTitle(baseDate)}</h2>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {eventsByDay.size} active days
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-7">
        {days.map((day) => {
          const key = day.toISOString().slice(0, 10);
          const dayEvents = eventsByDay.get(key) ?? [];
          const inMonth = day.getMonth() === baseDate.getMonth();
          return (
            <div
              key={key}
              className={
                "min-h-32 rounded-xl border border-hairline bg-background/45 p-2 " +
                (inMonth ? "" : "opacity-35")
              }
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {formatDayLabel(day)}
              </div>
              <div className="mt-2 space-y-1.5">
                {dayEvents.slice(0, 3).map((ev) => (
                  <Link
                    key={eventKey(ev)}
                    to="/e/$eventId"
                    params={{ eventId: ev.id }}
                    className="block rounded-lg border border-hairline bg-surface px-2 py-1.5 transition hover:border-white/20"
                  >
                    <div className="line-clamp-2 text-xs font-semibold leading-tight">
                      {ev.name}
                    </div>
                    <div className="mt-1 truncate font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                      {sourceLabel(ev)}
                    </div>
                  </Link>
                ))}
                {dayEvents.length > 3 && (
                  <div className="px-2 pt-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                    +{dayEvents.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
