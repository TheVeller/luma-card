import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getLumaConfig } from "@/lib/user-luma-key.functions";
import {
  addCalendar,
  listCalendars,
  removeCalendar,
  setDefaultCalendar,
} from "@/lib/user-luma-calendars.functions";
import { listEvents } from "@/lib/luma.functions";
import { analyzeEventArt } from "@/lib/style-analyze.functions";
import { seedHistoricalBadges, type SeedProgress } from "@/lib/seed-history";
import { listApiTokens, createApiToken, revokeApiToken } from "@/lib/api-tokens.functions";
import { supabase } from "@/integrations/supabase/client";

const ADMIN_EMAIL = "ivelasquezfr@gmail.com";

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
  const add = useServerFn(addCalendar);
  const remove = useServerFn(removeCalendar);
  const setDefault = useServerFn(setDefaultCalendar);
  const fetchEvents = useServerFn(listEvents);
  const analyze = useServerFn(analyzeEventArt);
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

  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [userEmail, setUserEmail] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null));
  }, []);

  const isAdmin = userEmail === ADMIN_EMAIL;
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedLog, setSeedLog] = useState<string[]>([]);

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

  async function onSeed() {
    setSeedBusy(true);
    setSeedLog([]);
    try {
      const events = await fetchEvents();
      await seedHistoricalBadges(events, analyze, (p: SeedProgress) => {
        setSeedLog((prev) => [...prev, formatProgress(p)]);
      });
      qc.invalidateQueries({ queryKey: ["badges"] });
    } catch (e) {
      setSeedLog((prev) => [...prev, `✗ ${(e as Error).message}`]);
    } finally {
      setSeedBusy(false);
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
          <ul className="mt-4 space-y-2">
            {cals!.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-3 rounded-xl border border-hairline bg-background/50 p-3"
              >
                {c.avatarUrl ? (
                  <img
                    src={c.avatarUrl}
                    alt=""
                    className="h-10 w-10 rounded-lg border border-hairline object-cover"
                  />
                ) : (
                  <div className="h-10 w-10 rounded-lg bg-surface-2" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-display text-sm font-semibold">{c.name}</span>
                    {c.isDefault && (
                      <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent">
                        default
                      </span>
                    )}
                  </div>
                  {c.url && (
                    <div className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      {new URL(c.url).hostname}
                      {new URL(c.url).pathname}
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  {!c.isDefault && (
                    <button
                      onClick={() => onSetDefault(c.id)}
                      disabled={busy}
                      className="rounded-full border border-hairline px-3 py-1 text-[11px] font-semibold hover:bg-surface disabled:opacity-40"
                    >
                      Set default
                    </button>
                  )}
                  <button
                    onClick={() => onRemove(c.id, c.name)}
                    disabled={busy}
                    className="rounded-full border border-destructive/40 px-3 py-1 text-[11px] font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
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

      {/* External API tokens */}
      <div className="mt-6 rounded-2xl border border-hairline bg-surface/70 p-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
          External API · Tokens · {tokens?.length ?? 0}
        </div>
        <h2 className="mt-1 font-display text-xl font-semibold">Calendar router API</h2>
        <p className="mt-2 max-w-lg text-sm text-muted-foreground">
          Pull all your calendars&apos; events — combined and tagged by source — into any other
          system. Create a token and send it as a Bearer header.
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
            curl -H &quot;Authorization: Bearer luma_sk_…&quot; \{"\n"}
            {"  "}&quot;{apiOrigin}/api/v1/events?calendar=all&amp;limit=50&quot;
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="mt-6 rounded-2xl border border-accent/30 bg-accent/5 p-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">
            · Admin · {userEmail}
          </div>
          <h2 className="mt-1 font-display text-xl font-semibold">Seed historical gallery</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Renders a placeholder badge (<b>Ignacio Velásquez</b> · Founder, GPT Chain) for each
            matched historical event. Idempotent — skips events that already have your placeholder.
          </p>
          <button
            onClick={onSeed}
            disabled={seedBusy || !configured}
            className="mt-4 rounded-full bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-40"
          >
            {seedBusy ? "Seeding…" : "Seed my historical gallery"}
          </button>
          {seedLog.length > 0 && (
            <div className="mt-4 max-h-64 overflow-y-auto rounded-xl border border-hairline bg-background/60 p-3 font-mono text-[11px] leading-relaxed">
              {seedLog.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatProgress(p: SeedProgress): string {
  switch (p.phase) {
    case "matching":
      return `matched ${p.matched}/${p.total} events`;
    case "rendering":
      return `→ [${p.index}/${p.total}] rendering "${p.eventName}"`;
    case "skipped":
      return `↷ skipped "${p.eventName}" (${p.reason})`;
    case "uploaded":
      return `✓ uploaded "${p.eventName}"`;
    case "error":
      return `✗ ${p.eventName}: ${p.message}`;
    case "done":
      return `— done · ${p.created} created · ${p.skipped} skipped`;
  }
}
