// Server-only Luma API helpers. Never import from client bundles.
// Auth: https://docs.lu.ma/reference/getting-started-with-your-api

export type LumaEvent = {
  api_id: string;
  name: string;
  cover_url: string | null;
  url: string;
  start_at: string;
  end_at?: string;
  description_md?: string;
  geo_address_info?: { city_state?: string; full_address?: string } | null;
  timezone?: string;
};

export type LumaListResponse = {
  entries: Array<{ event: LumaEvent; tags?: unknown[] }>;
  has_more: boolean;
  next_cursor?: string | null;
};

const LUMA_BASE = "https://api.lu.ma/public/v1";

function requireKey(): string {
  const key = process.env.LUMA_API_KEY;
  if (!key) throw new Error("LUMA_API_KEY is not configured");
  return key;
}

async function lumaFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(LUMA_BASE + path);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
      "x-luma-api-key": requireKey(),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Luma ${path} failed [${res.status}]: ${body}`);
  }
  return (await res.json()) as T;
}

export async function fetchAllEvents(): Promise<LumaEvent[]> {
  const out: LumaEvent[] = [];
  let cursor: string | undefined;
  // Cap pages defensively
  for (let i = 0; i < 10; i++) {
    const params: Record<string, string> = { pagination_limit: "50" };
    if (cursor) params.pagination_cursor = cursor;
    const data = await lumaFetch<LumaListResponse>("/calendar/list-events", params);
    for (const entry of data.entries ?? []) out.push(entry.event);
    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }
  return out;
}

export async function fetchEvent(eventId: string): Promise<LumaEvent> {
  // Try the direct endpoint first, then fall back to the list.
  try {
    const data = await lumaFetch<{ event: LumaEvent }>("/event/get", { api_id: eventId });
    if (data?.event) return data.event;
  } catch {
    // fall through
  }
  const all = await fetchAllEvents();
  const found = all.find((e) => e.api_id === eventId);
  if (!found) throw new Error(`Event ${eventId} not found on this calendar`);
  return found;
}
