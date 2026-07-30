import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { EventSourceImporter } from "@/components/EventSourceImporter";
import { getLumaConfig } from "@/lib/user-luma-key.functions";
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
import {
  connectProvider,
  listProviderConnections,
  removeProviderConnection,
} from "@/lib/provider-connections.functions";
import { assignCalendarBrandKit, listBrandKits, saveBrandKit } from "@/lib/brand-kits.functions";
import { DEFAULT_STYLE_SPEC } from "@/lib/style-spec";
import { CLASSIC_BADGE_DOC } from "@/lib/badge-doc/presets/classic";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

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

  const [statsOpen, setStatsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

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
    mutationFn: async ({
      sourceId,
      scope = "auto",
    }: {
      sourceId?: string;
      scope?: "auto" | "full" | "maintenance";
    }) => {
      if (sourceId) return runSyncOne({ data: { sourceId, scope } });
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
  const apiIsPreview =
    typeof window !== "undefined" && window.location.hostname.endsWith(".lovableproject.com");
  const fetchProviderConnections = useServerFn(listProviderConnections);
  const addProviderConnection = useServerFn(connectProvider);
  const deleteProviderConnection = useServerFn(removeProviderConnection);
  const { data: providerConnections = [], refetch: refetchProviderConnections } = useQuery({
    queryKey: ["provider-connections"],
    queryFn: () => fetchProviderConnections(),
  });
  const [provider, setProvider] = useState<"eventbrite" | "meetup">("eventbrite");
  const [providerUrl, setProviderUrl] = useState("");
  const [providerToken, setProviderToken] = useState("");
  const [providerRefreshToken, setProviderRefreshToken] = useState("");
  const providerMut = useMutation({
    mutationFn: () =>
      addProviderConnection({
        data: {
          provider,
          sourceUrl: providerUrl.trim(),
          accessToken: providerToken.trim(),
          refreshToken: providerRefreshToken.trim() || undefined,
          syncAllEvents: true,
        },
      }),
    onSuccess: async () => {
      setProviderUrl("");
      setProviderToken("");
      setProviderRefreshToken("");
      await Promise.all([refetchProviderConnections(), refetch(), refetchSyncSources()]);
      qc.invalidateQueries({ queryKey: ["luma-events"] });
      qc.invalidateQueries({ queryKey: ["event-library-stats"] });
    },
  });
  const fetchBrandKits = useServerFn(listBrandKits);
  const createBrandKit = useServerFn(saveBrandKit);
  const assignBrandKit = useServerFn(assignCalendarBrandKit);
  const { data: brandKits = [], refetch: refetchBrandKits } = useQuery({
    queryKey: ["brand-kits"],
    queryFn: () => fetchBrandKits(),
  });
  const [brandKitName, setBrandKitName] = useState("");
  const brandKitMut = useMutation({
    mutationFn: () =>
      createBrandKit({
        data: {
          name: brandKitName.trim(),
          styleSpec: DEFAULT_STYLE_SPEC,
          badgeDoc: CLASSIC_BADGE_DOC,
          logos: [],
          isDefault: brandKits.length === 0,
        },
      }),
    onSuccess: async () => {
      setBrandKitName("");
      await refetchBrandKits();
    },
  });

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
  const lumaConnectedCount =
    cals?.filter((calendar) => calendar.provider === "luma" && calendar.ownership === "connected")
      .length ?? 0;
  const meetupSourceCount = cals?.filter((calendar) => calendar.provider === "meetup").length ?? 0;

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

      <section className="mt-8 overflow-hidden rounded-xl border border-hairline bg-surface/60">
        <div className="grid grid-cols-2 sm:grid-cols-4">
          {(
            [
              ["Calendars", eventStats?.library.activeCalendars ?? 0],
              ["Events", eventStats?.total ?? 0],
              ["Upcoming", eventStats?.upcoming ?? 0],
              ["Past", eventStats?.past ?? 0],
            ] as const
          ).map(([label, value]) => (
            <div
              key={label}
              className="border-b border-r border-hairline px-4 py-4 text-center last:border-r-0 sm:border-b-0"
            >
              <div className="font-display text-2xl font-semibold tabular-nums">{value}</div>
              <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                {label}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setStatsOpen((open) => !open)}
          className="w-full border-t border-hairline px-4 py-2 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          {statsOpen ? "Hide details" : "Details"}
        </button>

        {statsOpen && (
          <div className="grid gap-x-6 gap-y-1 border-t border-hairline px-4 py-3 font-mono text-[10px] text-muted-foreground sm:grid-cols-2">
            <div className="space-y-1">
              <div className="uppercase tracking-[0.18em] text-foreground">Calendars</div>
              {(
                [
                  ["Luma connected", eventStats?.library.lumaConnected ?? 0],
                  ["Luma external", eventStats?.library.lumaExternal ?? 0],
                  ["Meetup groups", eventStats?.library.meetupExternal ?? 0],
                  ["Other providers", eventStats?.library.otherProviders ?? 0],
                  ["Duplicates collapsed", eventStats?.library.duplicateCalendars ?? 0],
                  ["Merged / hidden", eventStats?.library.mergedHidden ?? 0],
                  ["With sync errors", eventStats?.library.erroredSources ?? 0],
                  ["Rows stored", eventStats?.library.totalCalendars ?? 0],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-2">
                  <span className="uppercase tracking-[0.14em]">{label}</span>
                  <span className="tabular-nums text-foreground">{value}</span>
                </div>
              ))}
            </div>
            <div className="space-y-1">
              <div className="uppercase tracking-[0.18em] text-foreground">Events</div>
              {(
                [
                  ["Luma events", eventStats?.providers?.luma?.total ?? 0],
                  ["Luma upcoming", eventStats?.providers?.luma?.upcoming ?? 0],
                  ["Meetup events", eventStats?.providers?.meetup?.total ?? 0],
                  ["Meetup upcoming", eventStats?.providers?.meetup?.upcoming ?? 0],
                  ["Without a date", eventStats?.unknown ?? 0],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-2">
                  <span className="uppercase tracking-[0.14em]">{label}</span>
                  <span className="tabular-nums text-foreground">{value}</span>
                </div>
              ))}
              <div className="pt-1 text-[9px] leading-relaxed">
                Events are deduplicated across calendars, so provider counts can add up to more than
                the global total.
              </div>
            </div>
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
            onClick={() => syncMut.mutate({})}
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
                  {source.provider} · {source.source_kind} · {source.imported_count}/
                  {source.discovered_count} events · {source.sync_status}
                </div>
                {source.sync_error && (
                  <div className="mt-1 truncate text-[11px] text-destructive">
                    {source.sync_error}
                  </div>
                )}
              </div>
              <button
                onClick={() => syncMut.mutate({ sourceId: source.id })}
                disabled={syncMut.isPending || source.sync_status === "running"}
                className="rounded-md border border-hairline px-3 py-1.5 text-[11px] font-semibold disabled:opacity-40"
              >
                {source.sync_status === "failed" ? "Retry" : "Sync"}
              </button>
            </div>
          ))}
        </div>

        <label className="mt-6 block font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Bulk import · Luma or Meetup groups · text, Markdown, or CSV
        </label>
        <textarea
          value={bulkText}
          onChange={(event) => setBulkText(event.target.value)}
          placeholder={
            "Hack0 Community — https://luma.com/hack0\nAWS User Group Peru — https://www.meetup.com/awsperu"
          }
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
          {bulkMut.isError && (
            <span className="text-xs text-destructive">{bulkMut.error.message}</span>
          )}
        </div>
        {bulkMut.isSuccess && (
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-hairline bg-surface/60 p-3 font-mono text-[10px] text-muted-foreground sm:grid-cols-3">
            {[
              ["Rows processed", bulkMut.data.report.rowsProcessed],
              ["Unique URLs", bulkMut.data.report.uniqueUrls],
              ["Duplicates ignored", bulkMut.data.report.duplicatesIgnored],
              ["Invalid rows", bulkMut.data.report.invalidRows],
              ["Sources created", bulkMut.data.created],
              ["Already existing", bulkMut.data.existing],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-2">
                <span className="uppercase tracking-[0.14em]">{label}</span>
                <span className="tabular-nums text-foreground">{value}</span>
              </div>
            ))}
            {bulkMut.data.failed.length > 0 && (
              <div className="col-span-full text-destructive">
                {bulkMut.data.failed.length} sources failed:{" "}
                {bulkMut.data.failed
                  .slice(0, 3)
                  .map((item) => `${item.url} (${item.error})`)
                  .join(", ")}
              </div>
            )}
          </div>
        )}
      </section>

      <div className="mt-8 rounded-2xl border border-hairline bg-surface/70 p-6">
        <div className="flex items-baseline justify-between">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            Calendars · {cals?.length ?? 0} ({lumaConnectedCount} Luma conectados ·{" "}
            {meetupSourceCount} Meetup)
          </div>
          {configured && (
            <button
              onClick={() =>
                navigate({ to: "/events", search: { q: "", provider: "all", labels: [] } })
              }
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
            brandKits={brandKits}
            busy={busy}
            onSetDefault={onSetDefault}
            onRemove={onRemove}
            onChanged={refetch}
            syncing={syncMut.isPending}
            onSync={async (calendarId, scope) => {
              await syncMut.mutateAsync({ sourceId: calendarId, scope });
            }}
            onAssignBrandKit={async (calendarId, brandKitId) => {
              await assignBrandKit({ data: { calendarId, brandKitId } });
              await refetch();
            }}
          />
        )}
      </div>

      <Collapsible defaultOpen={!configured} className="mt-6">
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-xl border border-hairline bg-surface/60 px-4 py-3 text-left">
          <span>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Connect calendars
            </span>
            <span className="ml-3 text-xs text-muted-foreground">
              {configured ? `${cals?.length ?? 0} sources connected` : "Add your first source"}
            </span>
          </span>
          <span className="text-xs text-muted-foreground">Expand</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-3 rounded-2xl border border-hairline bg-surface/70 p-6">
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
              Import a public Luma, Eventbrite, or Meetup calendar, organizer, group, or event URL.
            </p>
            <EventSourceImporter
              compact
              className="mt-4"
              onImported={async () => {
                await refetch();
                await refetchSyncSources();
              }}
            />
          </div>

          <div className="mt-6 rounded-2xl border border-hairline bg-surface/70 p-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              Event providers
            </div>
            <h2 className="mt-1 font-display text-xl font-semibold">Eventbrite and Meetup</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Public links work in the importer below. Add an organizer access token here for
              authoritative sync and to mark its events as owned.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-[130px_1fr]">
              <select
                value={provider}
                onChange={(event) => setProvider(event.target.value as "eventbrite" | "meetup")}
                className="rounded-xl border border-hairline bg-background px-3 py-2.5 text-sm"
              >
                <option value="eventbrite">Eventbrite</option>
                <option value="meetup">Meetup</option>
              </select>
              <input
                value={providerUrl}
                onChange={(event) => setProviderUrl(event.target.value)}
                placeholder={
                  provider === "eventbrite"
                    ? "Event, organizer, or organization URL"
                    : "Meetup event or group URL"
                }
                className="rounded-xl border border-hairline bg-background px-4 py-2.5 font-mono text-sm"
              />
              {provider === "meetup" && (
                <>
                  <div />
                  <input
                    value={providerRefreshToken}
                    onChange={(event) => setProviderRefreshToken(event.target.value)}
                    type="password"
                    placeholder="Meetup refresh token (optional)"
                    className="rounded-xl border border-hairline bg-background px-4 py-2.5 font-mono text-sm"
                  />
                </>
              )}
              <div />
              <input
                value={providerToken}
                onChange={(event) => setProviderToken(event.target.value)}
                type="password"
                placeholder={`${provider} access token`}
                className="rounded-xl border border-hairline bg-background px-4 py-2.5 font-mono text-sm"
              />
            </div>
            <button
              onClick={() => providerMut.mutate()}
              disabled={providerMut.isPending || !providerUrl.trim() || !providerToken.trim()}
              className="mt-3 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >
              {providerMut.isPending ? "Connecting…" : `Connect ${provider}`}
            </button>
            {providerMut.isError && (
              <p className="mt-2 text-xs text-destructive">{providerMut.error.message}</p>
            )}
            {providerConnections.length > 0 && (
              <ul className="mt-4 divide-y divide-hairline border-y border-hairline">
                {providerConnections.map((connection) => (
                  <li key={connection.id} className="flex items-center gap-3 py-3">
                    <span className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[9px] uppercase">
                      {connection.provider}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {connection.name}
                    </span>
                    <button
                      onClick={async () => {
                        await deleteProviderConnection({ data: { id: connection.id } });
                        await Promise.all([refetchProviderConnections(), refetch()]);
                      }}
                      className="text-xs text-destructive"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="mt-6 rounded-2xl border border-hairline bg-surface/70 p-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
          Design automation
        </div>
        <h2 className="mt-1 font-display text-xl font-semibold">Brand kits</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Owned calendars can prefill the badge editor with a reusable style and layout. Create a
          starter kit, then assign it beside a calendar above.
        </p>
        <div className="mt-4 flex gap-2">
          <input
            value={brandKitName}
            onChange={(event) => setBrandKitName(event.target.value)}
            placeholder="Brand kit name"
            className="min-w-0 flex-1 rounded-xl border border-hairline bg-background px-4 py-2.5 text-sm"
          />
          <button
            onClick={() => brandKitMut.mutate()}
            disabled={brandKitMut.isPending || !brandKitName.trim()}
            className="rounded-full border border-hairline px-4 py-2 text-xs font-semibold disabled:opacity-40"
          >
            Create
          </button>
        </div>
        {brandKits.length > 0 && (
          <div className="mt-3 font-mono text-[10px] text-muted-foreground">
            {brandKits.map((kit) => `${kit.name}${kit.isDefault ? " (default)" : ""}`).join(" · ")}
          </div>
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
        <div
          className={`mt-4 rounded-xl border p-3 text-xs ${
            apiIsPreview
              ? "border-amber-400/40 bg-amber-400/10 text-amber-100"
              : "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
          }`}
        >
          <div className="font-semibold">API base URL</div>
          <code className="mt-1 block break-all font-mono text-[11px]">{apiOrigin || "(deployed origin)"}</code>
          {apiIsPreview ? (
            <p className="mt-2 text-amber-100/80">
              This Lovable preview/sandbox URL may redirect external requests to the Lovable login.
              Publish with public access and use its <code>lovable.app</code> or custom-domain URL.
            </p>
          ) : (
            <p className="mt-2 text-emerald-100/80">Use this published origin in your integration.</p>
          )}
          <a
            className="mt-2 inline-block underline underline-offset-2"
            href={`${apiOrigin}/api/v1/health`}
            target="_blank"
            rel="noreferrer"
          >
            Test health endpoint →
          </a>
        </div>

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
          <div className="text-foreground">GET {apiOrigin}/api/v1/health <span className="text-muted-foreground">(public)</span></div>
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
  brandKits,
  busy,
  onSetDefault,
  onRemove,
  onChanged,
  syncing,
  onSync,
  onAssignBrandKit,
}: {
  calendars: UserCalendarDTO[];
  brandKits: Array<{ id: string; name: string }>;
  busy: boolean;
  onSetDefault: (id: string) => Promise<void>;
  onRemove: (id: string, name: string) => Promise<void>;
  onChanged: () => Promise<unknown>;
  syncing: boolean;
  onSync: (calendarId: string, scope: "auto" | "full") => Promise<void>;
  onAssignBrandKit: (calendarId: string, brandKitId: string | null) => Promise<void>;
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
          <Collapsible key={bucket.id ?? "ungrouped"} defaultOpen={bucket.calendars.length > 0}>
            <section
              key={bucket.id ?? "ungrouped"}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (draggedId) moveCalendar(draggedId, bucket.id);
                setDraggedId(null);
              }}
            >
              <CollapsibleTrigger asChild>
                <div className="flex w-full items-center justify-between border-b border-hairline pb-2 text-left">
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    {bucket.name} · {bucket.calendars.length}
                  </div>
                  {bucket.id && (
                    <button
                      onClick={async (event) => {
                        event.stopPropagation();
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
              </CollapsibleTrigger>
              <CollapsibleContent>
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
                            <span className="font-mono text-[9px] uppercase text-accent">
                              default
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <span className="rounded-full border border-hairline bg-surface-2 px-2 py-0.5 font-mono text-[9px] uppercase text-foreground">
                            {calendar.provider}
                          </span>
                          {calendar.hasApiConnection && (
                            <span
                              className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase ${
                                calendar.apiConnectionStatus === "needs_attention"
                                  ? "border-destructive/40 text-destructive"
                                  : "border-emerald-500/30 text-emerald-400"
                              }`}
                            >
                              {calendar.provider} API{" "}
                              {calendar.apiConnectionStatus === "needs_attention"
                                ? "needs attention"
                                : "connected"}
                            </span>
                          )}
                          {calendar.hasPublicLink && (
                            <span className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">
                              Public link available
                            </span>
                          )}
                          <span className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">
                            {calendar.syncStatus === "completed"
                              ? "Synced"
                              : calendar.syncStatus === "partial"
                                ? "Partial"
                                : calendar.syncStatus === "failed"
                                  ? "Sync failed"
                                  : calendar.syncStatus}
                          </span>
                        </div>
                        <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                          {calendar.eventCount > 0
                            ? `${calendar.eventCount} events`
                            : "No published events"}
                          {calendar.lastSyncedAt
                            ? ` · last success ${new Date(calendar.lastSyncedAt).toLocaleString()}`
                            : " · no successful sync yet"}
                          {calendar.lastSyncScope ? ` · ${calendar.lastSyncScope}` : ""}
                        </div>
                        {calendar.syncError && (
                          <div className="mt-1 text-[11px] text-destructive">
                            {calendar.syncError}
                          </div>
                        )}
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
                      <div className="col-span-3 flex flex-wrap items-center justify-end gap-1 sm:col-span-1">
                        <button
                          onClick={() => onSync(calendar.id, "auto")}
                          disabled={busy || saving || syncing || calendar.syncStatus === "running"}
                          className="h-8 rounded-md border border-hairline px-2 text-[11px] font-semibold disabled:opacity-40"
                          title="Sync upcoming events and the last 7 days"
                        >
                          Sync now
                        </button>
                        <button
                          onClick={() => onSync(calendar.id, "full")}
                          disabled={busy || saving || syncing || calendar.syncStatus === "running"}
                          className="h-8 rounded-md border border-hairline px-2 text-[11px] font-semibold disabled:opacity-40"
                          title="Reconcile the complete event history"
                        >
                          Full resync
                        </button>
                        {calendar.ownership === "connected" && brandKits.length > 0 && (
                          <select
                            value={calendar.brandKitId ?? ""}
                            onChange={(event) =>
                              onAssignBrandKit(calendar.id, event.target.value || null)
                            }
                            className="h-8 max-w-32 rounded-md border border-hairline bg-background px-2 text-[11px]"
                            aria-label={`Brand kit for ${calendar.name}`}
                          >
                            <option value="">Default kit</option>
                            {brandKits.map((kit) => (
                              <option key={kit.id} value={kit.id}>
                                {kit.name}
                              </option>
                            ))}
                          </select>
                        )}
                        <select
                          value={calendar.groupId ?? ""}
                          onChange={(event) =>
                            moveCalendar(calendar.id, event.target.value || null)
                          }
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
              </CollapsibleContent>
            </section>
          </Collapsible>
        ))}
      </div>
    </div>
  );
}
