// Client hook: which calendar is currently active in the UI.
// Persisted in localStorage as "activeCalendarId".
//  - `undefined` / null → use the user's default calendar (server picks).
//  - "__all__"          → combined view across every linked calendar.
//  - specific calendar_id → that calendar only.
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "activeCalendarId";

function readInitial(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

// Simple pub/sub so multiple mounts stay in sync in the same tab.
const listeners = new Set<(v: string | null) => void>();

export function useActiveCalendar(): {
  activeCalendarId: string | null;
  setActiveCalendarId: (id: string | null) => void;
} {
  const [activeCalendarId, setState] = useState<string | null>(() => readInitial());

  useEffect(() => {
    const l = (v: string | null) => setState(v);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  const setActiveCalendarId = useCallback((id: string | null) => {
    try {
      if (id == null) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, id);
    } catch {}
    listeners.forEach((l) => l(id));
  }, []);

  return { activeCalendarId, setActiveCalendarId };
}
