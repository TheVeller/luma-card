import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { importFromUrl, type ImportResult } from "@/lib/luma-scrape.functions";
import {
  detectProviderImportTarget,
  type ProviderImportKind,
  type SupportedProvider,
} from "@/lib/event-providers";
import { cn } from "@/lib/utils";

const PROVIDER_LABEL: Record<SupportedProvider, string> = {
  luma: "Luma",
  eventbrite: "Eventbrite",
  meetup: "Meetup",
};

const KIND_LABEL: Record<ProviderImportKind, string> = {
  calendar: "Calendar",
  event: "Event",
  profile: "Profile",
  organizer: "Organizer",
  group: "Group",
};

type Props = {
  className?: string;
  compact?: boolean;
  onImported?: (result: ImportResult) => void | Promise<void>;
};

export function EventSourceImporter({ className, compact = false, onImported }: Props) {
  const runImport = useServerFn(importFromUrl);
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [kind, setKind] = useState<"auto" | "calendar" | "event" | "profile">("auto");
  const [allEvents, setAllEvents] = useState(true);
  const [limit, setLimit] = useState(80);
  const target = useMemo(() => detectProviderImportTarget(url.trim()), [url]);
  const looksLikeUrl = /^https?:\/\//i.test(url.trim());

  const mutation = useMutation({
    mutationFn: () =>
      runImport({
        data: {
          url: url.trim(),
          kind,
          allEvents,
          limit,
        },
      }),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["luma-events"] }),
        queryClient.invalidateQueries({ queryKey: ["luma-calendars"] }),
        queryClient.invalidateQueries({ queryKey: ["calendars"] }),
        queryClient.invalidateQueries({ queryKey: ["sync-sources"] }),
        queryClient.invalidateQueries({ queryKey: ["event-library-stats"] }),
      ]);
      await onImported?.(result);
    },
  });

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap gap-2">
        {(["luma", "eventbrite", "meetup"] as const).map((provider) => (
          <Badge
            key={provider}
            variant={target?.provider === provider ? "default" : "outline"}
            className="rounded-full font-mono text-[10px] uppercase tracking-[0.12em]"
          >
            {PROVIDER_LABEL[provider]}
          </Badge>
        ))}
      </div>

      <div>
        <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Public event source
        </label>
        <input
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            mutation.reset();
          }}
          placeholder="Paste a Luma, Eventbrite, or Meetup URL"
          disabled={mutation.isPending}
          className="mt-2 w-full rounded-xl border border-hairline bg-background px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-white/30 focus:outline-none"
        />
      </div>

      {target && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-surface/60 px-3 py-2">
          <Badge variant="secondary" className="rounded-full">
            {PROVIDER_LABEL[target.provider]}
          </Badge>
          <Badge variant="outline" className="rounded-full">
            {KIND_LABEL[target.kind]}
          </Badge>
          <Badge variant="outline" className="rounded-full">
            Public link
          </Badge>
          <span className="text-xs text-muted-foreground">
            Supports {target.supportedKinds.map((value) => KIND_LABEL[value]).join(" · ")}
          </span>
        </div>
      )}

      {looksLikeUrl && !target && (
        <p className="text-xs text-destructive">
          This URL is not supported. Use a Luma, Eventbrite, or Meetup link.
        </p>
      )}

      <button
        type="button"
        onClick={() => setAdvanced((value) => !value)}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        Advanced
        {advanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {advanced && (
        <div className="grid gap-3 rounded-xl border border-hairline bg-surface/40 p-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={allEvents}
              onChange={(event) => setAllEvents(event.target.checked)}
              disabled={mutation.isPending}
            />
            Import complete available history
          </label>
          {!allEvents && (
            <label className="text-xs text-muted-foreground">
              Event limit
              <input
                type="number"
                min={1}
                max={2000}
                value={limit}
                onChange={(event) =>
                  setLimit(Math.max(1, Math.min(2000, Number(event.target.value) || 80)))
                }
                className="ml-2 w-24 rounded-lg border border-hairline bg-background px-3 py-1.5 text-sm text-foreground"
              />
            </label>
          )}
          {(!target || target.provider === "luma") && (
            <label className="text-xs text-muted-foreground sm:col-span-2">
              Override detected type
              <select
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as "auto" | "calendar" | "event" | "profile")
                }
                className="ml-2 rounded-lg border border-hairline bg-background px-3 py-1.5 text-sm text-foreground"
              >
                <option value="auto">Automatic</option>
                <option value="calendar">Calendar</option>
                <option value="profile">Profile</option>
                <option value="event">Event</option>
              </select>
            </label>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={!target || mutation.isPending}
        className={cn(
          "rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40",
          compact && "w-full sm:w-auto",
        )}
      >
        {mutation.isPending ? "Importing…" : "Import source"}
      </button>

      {mutation.isError && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          <b>Import failed.</b>
          <div className="mt-1 font-mono opacity-80">{mutation.error.message}</div>
        </div>
      )}

      {mutation.isSuccess && (
        <div className="rounded-xl border border-accent/30 bg-accent/10 p-3 text-xs">
          <b>{mutation.data.calendarName}</b> · imported {mutation.data.imported}
          {mutation.data.discovered !== undefined
            ? ` of ${mutation.data.discovered} discovered events`
            : " events"}
          {mutation.data.status === "partial" ? " · partial sync" : ""}
          {(mutation.data.warnings?.length ?? 0) > 0 && (
            <div className="mt-1 text-muted-foreground">{mutation.data.warnings?.join(" · ")}</div>
          )}
        </div>
      )}
    </div>
  );
}
