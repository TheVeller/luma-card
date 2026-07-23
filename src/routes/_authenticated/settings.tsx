import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deleteLumaKey, getLumaConfig, saveLumaKey } from "@/lib/user-luma-key.functions";

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

  async function onSave() {
    if (!apiKey.trim()) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await save({ data: { apiKey: apiKey.trim() } });
      setOk(`Conectado a ${res.calendar?.name ?? "your calendar"}`);
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

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <div className="font-mono text-xs tracking-[0.24em]" style={{ color: "rgba(23,21,15,0.55)" }}>
        · SETTINGS
      </div>
      <h1 className="mt-1 text-4xl font-black">Luma API key</h1>
      <p className="mt-2 max-w-lg text-sm" style={{ color: "rgba(23,21,15,0.7)" }}>
        Guardamos tu key cifrada (AES-256-GCM) atada a tu cuenta. Solo tú puedes leerla. Consíguela en{" "}
        <a
          href="https://docs.lu.ma/reference/getting-started-with-your-api"
          target="_blank"
          rel="noreferrer"
          className="underline"
          style={{ color: "#2970ef" }}
        >
          docs.lu.ma
        </a>
        .
      </p>

      <div className="mt-8 rounded-lg border-2 bg-[#f2efe6] p-6" style={{ borderColor: "rgba(23,21,15,0.16)" }}>
        <div className="font-mono text-xs tracking-[0.24em]">STATUS</div>
        {isLoading ? (
          <p className="mt-3 text-sm">Checking…</p>
        ) : config?.configured ? (
          <div className="mt-3">
            <div className="flex items-center gap-3">
              {config.calendar?.avatarUrl ? (
                <img
                  src={config.calendar.avatarUrl}
                  alt=""
                  className="h-12 w-12 rounded-md border object-cover"
                  style={{ borderColor: "rgba(23,21,15,0.16)" }}
                />
              ) : null}
              <div>
                <div className="text-lg font-black">{config.calendar?.name}</div>
                {config.calendar?.url && (
                  <a
                    href={config.calendar.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[10px] tracking-[0.2em] underline"
                    style={{ color: "rgba(23,21,15,0.55)" }}
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
                className="rounded-md bg-[#17150f] px-4 py-2 text-sm font-semibold text-[#f2efe6]"
              >
                Browse events →
              </button>
              <button
                onClick={onRemove}
                disabled={busy}
                className="rounded-md border-2 border-red-600 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-40"
              >
                Remove key
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500 align-middle" />{" "}
            No key configured yet.
          </p>
        )}
      </div>

      <div className="mt-6 rounded-lg border-2 bg-[#f2efe6] p-6" style={{ borderColor: "rgba(23,21,15,0.16)" }}>
        <label className="font-mono text-xs tracking-[0.24em]">
          {config?.configured ? "REPLACE KEY" : "PASTE YOUR LUMA API KEY"}
        </label>
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          type="password"
          placeholder="secret-xxxxxxxxxxxxxxxxxxxx"
          className="mt-1 w-full rounded-md border-2 bg-white px-4 py-3 font-mono text-sm focus:outline-none"
          style={{ borderColor: "rgba(23,21,15,0.24)" }}
        />
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={onSave}
            disabled={busy || !apiKey.trim()}
            className="rounded-md bg-[#17150f] px-4 py-2 text-sm font-semibold text-[#f2efe6] disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save & validate"}
          </button>
          {ok && <span className="text-xs text-green-700">{ok}</span>}
          {error && <span className="text-xs text-red-700">{error}</span>}
        </div>
        <p className="mt-4 font-mono text-[10px] tracking-[0.2em]" style={{ color: "rgba(23,21,15,0.55)" }}>
          VALIDATED AGAINST /CALENDAR/GET · STORED ENCRYPTED · TIED TO YOUR ACCOUNT
        </p>
      </div>
    </div>
  );
}
