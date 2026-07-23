// Client-side helpers to export the events dataset as JSON or CSV.
import type { EventDTO } from "@/lib/luma.functions";

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCSV(rows: EventDTO[]): string {
  const headers = [
    "id",
    "name",
    "url",
    "start_at",
    "end_at",
    "city",
    "cover_url",
    "calendar_id",
    "calendar_name",
    "description",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.name,
        r.url,
        r.startAt,
        r.endAt ?? "",
        r.city ?? "",
        r.coverUrl ?? "",
        r.calendarId ?? "",
        r.calendarName ?? "",
        (r.description ?? "").replace(/\s+/g, " ").slice(0, 1000),
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\n");
}

export function downloadEventsDataset(
  events: EventDTO[],
  kind: "json" | "csv",
  calendarKey: string,
) {
  const sorted = [...events].sort(
    (a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime(),
  );
  const date = new Date().toISOString().slice(0, 10);
  const base = `luma-events-${calendarKey}-${date}`;
  const blob =
    kind === "json"
      ? new Blob([JSON.stringify(sorted, null, 2)], { type: "application/json" })
      : new Blob([toCSV(sorted)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${base}.${kind}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
