// Import a Luma calendar or event by public URL (no API key needed).
// Uses Firecrawl on the server to scrape and cache into `scraped_events`.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { importFromUrl } from "@/lib/luma-scrape.functions";

export const Route = createFileRoute("/_authenticated/import")({
  head: () => ({
    meta: [
      { title: "Import from a link — Badge Studio" },
      {
        name: "description",
        content: "Import a Luma calendar or a single event by URL — no API key required.",
      },
      { property: "og:title", content: "Import from a link" },
      {
        property: "og:description",
        content: "Turn any Luma calendar or event URL into personalized badges.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ImportPage,
});

function ImportPage() {
  const run = useServerFn(importFromUrl);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<"auto" | "calendar" | "event" | "profile">("auto");
  const [limit, setLimit] = useState(40);

  const mut = useMutation({
    mutationFn: () => run({ data: { url: url.trim(), kind, limit } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["luma-events"] });
      qc.invalidateQueries({ queryKey: ["calendars"] });
      if (res.kind === "event" && res.eventIds[0]) {
        navigate({ to: "/e/$eventId", params: { eventId: res.eventIds[0] } });
      } else {
        navigate({ to: "/events" });
      }
    },
  });

  const disabled = !url.trim() || mut.isPending;

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
        · Import
      </div>
      <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">
        Import from a link
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Paste a Luma calendar URL (like <code>https://lu.ma/hack0</code>) to import every event, or
        a single event URL (like <code>https://lu.ma/abcd1234</code>) to import just that one. Host
        profile URLs sync the public events they expose. No API key needed.
      </p>

      <div className="mt-8 rounded-2xl border border-hairline bg-surface/60 p-5">
        <label className="block font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Public URL
        </label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://lu.ma/…"
          className="mt-2 w-full rounded-xl border border-hairline bg-surface px-4 py-2.5 text-sm focus:border-accent focus:outline-none"
          disabled={mut.isPending}
        />

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Type
            </div>
            <div className="mt-1 inline-flex rounded-full border border-hairline bg-surface/60 p-1 text-xs font-medium">
              {(["auto", "calendar", "event", "profile"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  disabled={mut.isPending}
                  className={
                    "rounded-full px-3 py-1 capitalize transition " +
                    (kind === k
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
          {kind !== "event" && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Max events
              </div>
              <input
                type="number"
                min={1}
                max={80}
                value={limit}
                onChange={(e) => setLimit(Math.max(1, Math.min(80, Number(e.target.value) || 40)))}
                disabled={mut.isPending}
                className="mt-1 w-24 rounded-lg border border-hairline bg-surface px-3 py-1.5 text-sm"
              />
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={() => mut.mutate()}
            disabled={disabled}
            className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            {mut.isPending ? "Importing…" : "Import"}
          </button>
          <Link
            to="/events"
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Link>
        </div>

        {mut.isError && (
          <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs">
            <b>Import failed.</b>
            <div className="mt-1 font-mono opacity-80">{(mut.error as Error).message}</div>
          </div>
        )}
        {mut.isSuccess && mut.data && (
          <div className="mt-4 rounded-xl border border-accent/30 bg-accent/10 p-3 text-xs">
            Imported <b>{mut.data.imported}</b> event
            {mut.data.imported === 1 ? "" : "s"} into <b>{mut.data.calendarName}</b>.
          </div>
        )}
      </div>

      <p className="mt-6 font-mono text-[11px] leading-relaxed text-muted-foreground">
        Scraped calendars appear in your calendar switcher with a ⌘ marker. Reruns re-scrape and
        refresh the cached events. This currently supports <b>lu.ma</b>; other providers land in a
        follow-up.
      </p>
    </div>
  );
}
