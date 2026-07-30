import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Grid3X3, List, Search, SlidersHorizontal, X, Bookmark } from "lucide-react";
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
import {
  listEventTagDefinitions,
  listSavedEventViews,
  saveEventView,
  updateEventTags,
  type SavedEventViewDTO,
} from "@/lib/event-tags.functions";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export const Route = createFileRoute("/_authenticated/events")({
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
  const fetchTagDefinitions = useServerFn(listEventTagDefinitions);
  const fetchSavedViews = useServerFn(listSavedEventViews);
  const persistView = useServerFn(saveEventView);
  const mutateEventTags = useServerFn(updateEventTags);
  const qc = useQueryClient();
  const { activeCalendarId } = useActiveCalendar();
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["luma-events", activeCalendarId ?? "default"],
    queryFn: () => fetchEvents({ data: { calendarId: activeCalendarId ?? undefined } }),
  });
  const { data: tagDefinitions = [] } = useQuery({
    queryKey: ["event-tag-definitions"],
    queryFn: () => fetchTagDefinitions(),
  });
  const { data: savedViews = [], refetch: refetchViews } = useQuery({
    queryKey: ["saved-event-views"],
    queryFn: () => fetchSavedViews(),
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
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [onlineFilter, setOnlineFilter] = useState<"" | "true" | "false">("");
  const [tagFilter, setTagFilter] = useState("");
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTag, setBulkTag] = useState("");
  const bulkTagMut = useMutation({
    mutationFn: (mode: "add" | "remove") => {
      const [namespace, slug] = bulkTag.split(":");
      return mutateEventTags({
        data: {
          eventIds: [...selectedIds]
            .map((id) => data?.find((event) => event.id === id)?.canonicalId)
            .filter((id): id is string => Boolean(id)),
          tags: [{ namespace: namespace as "format" | "topic" | "audience", slug }],
          mode,
        },
      });
    },
    onSuccess: () => {
      setSelectedIds(new Set());
      setBulkTag("");
      qc.invalidateQueries({ queryKey: ["luma-events"] });
    },
  });

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
      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        if (
          ![ev.name, ev.description, ev.city]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(needle)) === false
        )
          return false;
      }
      if (providerFilter && !ev.sources?.some((source) => source.provider === providerFilter))
        return false;
      if (onlineFilter && String(Boolean(ev.enrichment?.isOnline)) !== onlineFilter) return false;
      if (
        tagFilter &&
        !(ev.tagDetails ?? []).some(
          (tag) => `${tag.namespace}:${tag.slug}` === tagFilter && tag.state === "active",
        )
      )
        return false;
      return true;
    });
  }, [data, filter, now, search, providerFilter, onlineFilter, tagFilter]);

  const activeFilterCount = [search, providerFilter, onlineFilter, tagFilter].filter(
    Boolean,
  ).length;
  async function saveCurrentView() {
    if (!viewName.trim()) return;
    await persistView({
      data: {
        name: viewName.trim(),
        filters: { search, provider: providerFilter, online: onlineFilter, tag: tagFilter },
        sortMode,
        viewMode,
      },
    });
    setViewName("");
    setSaveViewOpen(false);
    await refetchViews();
  }

  function applySavedView(view: SavedEventViewDTO) {
    const filters = view.filters;
    setSearch(typeof filters.search === "string" ? filters.search : "");
    setProviderFilter(typeof filters.provider === "string" ? filters.provider : "");
    setOnlineFilter(filters.online === "true" || filters.online === "false" ? filters.online : "");
    setTagFilter(typeof filters.tag === "string" ? filters.tag : "");
    if (["upcoming", "latest", "az"].includes(view.sortMode))
      setSortMode(view.sortMode as SortMode);
    if (["gallery", "list", "calendar"].includes(view.viewMode)) setView(view.viewMode as ViewMode);
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <div className="flex min-w-48 flex-1 items-center gap-2 rounded-full border border-hairline bg-surface/60 px-3 py-1.5">
              <Search className="size-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search events"
                className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              />
              {search && (
                <button onClick={() => setSearch("")} aria-label="Clear search">
                  <X className="size-3.5" />
                </button>
              )}
            </div>
            <button
              onClick={() => setAdvancedOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface/60 px-3 py-1.5 text-xs font-medium hover:bg-surface-2"
            >
              <SlidersHorizontal className="size-3.5" /> Filters
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <select
              value=""
              onChange={(event) => {
                const view = savedViews.find((item) => item.id === event.target.value);
                if (view) applySavedView(view);
              }}
              className="max-w-40 rounded-full border border-hairline bg-surface/60 px-3 py-1.5 text-xs"
            >
              <option value="">Saved views</option>
              {savedViews.map((view) => (
                <option key={view.id} value={view.id}>
                  {view.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => setSaveViewOpen((value) => !value)}
              className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface/60 px-3 py-1.5 text-xs"
            >
              <Bookmark className="size-3.5" /> Save view
            </button>
          </div>
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

      {saveViewOpen && (
        <div className="mt-2 flex max-w-md items-center gap-2 rounded-xl border border-hairline bg-surface/70 p-2">
          <input
            autoFocus
            value={viewName}
            onChange={(event) => setViewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") saveCurrentView();
            }}
            placeholder="View name"
            className="min-w-0 flex-1 rounded-lg bg-background px-3 py-2 text-xs outline-none"
          />
          <button
            onClick={saveCurrentView}
            disabled={!viewName.trim()}
            className="rounded-full bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-40"
          >
            Save
          </button>
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent/30 bg-accent/5 p-2">
          <span className="text-xs font-medium">{selectedIds.size} selected</span>
          <select
            value={bulkTag}
            onChange={(event) => setBulkTag(event.target.value)}
            className="h-8 rounded-lg border border-hairline bg-background px-2 text-xs"
          >
            <option value="">Choose tag</option>
            {tagDefinitions.map((tag) => (
              <option key={`${tag.namespace}:${tag.slug}`} value={`${tag.namespace}:${tag.slug}`}>
                {tag.namespace}: {tag.label}
              </option>
            ))}
          </select>
          <button
            disabled={!bulkTag || bulkTagMut.isPending}
            onClick={() => bulkTagMut.mutate("add")}
            className="rounded-full bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-40"
          >
            Add tag
          </button>
          <button
            disabled={!bulkTag || bulkTagMut.isPending}
            onClick={() => bulkTagMut.mutate("remove")}
            className="rounded-full border border-hairline px-3 py-1.5 text-xs disabled:opacity-40"
          >
            Remove
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-xs text-muted-foreground underline"
          >
            Clear
          </button>
        </div>
      )}

      <Sheet open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Advanced filters</SheetTitle>
            <SheetDescription>Combine filters to narrow your event library.</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-5">
            <label className="block text-xs font-medium">
              Provider
              <select
                value={providerFilter}
                onChange={(event) => setProviderFilter(event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-hairline bg-background px-3 text-sm"
              >
                <option value="">All providers</option>
                <option value="luma">Luma</option>
                <option value="meetup">Meetup</option>
                <option value="eventbrite">Eventbrite</option>
              </select>
            </label>
            <label className="block text-xs font-medium">
              Format
              <select
                value={tagFilter.startsWith("format:") ? tagFilter : ""}
                onChange={(event) => setTagFilter(event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-hairline bg-background px-3 text-sm"
              >
                <option value="">Any format</option>
                {tagDefinitions
                  .filter((tag) => tag.namespace === "format")
                  .map((tag) => (
                    <option key={tag.slug} value={`format:${tag.slug}`}>
                      {tag.label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block text-xs font-medium">
              Topic
              <select
                value={tagFilter.startsWith("topic:") ? tagFilter : ""}
                onChange={(event) => setTagFilter(event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-hairline bg-background px-3 text-sm"
              >
                <option value="">Any topic</option>
                {tagDefinitions
                  .filter((tag) => tag.namespace === "topic")
                  .map((tag) => (
                    <option key={tag.slug} value={`topic:${tag.slug}`}>
                      {tag.label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block text-xs font-medium">
              Online
              <select
                value={onlineFilter}
                onChange={(event) => setOnlineFilter(event.target.value as typeof onlineFilter)}
                className="mt-1 h-10 w-full rounded-lg border border-hairline bg-background px-3 text-sm"
              >
                <option value="">Any format</option>
                <option value="true">Online</option>
                <option value="false">In person</option>
              </select>
            </label>
            <button
              onClick={() => {
                setProviderFilter("");
                setOnlineFilter("");
                setTagFilter("");
                setAdvancedOpen(false);
              }}
              className="text-xs text-muted-foreground underline"
            >
              Clear advanced filters
            </button>
          </div>
        </SheetContent>
      </Sheet>

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
        <GalleryView
          events={sorted}
          showCalendarName={activeCalendarId === "__all__"}
          selectedIds={selectedIds}
          onToggle={toggleSelected}
        />
      )}
      {sorted.length > 0 && viewMode === "list" && (
        <ListView
          events={sorted}
          showCalendarName={activeCalendarId === "__all__"}
          selectedIds={selectedIds}
          onToggle={toggleSelected}
        />
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

function EventTagChips({ event, dark = false }: { event: EventDTO; dark?: boolean }) {
  const tags = event.tagDetails?.filter((tag) => tag.state === "active") ?? [];
  if (tags.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {tags.slice(0, 2).map((tag) => (
        <span
          key={`${tag.namespace}:${tag.slug}`}
          className={`rounded-full border px-2 py-0.5 text-[9px] font-medium ${dark ? "border-white/20 bg-black/30 text-white/90" : "border-hairline bg-surface-2 text-muted-foreground"}`}
        >
          {tag.label}
        </span>
      ))}
      {tags.length > 2 && (
        <span
          className={`rounded-full px-2 py-0.5 text-[9px] ${dark ? "bg-black/30 text-white/80" : "bg-surface-2 text-muted-foreground"}`}
        >
          +{tags.length - 2}
        </span>
      )}
    </div>
  );
}

function GalleryView({
  events,
  showCalendarName,
  selectedIds,
  onToggle,
}: {
  events: EventDTO[];
  showCalendarName: boolean;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
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
            <input
              type="checkbox"
              checked={selectedIds.has(ev.id)}
              onChange={() => onToggle(ev.id)}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              className="absolute left-3 top-3 z-10 size-4 accent-[hsl(var(--accent))]"
              aria-label={`Select ${ev.name}`}
            />
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
            <div className="absolute left-3 bottom-10">
              <EventTagChips event={ev} dark />
            </div>
          </div>
          <div className="p-4">
            <h3 className="line-clamp-2 font-display text-lg font-semibold leading-tight">
              {ev.name}
            </h3>
            <EventTagChips event={ev} />
            <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent">
              Generate badge <span aria-hidden>→</span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function ListView({
  events,
  showCalendarName,
  selectedIds,
  onToggle,
}: {
  events: EventDTO[];
  showCalendarName: boolean;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="mt-8 overflow-hidden rounded-2xl border border-hairline bg-surface/50">
      {events.map((ev) => (
        <Link
          key={eventKey(ev)}
          to="/e/$eventId"
          params={{ eventId: ev.id }}
          className="relative grid grid-cols-[88px_minmax(0,1fr)] gap-4 border-b border-hairline p-3 transition last:border-b-0 hover:bg-surface sm:grid-cols-[112px_minmax(0,1fr)_auto] sm:items-center"
        >
          <input
            type="checkbox"
            checked={selectedIds.has(ev.id)}
            onChange={() => onToggle(ev.id)}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            className="absolute left-1 top-1 z-10 size-4 accent-[hsl(var(--accent))]"
            aria-label={`Select ${ev.name}`}
          />
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
            <EventTagChips event={ev} />
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
