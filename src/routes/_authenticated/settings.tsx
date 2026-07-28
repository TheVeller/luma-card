import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getLumaConfig } from "@/lib/user-luma-key.functions";
import { importFromUrl } from "@/lib/luma-scrape.functions";
import {
  addCalendar,
  listCalendars,
  removeCalendar,
  setDefaultCalendar,
  type UserCalendarDTO,
} from "@/lib/user-luma-calendars.functions";
import { listApiTokens, createApiToken, revokeApiToken } from "@/lib/api-tokens.functions";
import {
  importBulkSources,
  listSyncSources,
  processSyncQueue,
  syncAllSources,
  syncOneSource,
} from "@/lib/calendar-sync.functions";
import {
  acceptCalendarGroupSuggestion,
  createCalendarGroup,
  deleteCalendarGroup,
  listCalendarGroups,
  saveCalendarOrganization,
} from "@/lib/calendar-groups.functions";
import { getEventLibraryStats } from "@/lib/event-library-stats.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Luma Badge Studio" },
      { name: "description", content: "Manage your Luma calendars and API keys." },
      { property: "og:title", content: "Settings — Luma Badge Studio" },
      { property: "og:description", content: "Configure the Luma calendars powering your badges." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const fetchList = useServerFn(listCalendars);
  const fetchEventStats = useServerFn(getEventLibraryStats);
  const add = useServerFn(addCalendar);
  const remove = useServerFn(removeCalendar);
  const setDefault = useServerFn(setDefaultCalendar);
  useServerFn(getLumaConfig); // kept warm — header pulls it separately
  const qc = useQueryClient();
  const navigate = useNavigate();

  const {
    data: cals,
    refetch,
    isLoading,
  } = useQuery({
    queryKey: ["luma-calendars"],
    queryFn: () => fetchList(),
  });
  const { data: eventStats } = useQuery({
    queryKey: ["event-library-stats"],
    queryFn: () => fetchEventStats(),
  });

  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // --- Import a calendar by public link (Firecrawl scrape, no API key) ---
  const runImport = useServerFn(importFromUrl);
  const [importUrl, setImportUrl] = useState("");
  const [importKind, setImportKind] = useState<"auto" | "calendar" | "event" | "profile">(
    "calendar",
  );
  const [importLimit, setImportLimit] = useState(80);
  const importMut = useMutation({
    mutationFn: () =>
      runImport({ data: { url: importUrl.trim(), kind: importKind, limit: importLimit } }),
    onSuccess: async () => {
      setImportUrl("");
      await refetch();
      qc.invalidateQueries({ queryKey: ["luma-events"] });
      qc.invalidateQueries({ queryKey: ["luma-config"] });
      qc.invalidateQueries({ queryKey: ["event-library-stats"] });
    },
  });

  // --- External API tokens ---
  const fetchTokens = useServerFn(listApiTokens);
  const mkToken = useServerFn(createApiToken);
  const rmToken = useServerFn(revokeApiToken);
  const { data: tokens, refetch: refetchTokens } = useQuery({
    queryKey: ["api-tokens"],
    queryFn: () => fetchTokens(),
  });
  const [tokenName, setTokenName] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenErr, setTokenErr] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fetchSyncSources = useServerFn(listSyncSources);
  const runSyncAll = useServerFn(syncAllSources);
  const runSyncOne = useServerFn(syncOneSource);
  const runQueue = useServerFn(processSyncQueue);
  const runBulkImport = useServerFn(importBulkSources);
  const [bulkText, setBulkText] = useState("");
  const {
    data: syncSources,
    refetch: refetchSyncSources,
    isLoading: syncSourcesLoading,
  } = useQuery({
    queryKey: ["sync-sources"],
    queryFn: () => fetchSyncSources(),
    refetchInterval: (query) =>
      query.state.data?.some((source) => ["queued", "running"].includes(source.sync_status))
        ? 5000
        : false,
  });
  const syncMut = useMutation({
    mutationFn: async (sourceId?: string) => {
      if (sourceId) return runSyncOne({ data: { sourceId } });
      const result = await runSyncAll();
      await runQueue();
      return result;
    },
    onSuccess: () => {
      refetchSyncSources();
      qc.invalidateQueries({ queryKey: ["luma-events"] });
      qc.invalidateQueries({ queryKey: ["luma-calendars"] });
      qc.invalidateQueries({ queryKey: ["event-library-stats"] });
    },
  });
  useEffect(() => {
    if (!syncSources?.some((source) => source.sync_status === "queued")) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      await runQueue();
      if (cancelled) return;
      await refetchSyncSources();
      qc.invalidateQueries({ queryKey: ["luma-calendars"] });
      qc.invalidateQueries({ queryKey: ["luma-events"] });
      qc.invalidateQueries({ queryKey: ["event-library-stats"] });
    }, 6000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [qc, refetchSyncSources, runQueue, syncSources]);
  const bulkMut = useMutation({
    mutationFn: () => runBulkImport({ data: { text: bulkText } }),
    onSuccess: () => {
      setBulkText("");
      refetchSyncSources();
    },
  });
  const apiOrigin = typeof window !== "undefined" ? window.location.origin : "";

  async function onCreateToken() {
    if (!tokenName.trim()) return;
    setTokenBusy(true);
    setTokenErr(null);
    setNewToken(null);
    try {
      const res = await mkToken({ data: { name: tokenName.trim() } });
      setNewToken(res.token);
      setTokenName("");
      await refetchTokens();
    } catch (e) {
      setTokenErr((e as Error).message);
    } finally {
      setTokenBusy(false);
    }
  }

  async function onRevokeToken(id: string, name: string) {
    if (!confirm(`Revoke "${name}"? Any system using it will stop working immediately.`)) return;
    setTokenBusy(true);
    setTokenErr(null);
    try {
      await rmToken({ data: { id } });
      await refetchTokens();
    } catch (e) {
      setTokenErr((e as Error).message);
    } finally {
      setTokenBusy(false);
    }
  }

  async function onCopyToken() {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function onAdd() {
    if (!apiKey.trim()) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await add({ data: { apiKey: apiKey.trim() } });
      setOk(`Connected to ${res.name}`);
      setApiKey("");
      await refetch();
      qc.invalidateQueries({ queryKey: ["luma-config"] });
      qc.invalidateQueries({ queryKey: ["luma-events"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(id: string, name: string) {
    if (!confirm(`Remove ${name}? Your API key for this calendar will be deleted.`)) return;
    setBusy(true);
    setError(null);
    try {
      await remove({ data: { id } });
      await refetch();
      qc.invalidateQueries();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onSetDefault(id: string) {
    setBusy(true);
    try {
      await setDefault({ data: { id } });
      await refetch();
      qc.invalidateQueries({ queryKey: ["luma-config"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const configured = (cals?.length ?? 0) > 0;

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
        · Settings
      </div>
      <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">Calendars</h1>
      <p className="mt-2 max-w-lg text-sm text-muted-foreground">
        Conecta uno o más calendarios de Luma. Cada API key se guarda cifrada (AES-256-GCM) y atada
        a tu cuenta. Consíguelas en{" "}
        <a
          href="https://docs.lu.ma/reference/getting-started-with-your-api"
          target="_blank"
          rel="noreferrer"
          className="text-accent underline underline-offset-4"
        >
          docs.lu.ma
        </a>
        .
      </p>

      <section className="mt-8 grid grid-cols-3 overflow-hidden rounded-xl border border-hairline bg-surface/60">
        {[
          ["Total", eventStats?.total ?? 0],
          ["Upcoming", eventStats?.upcoming ?? 0],
          ["Past", eventStats?.past ?? 0],
        ].map(([label, value]) => (
          <div
            key={label}
            className="border-r border-hairline px-4 py-4 text-center last:border-r-0"
          >
            <div className="font-display text-2xl font-semibold tabular-nums">{value}</div>
            <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
              {label}
            </div>
          </div>
        ))}
        {(eventStats?.unknown ?? 0) > 0 && (
          <div className="col-span-3 border-t border-hairline px-3 py-2 text-center font-mono text-[9px] text-muted-foreground">
            {eventStats?.unknown} events without a known date
          </div>
        )}
      </section>

      <section className="mt-8 border-y border-hairline py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              Curated library · {syncSources?.length ?? 0} sources
            </div>
            <h2 className="mt-1 font-display text-xl font-semibold">Persistent sync</h2>
          </div>
          <button
            onClick={() => syncMut.mutate(undefined)}
            disabled={syncMut.isPending || syncSourcesLoading}
            className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40"
          >
            {syncMut.isPending ? "Queueing…" : "Sync all"}
          </button>
        </div>

        <div className="mt-4 max-h-96 divide-y divide-hairline overflow-y-auto border-y border-hairline">
          {syncSources?.map((source) => (
            <div
              key={source.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {source.curated_name ?? source.calendar_name}
                </div>
                <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                  {source.source_kind} · {source.imported_count}/{source.discovered_count} events ·{" "}
                  {source.sync_status}
                </div>
                {source.sync_error && (
                  <div className="mt-1 truncate text-[11px] text-destructive">
                    {source.sync_error}
                  </div>
                )}
              </div>
              <button
                onClick={() => syncMut.mutate(source.id)}
                disabled={syncMut.isPending || source.sync_status === "running"}
                className="rounded-md border border-hairline px-3 py-1.5 text-[11px] font-semibold disabled:opacity-40"
              >
                {source.sync_status === "failed" ? "Retry" : "Sync"}
              </button>
            </div>
          ))}
        </div>

        <label className="mt-6 block font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Bulk import · Name — URL, raw URLs, or Markdown table
        </label>
        <textarea
          value={bulkText}
          onChange={(event) => setBulkText(event.target.value)}
          placeholder={"Hack0 Community — https://luma.com/hack0\nhttps://luma.com/user/theveller"}
          className="mt-2 min-h-28 w-full resize-y rounded-md border border-hairline bg-background p-3 font-mono text-xs focus:border-accent focus:outline-none"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={() => bulkMut.mutate()}
            disabled={bulkMut.isPending || !bulkText.trim()}
            className="rounded-md border border-hairline px-4 py-2 text-xs font-semibold disabled:opacity-40"
          >
            {bulkMut.isPending ? "Importing…" : "Import and queue"}
          </button>
          {bulkMut.isSuccess && (
            <span className="text-xs text-emerald-400">Queued {bulkMut.data.imported} sources</span>
          )}
          {bulkMut.isError && (
            <span className="text-xs text-destructive">{bulkMut.error.message}</span>
          )}
        </div>
      </section>

      <div className="mt-8 rounded-2xl border border-hairline bg-surface/70 p-6">
        <div className="flex items-baseline justify-between">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            Connected calendars · {cals?.length ?? 0}
          </div>
          {configured && (
            <button
              onClick={() => navigate({ to: "/events" })}
              className="text-xs font-semibold text-accent hover:underline"
            >
              Browse events →
            </button>
          )}
        </div>

        {isLoading ? (
          <p className="mt-3 text-sm">Loading…</p>
        ) : !configured ? (
          <p className="mt-3 text-sm">
            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-accent align-middle" />
            No calendars yet. Add your first Luma API key below.
          </p>
        ) : (
          <CalendarOrganizer
            calendars={cals!}
            busy={busy}
            onSetDefault={onSetDefault}
            onRemove={onRemove}
            onChanged={refetch}
          />
        )}
      </div>

      <div className="mt-6 rounded-2xl border border-hairline bg-surface/70 p-6">
        <label className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
          {configured ? "Add another calendar" : "Paste your Luma API key"}
        </label>
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          type="password"
          placeholder="secret-xxxxxxxxxxxxxxxxxxxx"
          className="mt-2 w-full rounded-xl border border-hairline bg-background px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-white/30 focus:outline-none"
        />
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={onAdd}
            disabled={busy || !apiKey.trim()}
            className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            {busy ? "Saving…" : "Add calendar"}
          </button>
          {ok && <span className="text-xs text-emerald-400">{ok}</span>}
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Validated against /calendar/get · Stored encrypted · Tied to your account
        </p>
      </div>

      {/* Import by link — no API key */}
      <div className="mt-6 rounded-2xl border border-hairline bg-surface/70 p-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
          Or · Import by link
        </div>
        <h2 className="mt-1 font-display text-xl font-semibold">No API key? Paste a link</h2>
        <p className="mt-2 max-w-lg text-sm text-muted-foreground">
          Connect a public Luma calendar, event, or host profile by URL. Public calendars use
          Luma&apos;s public data when possible; event and profile sync use Firecrawl.
        </p>

        <input
          value={importUrl}
          onChange={(e) => setImportUrl(e.target.value)}
          placeholder="https://lu.ma/…"
          disabled={importMut.isPending}
          className="mt-4 w-full rounded-xl border border-hairline bg-background px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-white/30 focus:outline-none"
        />

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Type
            </div>
            <div className="mt-1 inline-flex rounded-full border border-hairline bg-background/60 p-1 text-xs font-medium">
              {(["calendar", "event", "profile", "auto"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setImportKind(k)}
                  disabled={importMut.isPending}
                  className={
                    "rounded-full px-3 py-1 capitalize transition " +
                    (importKind === k
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
          {importKind !== "event" && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Max events
              </div>
              <input
                type="number"
                min={1}
                max={80}
                value={importLimit}
                onChange={(e) =>
                  setImportLimit(Math.max(1, Math.min(80, Number(e.target.value) || 40)))
                }
                disabled={importMut.isPending}
                className="mt-1 w-24 rounded-lg border border-hairline bg-background px-3 py-1.5 text-sm"
              />
            </div>
          )}
          <button
            onClick={() => importMut.mutate()}
            disabled={importMut.isPending || !importUrl.trim()}
            className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            {importMut.isPending ? "Importing…" : "Import link"}
          </button>
        </div>

        {importMut.isError && (
          <p className="mt-3 text-xs text-destructive">{(importMut.error as Error).message}</p>
        )}
        {importMut.isSuccess && importMut.data && (
          <p className="mt-3 text-xs text-emerald-400">
            Imported {importMut.data.imported} event
            {importMut.data.imported === 1 ? "" : "s"} into {importMut.data.calendarName}.
          </p>
        )}
      </div>

      {/* External API tokens */}
      <div className="mt-6 rounded-2xl border border-hairline bg-surface/70 p-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
          External API · Tokens · {tokens?.length ?? 0}
        </div>
        <h2 className="mt-1 font-display text-xl font-semibold">Calendar router API</h2>
        <p className="mt-2 max-w-lg text-sm text-muted-foreground">
          Pull routed Luma events into another app. The API combines connected and imported
          calendars, tags every event with its source, and supports calendar filters, ISO date
          ranges, and cursor pagination.
        </p>

        {newToken && (
          <div className="mt-4 rounded-xl border border-accent/40 bg-accent/5 p-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
              Copy now — shown only once
            </div>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-hairline bg-background px-3 py-2 font-mono text-xs">
                {newToken}
              </code>
              <button
                onClick={onCopyToken}
                className="shrink-0 rounded-full border border-hairline px-3 py-2 text-[11px] font-semibold hover:bg-surface"
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
          </div>
        )}

        {(tokens?.length ?? 0) > 0 && (
          <ul className="mt-4 space-y-2">
            {tokens!.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-3 rounded-xl border border-hairline bg-background/50 p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-display text-sm font-semibold">{t.name}</span>
                    {t.revokedAt && (
                      <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-destructive">
                        revoked
                      </span>
                    )}
                  </div>
                  <div className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {t.prefix}… ·{" "}
                    {t.lastUsedAt ? `used ${t.lastUsedAt.slice(0, 10)}` : "never used"}
                  </div>
                </div>
                {!t.revokedAt && (
                  <button
                    onClick={() => onRevokeToken(t.id, t.name)}
                    disabled={tokenBusy}
                    className="shrink-0 rounded-full border border-destructive/40 px-3 py-1 text-[11px] font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-40"
                  >
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex items-center gap-3">
          <input
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            placeholder="Token name (e.g. n8n workflow)"
            className="min-w-0 flex-1 rounded-xl border border-hairline bg-background px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-white/30 focus:outline-none"
          />
          <button
            onClick={onCreateToken}
            disabled={tokenBusy || !tokenName.trim()}
            className="shrink-0 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            {tokenBusy ? "…" : "Create token"}
          </button>
        </div>
        {tokenErr && <p className="mt-2 text-xs text-destructive">{tokenErr}</p>}

        <div className="mt-5 overflow-x-auto rounded-xl border border-hairline bg-background/60 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
          <div className="text-foreground">GET {apiOrigin}/api/v1/events?calendar=all</div>
          <div className="text-foreground">GET {apiOrigin}/api/v1/calendars</div>
          <div className="mt-2 whitespace-pre">
            {`curl -H "Authorization: Bearer luma_sk_..." \\
  "${apiOrigin}/api/v1/events?calendar=all&from=2026-07-01T00:00:00Z&limit=50"`}
          </div>
          <div className="mt-2">
            Params: calendar, from, to, limit, cursor. Full integration guide: docs/api.md
          </div>
        </div>
      </div>
    </div>
  );
}

function CalendarOrganizer({
  calendars,
  busy,
  onSetDefault,
  onRemove,
  onChanged,
}: {
  calendars: UserCalendarDTO[];
  busy: boolean;
  onSetDefault: (id: string) => Promise<void>;
  onRemove: (id: string, name: string) => Promise<void>;
  onChanged: () => Promise<unknown>;
}) {
  const qc = useQueryClient();
  const fetchGroups = useServerFn(listCalendarGroups);
  const createGroup = useServerFn(createCalendarGroup);
  const deleteGroup = useServerFn(deleteCalendarGroup);
  const saveOrganization = useServerFn(saveCalendarOrganization);
  const acceptSuggestion = useServerFn(acceptCalendarGroupSuggestion);
  const { data: groups = [], refetch: refetchGroups } = useQuery({
    queryKey: ["calendar-groups"],
    queryFn: () => fetchGroups(),
  });
  const [groupName, setGroupName] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    await Promise.all([onChanged(), refetchGroups()]);
    qc.invalidateQueries({ queryKey: ["luma-calendars"] });
  }

  async function addGroup() {
    if (!groupName.trim()) return;
    setSaving(true);
    try {
      await createGroup({ data: { name: groupName.trim() } });
      setGroupName("");
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function persist(next: UserCalendarDTO[]) {
    setSaving(true);
    try {
      await saveOrganization({
        data: {
          groupIds: groups.map((group) => group.id),
          calendars: next.map((calendar) => ({
            id: calendar.id,
            groupId: calendar.groupId,
            order: next
              .filter((item) => item.groupId === calendar.groupId)
              .findIndex((item) => item.id === calendar.id),
          })),
        },
      });
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function moveCalendar(calendarId: string, groupId: string | null, beforeId?: string) {
    const moving = calendars.find((calendar) => calendar.id === calendarId);
    if (!moving) return;
    const rest = calendars.filter((calendar) => calendar.id !== calendarId);
    const moved = { ...moving, groupId };
    if (!beforeId) {
      let lastInGroup = -1;
      for (let index = rest.length - 1; index >= 0; index--) {
        if (rest[index].groupId === groupId) {
          lastInGroup = index;
          break;
        }
      }
      rest.splice(lastInGroup + 1, 0, moved);
    } else {
      const target = rest.findIndex((calendar) => calendar.id === beforeId);
      rest.splice(target < 0 ? rest.length : target, 0, moved);
    }
    await persist(rest);
  }

  const buckets = [
    ...groups.map((group) => ({
      id: group.id as string | null,
      name: group.name,
      calendars: calendars.filter((calendar) => calendar.groupId === group.id),
    })),
    {
      id: null,
      name: "Ungrouped",
      calendars: calendars.filter((calendar) => !calendar.groupId),
    },
  ];

  return (
    <div className="mt-4">
      <div className="flex gap-2">
        <input
          value={groupName}
          onChange={(event) => setGroupName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") addGroup();
          }}
          placeholder="New group"
          className="min-w-0 flex-1 rounded-md border border-hairline bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />
        <button
          onClick={addGroup}
          disabled={saving || !groupName.trim()}
          className="inline-flex size-9 items-center justify-center rounded-md border border-hairline disabled:opacity-40"
          title="Create group"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <div className="mt-4 space-y-5">
        {buckets.map((bucket) => (
          <section
            key={bucket.id ?? "ungrouped"}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (draggedId) moveCalendar(draggedId, bucket.id);
              setDraggedId(null);
            }}
          >
            <div className="flex items-center justify-between border-b border-hairline pb-2">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {bucket.name} · {bucket.calendars.length}
              </div>
              {bucket.id && (
                <button
                  onClick={async () => {
                    await deleteGroup({ data: { id: bucket.id! } });
                    await refresh();
                  }}
                  className="inline-flex size-7 items-center justify-center text-muted-foreground hover:text-destructive"
                  title={`Delete ${bucket.name}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
            <div className="divide-y divide-hairline">
              {bucket.calendars.map((calendar) => (
                <div
                  key={calendar.id}
                  draggable
                  onDragStart={() => setDraggedId(calendar.id)}
                  onDragEnd={() => setDraggedId(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.stopPropagation();
                    if (draggedId && draggedId !== calendar.id) {
                      moveCalendar(draggedId, bucket.id, calendar.id);
                    }
                    setDraggedId(null);
                  }}
                  className="grid grid-cols-[auto_40px_minmax(0,1fr)] items-center gap-2 py-3 sm:grid-cols-[auto_40px_minmax(0,1fr)_auto]"
                >
                  <GripVertical
                    className="size-4 cursor-grab text-muted-foreground"
                    aria-label={`Drag ${calendar.name}`}
                  />
                  {calendar.avatarUrl ? (
                    <img
                      src={calendar.avatarUrl}
                      alt=""
                      className="size-10 rounded-md border border-hairline object-cover"
                    />
                  ) : (
                    <div className="grid size-10 place-items-center rounded-md bg-surface-2 text-xs font-semibold">
                      {(calendar.name[0] ?? "?").toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{calendar.name}</span>
                      {calendar.isDefault && (
                        <span className="font-mono text-[9px] uppercase text-accent">default</span>
                      )}
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {calendar.eventCount > 0
                        ? `${calendar.eventCount} events`
                        : "No published events"}{" "}
                      · {calendar.syncStatus}
                    </div>
                    {calendar.suggestedGroupName && !calendar.groupId && (
                      <button
                        onClick={async () => {
                          await acceptSuggestion({ data: { calendarId: calendar.id } });
                          await refresh();
                        }}
                        className="mt-1 text-[11px] font-medium text-accent hover:underline"
                        title={calendar.suggestedGroupReason ?? undefined}
                      >
                        Move to {calendar.suggestedGroupName}
                      </button>
                    )}
                  </div>
                  <div className="col-span-3 flex items-center justify-end gap-1 sm:col-span-1">
                    <select
                      value={calendar.groupId ?? ""}
                      onChange={(event) => moveCalendar(calendar.id, event.target.value || null)}
                      className="h-8 max-w-32 rounded-md border border-hairline bg-background px-2 text-[11px]"
                      aria-label={`Group for ${calendar.name}`}
                    >
                      <option value="">Ungrouped</option>
                      {groups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    </select>
                    {!calendar.isDefault && (
                      <button
                        onClick={() => onSetDefault(calendar.id)}
                        disabled={busy || saving}
                        className="h-8 rounded-md border border-hairline px-2 text-[11px] font-semibold disabled:opacity-40"
                      >
                        Default
                      </button>
                    )}
                    <button
                      onClick={() => onRemove(calendar.id, calendar.name)}
                      disabled={busy || saving}
                      className="inline-flex size-8 items-center justify-center text-muted-foreground hover:text-destructive disabled:opacity-40"
                      title={`Remove ${calendar.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {bucket.calendars.length === 0 && (
                <div className="py-4 text-xs text-muted-foreground">Drop calendars here.</div>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
