// Compact dropdown at the top-left of the shell letting the user switch
// between their linked Luma calendars, view all combined, or add a new one.
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { listCalendars, type UserCalendarDTO } from "@/lib/user-luma-calendars.functions";
import { useActiveCalendar } from "@/hooks/use-active-calendar";

export function CalendarSwitcher() {
  const fetchList = useServerFn(listCalendars);
  const { data: cals } = useQuery({
    queryKey: ["luma-calendars"],
    queryFn: () => fetchList(),
  });
  const { activeCalendarId, setActiveCalendarId } = useActiveCalendar();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current || ref.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const active = pickActive(cals, activeCalendarId);

  function pick(id: string | null) {
    setActiveCalendarId(id);
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["luma-events"] });
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-3 rounded-xl border border-transparent px-1 py-1 hover:border-hairline hover:bg-surface/60"
      >
        {active.avatarUrl ? (
          <img
            src={active.avatarUrl}
            alt=""
            className="h-9 w-9 rounded-lg border border-hairline object-cover"
          />
        ) : (
          <div
            className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-xs font-bold text-accent-foreground"
            aria-hidden
          >
            {active.badge}
          </div>
        )}
        <div className="leading-tight text-left">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            Luma Badge Studio
          </div>
          <div className="flex items-center gap-1 font-display text-sm font-semibold tracking-tight">
            <span className="max-w-[180px] truncate">{active.name}</span>
            <svg width="10" height="10" viewBox="0 0 10 10" className="opacity-60">
              <path d="M2 4 L5 7 L8 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </div>
        </div>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-hairline bg-surface shadow-2xl">
          <div className="border-b border-hairline px-3 pb-1.5 pt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Calendars
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            {(cals ?? []).map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => pick(c.calendarId)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-2 ${
                    activeCalendarId === c.calendarId || (!activeCalendarId && c.isDefault)
                      ? "bg-surface-2"
                      : ""
                  }`}
                >
                  {c.avatarUrl ? (
                    <img src={c.avatarUrl} alt="" className="h-7 w-7 rounded-md border border-hairline object-cover" />
                  ) : (
                    <div className="h-7 w-7 rounded-md bg-surface-2" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                  {c.source === "scrape" && (
                    <span
                      title="Imported by link (scraped)"
                      className="rounded-full border border-hairline px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      link
                    </span>
                  )}
                  {c.isDefault && (
                    <span className="rounded-full border border-hairline px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                      default
                    </span>
                  )}
                </button>
              </li>
            ))}
            {(cals?.length ?? 0) > 1 && (
              <li>
                <button
                  onClick={() => pick("__all__")}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-2 ${
                    activeCalendarId === "__all__" ? "bg-surface-2" : ""
                  }`}
                >
                  <div className="grid h-7 w-7 place-items-center rounded-md border border-hairline text-xs">∞</div>
                  <span className="text-sm font-medium">All calendars combined</span>
                </button>
              </li>
            )}
          </ul>
          <div className="border-t border-hairline">
            <Link
              to="/settings"
              onClick={() => setOpen(false)}
              className="block w-full px-3 py-2 text-left text-sm font-medium text-accent hover:bg-surface-2"
            >
              + Add calendar
            </Link>
            {(cals?.length ?? 0) > 0 && (
              <button
                onClick={() => {
                  setOpen(false);
                  navigate({ to: "/settings" });
                }}
                className="block w-full px-3 py-2 text-left text-xs text-muted-foreground hover:bg-surface-2"
              >
                Manage calendars →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function pickActive(
  cals: UserCalendarDTO[] | undefined,
  activeId: string | null,
): { name: string; avatarUrl: string | null; badge: string } {
  if (activeId === "__all__") return { name: "All calendars", avatarUrl: null, badge: "∞" };
  if (!cals || cals.length === 0) return { name: "Setup required", avatarUrl: null, badge: "?" };
  const picked = (activeId && cals.find((c) => c.calendarId === activeId)) || cals.find((c) => c.isDefault) || cals[0];
  return {
    name: picked.name,
    avatarUrl: picked.avatarUrl,
    badge: (picked.name[0] ?? "?").toUpperCase(),
  };
}
