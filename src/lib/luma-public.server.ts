// Public (unauthenticated) Luma calendar API. Lets us import a public calendar by
// URL with NO Luma API key and NO Firecrawl: the calendar page embeds a
// `calendar_api_id`, and api.lu.ma/calendar/get-items returns full event data.
// lu.ma now redirects to luma.com — both are handled.
//
// Server-only: external fetch, imported dynamically from server fns.

const LUMA_ORIGIN = "https://luma.com";
const LUMA_API = "https://api.lu.ma";

export type ResolvedCalendar = {
  apiId: string; // cal-...
  name: string;
  slug: string;
  url: string; // canonical luma.com/<slug>
};

export type PublicLumaEvent = {
  apiId: string; // evt-...
  slug: string; // public url slug
  name: string;
  coverUrl: string | null;
  startAt: string | null;
  endAt: string | null;
  city: string | null;
  url: string; // https://luma.com/<slug>
};

function normalize(input: string): { slug: string; url: string } {
  const u = new URL(input.trim());
  const slug = u.pathname.replace(/^\/+|\/+$/g, "");
  return { slug, url: `${LUMA_ORIGIN}/${slug}` };
}

/** Resolve a public calendar URL to its api id + display name. */
export async function resolveLumaCalendar(input: string): Promise<ResolvedCalendar | null> {
  let slug: string;
  let url: string;
  try {
    ({ slug, url } = normalize(input));
  } catch {
    return null;
  }
  if (!slug) return null;

  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0", accept: "text/html" },
    redirect: "follow",
  });
  if (!res.ok) return null;
  const html = await res.text();

  const apiId = (html.match(/"api_id"\s*:\s*"(cal-[A-Za-z0-9]+)"/) || [])[1];
  if (!apiId) return null;

  const name = (
    (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || [])[1] ||
    (html.match(/<title>([^<]+)<\/title>/i) || [])[1] ||
    slug
  )
    .replace(/\s*[·|]\s*Luma\s*$/i, "")
    .trim();

  return { apiId, name: name || slug, slug, url };
}

type RawEvent = {
  api_id: string;
  name: string;
  url?: string;
  cover_url?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  geo_address_info?: { city_state?: string | null } | null;
};

function toPublicEvent(ev: RawEvent): PublicLumaEvent {
  const slug = ev.url ?? ev.api_id;
  return {
    apiId: ev.api_id,
    slug,
    name: ev.name,
    coverUrl: ev.cover_url ?? null,
    startAt: ev.start_at ?? null,
    endAt: ev.end_at ?? null,
    city: ev.geo_address_info?.city_state ?? null,
    url: `${LUMA_ORIGIN}/${slug}`,
  };
}

async function fetchPage(
  calApiId: string,
  period: "future" | "past",
  cursor?: string,
): Promise<{ entries: Array<{ event?: RawEvent }>; hasMore: boolean; nextCursor?: string }> {
  const qs = new URLSearchParams({
    calendar_api_id: calApiId,
    period,
    pagination_limit: "50",
  });
  if (cursor) qs.set("pagination_cursor", cursor);
  const res = await fetch(`${LUMA_API}/calendar/get-items?${qs.toString()}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) return { entries: [], hasMore: false };
  const json = (await res.json()) as {
    entries?: Array<{ event?: RawEvent }>;
    has_more?: boolean;
    next_cursor?: string;
  };
  return {
    entries: json.entries ?? [],
    hasMore: Boolean(json.has_more),
    nextCursor: json.next_cursor,
  };
}

/** Fetch up to `limit` events for a public calendar (upcoming first, then past). */
export async function fetchPublicCalendarEvents(
  calApiId: string,
  limit: number,
): Promise<PublicLumaEvent[]> {
  const out: PublicLumaEvent[] = [];
  const seen = new Set<string>();

  for (const period of ["future", "past"] as const) {
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const { entries, hasMore, nextCursor } = await fetchPage(calApiId, period, cursor);
      for (const e of entries) {
        const ev = e.event;
        if (!ev?.api_id || seen.has(ev.api_id)) continue;
        seen.add(ev.api_id);
        out.push(toPublicEvent(ev));
      }
      if (out.length >= limit) return out.slice(0, limit);
      if (!hasMore || !nextCursor) break;
      cursor = nextCursor;
    }
  }
  return out.slice(0, limit);
}
