import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getAdminStatus,
  unlockAdmin,
  getAdminCatalog,
  type AdminEvent,
} from "@/lib/admin.functions";
import { getAdminToken, setAdminToken } from "@/lib/admin-token";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Event Aggregator" },
      { name: "description", content: "Global catalog of calendars and events mapped by every account." },
      { property: "og:title", content: "Admin — Event Aggregator" },
      { property: "og:description", content: "Global catalog of calendars and events mapped by every account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

const LANG: Record<string, string> = { es: "Spanish", en: "English", pt: "Portuguese", fr: "French", de: "German" };

function audienceOf(e: AdminEvent) {
  return e.languageCode ? (LANG[e.languageCode] ?? e.languageCode.toUpperCase()) : "Unknown";
}
function placeOf(e: AdminEvent) {
  if (e.isOnline) return "Remote";
  return e.region ?? e.countryCode ?? e.city ?? "Unknown";
}

function AdminPage() {
  const statusFn = useServerFn(getAdminStatus);
  const status = useQuery({ queryKey: ["admin-status"], queryFn: () => statusFn({ data: { token: getAdminToken() } }) });
  if (status.isLoading) return <Shell>Checking access…</Shell>;
  if (!status.data?.isAdmin)
    return (
      <Shell>
        <p className="text-muted-foreground">This area is only for the administrator.</p>
        <Link to="/settings" className="mt-4 inline-block text-sm underline">Back to settings</Link>
      </Shell>
    );
  if (!status.data.unlocked) return <Unlock />;
  return <Catalog />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-7xl px-6 py-10">{children}</main>;
}

function Unlock() {
  const fn = useServerFn(unlockAdmin);
  const qc = useQueryClient();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Shell>
      <form
        className="mx-auto mt-16 max-w-sm space-y-4 rounded-2xl border border-hairline bg-surface p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const r = await fn({ data: { password: pw } });
            if (r.ok) {
              setAdminToken(r.token);
              await qc.invalidateQueries({ queryKey: ["admin-status"] });
            } else toast.error("Incorrect password");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not unlock");
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1 className="text-lg font-semibold">Admin mode</h1>
        <p className="text-sm text-muted-foreground">Enter the admin password to continue.</p>
        <Input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <Button type="submit" disabled={busy || !pw} className="w-full">Unlock</Button>
      </form>
    </Shell>
  );
}

function Catalog() {
  const fn = useServerFn(getAdminCatalog);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-catalog"], queryFn: () => fn({ data: { token: getAdminToken() } }), staleTime: 60_000 });
  const [tab, setTab] = useState<"calendars" | "events">("calendars");
  const [search, setSearch] = useState("");
  const [onlyNew, setOnlyNew] = useState(false);
  const [aud, setAud] = useState("all");
  const [place, setPlace] = useState("all");

  const facets = useMemo(() => {
    const a = new Map<string, number>();
    const p = new Map<string, number>();
    for (const e of q.data?.events ?? []) {
      a.set(audienceOf(e), (a.get(audienceOf(e)) ?? 0) + 1);
      p.set(placeOf(e), (p.get(placeOf(e)) ?? 0) + 1);
    }
    const sort = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1]);
    return { aud: sort(a), place: sort(p) };
  }, [q.data]);

  const s = search.toLowerCase();
  const cals = (q.data?.calendars ?? []).filter(
    (c) => (!onlyNew || !c.followedByMe) && (!s || c.name.toLowerCase().includes(s) || c.followers.some((f) => f.includes(s))),
  );
  const evs = (q.data?.events ?? []).filter(
    (e) =>
      (aud === "all" || audienceOf(e) === aud) &&
      (place === "all" || placeOf(e) === place) &&
      (!s || e.name.toLowerCase().includes(s)),
  );

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Admin mode</p>
          <h1 className="text-2xl font-semibold">Global catalog</h1>
          {q.data && (
            <p className="text-sm text-muted-foreground">
              {q.data.users} accounts · {q.data.calendars.length} calendars ·{" "}
              {q.data.calendars.filter((c) => !c.followedByMe).length} you don't follow yet · {q.data.events.length} events
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => q.refetch()}>Refresh</Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              setAdminToken(null);
              qc.removeQueries({ queryKey: ["admin-catalog"] });
              await qc.invalidateQueries({ queryKey: ["admin-status"] });
            }}
          >
            Lock
          </Button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="calendars">Calendars</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
          </TabsList>
        </Tabs>
        <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 max-w-xs" />
        {tab === "calendars" ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
            Only ones I don't follow
          </label>
        ) : (
          <>
            <select className="h-9 rounded-md border border-hairline bg-background px-2 text-sm" value={aud} onChange={(e) => setAud(e.target.value)}>
              <option value="all">All audiences</option>
              {facets.aud.map(([k, n]) => <option key={k} value={k}>{k} ({n})</option>)}
            </select>
            <select className="h-9 rounded-md border border-hairline bg-background px-2 text-sm" value={place} onChange={(e) => setPlace(e.target.value)}>
              <option value="all">All regions</option>
              {facets.place.map(([k, n]) => <option key={k} value={k}>{k} ({n})</option>)}
            </select>
          </>
        )}
      </div>

      {q.isLoading && <p className="mt-8 text-muted-foreground">Loading catalog…</p>}
      {q.error && <p className="mt-8 text-destructive">{(q.error as Error).message}</p>}

      {tab === "calendars" && q.data && (
        <div className="mt-6 overflow-x-auto rounded-xl border border-hairline">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs text-muted-foreground">
              <tr><th className="p-3">Calendar</th><th className="p-3">Provider</th><th className="p-3">Events</th><th className="p-3">Followed by</th></tr>
            </thead>
            <tbody>
              {cals.map((c) => (
                <tr key={c.key} className="border-t border-hairline">
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      {c.avatarUrl && <img src={c.avatarUrl} alt="" className="h-6 w-6 rounded" />}
                      {c.url ? <a href={c.url} target="_blank" rel="noreferrer" className="hover:underline">{c.name}</a> : c.name}
                      {!c.followedByMe && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">New to you</span>}
                    </div>
                  </td>
                  <td className="p-3 capitalize">{c.provider}</td>
                  <td className="p-3">{c.importedCount}</td>
                  <td className="p-3 text-xs text-muted-foreground">{c.followers.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "events" && q.data && (
        <div className="mt-6 overflow-x-auto rounded-xl border border-hairline">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs text-muted-foreground">
              <tr><th className="p-3">Event</th><th className="p-3">Date</th><th className="p-3">Audience</th><th className="p-3">Region</th><th className="p-3">Contributed by</th></tr>
            </thead>
            <tbody>
              {evs.slice(0, 500).map((e) => (
                <tr key={e.key} className="border-t border-hairline">
                  <td className="p-3"><a href={e.url} target="_blank" rel="noreferrer" className="hover:underline">{e.name}</a></td>
                  <td className="p-3 whitespace-nowrap">{e.startAt ? new Date(e.startAt).toLocaleDateString() : "—"}</td>
                  <td className="p-3">{audienceOf(e)}</td>
                  <td className="p-3">{placeOf(e)}{e.city && !e.isOnline ? ` · ${e.city}` : ""}</td>
                  <td className="p-3 text-xs text-muted-foreground">{e.contributors.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {evs.length > 500 && <p className="p-3 text-xs text-muted-foreground">Showing 500 of {evs.length}. Use filters to narrow.</p>}
        </div>
      )}
    </Shell>
  );
}
