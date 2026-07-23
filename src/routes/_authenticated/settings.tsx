import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deleteLumaKey, getLumaConfig, saveLumaKey } from "@/lib/user-luma-key.functions";
import { listEvents } from "@/lib/luma.functions";
import { analyzeEventArt } from "@/lib/style-analyze.functions";
import { seedHistoricalBadges, type SeedProgress } from "@/lib/seed-history";
import { supabase } from "@/integrations/supabase/client";

const ADMIN_EMAIL = "ivelasquezfr@gmail.com";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Luma Badge Studio" },
      { name: "description", content: "Save your Luma API key to enable event badges." },
      { property: "og:title", content: "Settings — Luma Badge Studio" },
      { property: "og:description", content: "Configure your Luma calendar API key." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const fetchConfig = useServerFn(getLumaConfig);
  const fetchEvents = useServerFn(listEvents);
  const analyze = useServerFn(analyzeEventArt);
  const save = useServerFn(saveLumaKey);
  const remove = useServerFn(deleteLumaKey);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: config, refetch, isLoading } = useQuery({
    queryKey: ["luma-config"],
    queryFn: () => fetchConfig(),
  });

  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [userEmail, setUserEmail] = useState<string | null>(null);
  useState(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null));
    return undefined;
  });

  const isAdmin = userEmail === ADMIN_EMAIL;
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedLog, setSeedLog] = useState<string[]>([]);

  async function onSave() {
    if (!apiKey.trim()) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await save({ data: { apiKey: apiKey.trim() } });
      setOk(`Connected to ${res.calendar?.name ?? "your calendar"}`);
      setApiKey("");
      await refetch();
      qc.invalidateQueries();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    if (!confirm("Remove your saved Luma API key?")) return;
    setBusy(true);
    setError(null);
    try {
      await remove();
      await refetch();
      qc.invalidateQueries();
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

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
        · Settings
      </div>
      <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">Luma API key</h1>
      <p className="mt-2 max-w-lg text-sm text-muted-foreground">
        Guardamos tu key cifrada (AES-256-GCM) atada a tu cuenta. Solo tú puedes leerla. Consíguela en{" "}
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
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
          Status
        </div>
        {isLoading ? (
          <p className="mt-3 text-sm">Checking…</p>
        ) : config?.configured ? (
          <div className="mt-3">
            <div className="flex items-center gap-3">
              {config.calendar?.avatarUrl ? (
                <img
                  src={config.calendar.avatarUrl}
                  alt=""
                  className="h-12 w-12 rounded-lg border border-hairline object-cover"
                />
              ) : null}
              <div>
                <div className="font-display text-lg font-semibold">{config.calendar?.name}</div>
                {config.calendar?.url && (
                  <a
                    href={config.calendar.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground underline-offset-4 hover:underline"
                  >
                    {new URL(config.calendar.url).hostname}
                    {new URL(config.calendar.url).pathname}
                  </a>
                )}
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => navigate({ to: "/events" })}
                className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                Browse events →
              </button>
              <button
                onClick={onRemove}
                disabled={busy}
                className="rounded-full border border-destructive/40 px-4 py-2 text-sm font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-40"
              >
                Remove key
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm">
            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-accent align-middle" />
            No key configured yet.
          </p>
        )}
      </div>

      <div className="mt-6 rounded-2xl border border-hairline bg-surface/70 p-6">
        <label className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
          {config?.configured ? "Replace key" : "Paste your Luma API key"}
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
            onClick={onSave}
            disabled={busy || !apiKey.trim()}
            className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save & validate"}
          </button>
          {ok && <span className="text-xs text-emerald-400">{ok}</span>}
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Validated against /calendar/get · Stored encrypted · Tied to your account
        </p>
      </div>

      {isAdmin && (
        <div className="mt-6 rounded-2xl border border-accent/30 bg-accent/5 p-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">
            · Admin · {userEmail}
          </div>
          <h2 className="mt-1 font-display text-xl font-semibold">Seed historical gallery</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Renders a placeholder badge (<b>Ignacio Velásquez</b> · Founder, GPT Chain) for each
            matched historical event: Code Brew, v0 Zero-to-Agent, GTM Hackathon, Cursor Meetup,
            Cursor Buildathon SV, Code Brew SV, Vibe Code Fest. Idempotent — skips events that
            already have your placeholder.
          </p>
          <button
            onClick={onSeed}
            disabled={seedBusy || !config?.configured}
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
