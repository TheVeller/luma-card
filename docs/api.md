# Luma Badge Studio API

This document covers the public integration surface for pulling a user's routed
Luma calendars and events into another app.

There are two API surfaces:

- **Calendar Router REST API**: simple Bearer-token JSON endpoints for apps,
  scripts, automations, and backends.
- **MCP router**: OAuth-backed tool endpoints for MCP-capable clients.

## Base URL

Use the deployed app origin:

```txt
https://your-luma-card-deployment.example
```

In local development this is usually:

```txt
http://localhost:3000
```

## Authentication

Create an external API token in the app:

1. Open **Settings**.
2. Go to **Calendar router API**.
3. Create a token.
4. Copy it immediately. The raw token is shown only once.

Send it on every REST request:

```http
Authorization: Bearer luma_sk_...
```

Tokens are scoped to the signed-in user that created them. The server stores
only a SHA-256 hash, so a token cannot be recovered after creation. Revoke a
token from Settings if it leaks.

## Quick Start

```bash
curl -H "Authorization: Bearer luma_sk_..." \
  "https://your-luma-card-deployment.example/api/v1/events?calendar=all&limit=50"
```

```ts
const apiBase = "https://your-luma-card-deployment.example";
const token = process.env.LUMA_CARD_API_TOKEN!;

async function lumaCardFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

const { events } = await lumaCardFetch<EventsResponse>(
  "/api/v1/events?calendar=all&limit=50",
);
```

## REST Endpoints

### `GET /api/v1/calendars`

Lists the caller's connected calendars. Use this to discover valid
`calendar` filter values for `/api/v1/events`.

```bash
curl -H "Authorization: Bearer luma_sk_..." \
  "https://your-luma-card-deployment.example/api/v1/calendars"
```

Response:

```json
{
  "calendars": [
    {
      "id": "cal-abc123",
      "name": "Founder Dinners",
      "slug": "founder-dinners",
      "source": "api",
      "isDefault": true,
      "url": "https://lu.ma/founder-dinners"
    },
    {
      "id": "scr-xyz789",
      "name": "Imported events",
      "slug": null,
      "source": "scrape",
      "isDefault": false,
      "url": "https://lu.ma/example"
    }
  ]
}
```

Calendar fields:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | Pass this as `calendar` to `/api/v1/events`. |
| `name` | `string \| null` | Display name from Luma or the imported calendar. |
| `slug` | `string \| null` | Luma slug when available. |
| `source` | `"api" \| "scrape"` | `api` is a connected Luma API calendar; `scrape` is an imported public calendar. |
| `isDefault` | `boolean` | User's default calendar in this app. |
| `url` | `string \| null` | Calendar URL when known. |

### `GET /api/v1/events`

Returns routed events for the caller. By default it reads all connected
calendars, merges API-backed and imported calendars, and returns one canonical
event with every source where it appeared.

Query parameters:

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `calendar` | `string` | `all` | Use `all`, omit it, or pass a calendar `id` from `/api/v1/calendars`. |
| `mode` | `canonical \| sources` | `canonical` | `canonical` returns unique events with `sources`; `sources` returns one row per source/calendar sighting. |
| `from` | ISO date string | none | Inclusive lower bound on `startAt`. |
| `to` | ISO date string | none | Inclusive upper bound on `startAt`. |
| `limit` | integer `1..200` | `100` | Page size. |
| `cursor` | opaque string | none | `page.nextCursor` from the previous response. |

Example:

```bash
curl -H "Authorization: Bearer luma_sk_..." \
  "https://your-luma-card-deployment.example/api/v1/events?calendar=all&from=2026-07-01T00:00:00Z&limit=25"
```

Response:

```json
{
  "events": [
    {
      "id": "evt-abc123",
      "name": "AI Builders Night",
      "coverUrl": "https://images.lu.ma/example.jpg",
      "url": "https://lu.ma/ai-builders-night",
      "startAt": "2026-07-31T23:00:00.000Z",
      "endAt": "2026-08-01T02:00:00.000Z",
      "city": "Lima, Peru",
      "description": "A meetup for builders.",
      "externalIds": {
        "lumaEventId": "evt-abc123",
        "scrapedEventKeys": []
      },
      "sources": [
        {
          "sourceType": "api",
          "sourceKey": "api:cal-abc123:evt-abc123",
          "calendarId": "cal-abc123",
          "calendarName": "Founder Dinners",
          "sourceUrl": "https://lu.ma/ai-builders-night",
          "externalEventId": "evt-abc123",
          "hostName": null,
          "lastSyncedAt": "2026-07-28T14:00:00.000Z"
        }
      ],
      "tags": [],
      "calendar": {
        "calendarId": "cal-abc123",
        "name": "Founder Dinners",
        "slug": "founder-dinners",
        "source": "api"
      }
    }
  ],
  "page": {
    "limit": 25,
    "offset": 0,
    "total": 88,
    "nextCursor": "MjU"
  },
  "mode": "canonical"
}
```

Event fields:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | Luma event id, or `scr-*` for imported public events. |
| `name` | `string` | Event name. |
| `coverUrl` | `string \| null` | Cover image URL when available. |
| `url` | `string` | Public event URL. |
| `startAt` | `string` | ISO date string. |
| `endAt` | `string \| null` | ISO date string when known. |
| `city` | `string \| null` | Human-readable city/location when available. |
| `description` | `string \| null` | Markdown/text description when available. |
| `externalIds` | `object \| null` | Canonical mode only: known Luma/scraped ids. |
| `sources` | `array \| null` | Canonical mode only: calendars/imports/profile sources where the event appeared. |
| `tags` | `string[]` | Approved tags. Empty until tagging is configured. |
| `calendar` | `object \| null` | Source calendar metadata. |

Use `mode=sources` when your integration needs one row per calendar/source
instead of deduplicated canonical events.

Pagination:

```ts
let cursor: string | null = null;
const allEvents: EventDTO[] = [];

do {
  const qs = new URLSearchParams({ calendar: "all", limit: "100" });
  if (cursor) qs.set("cursor", cursor);

  const page = await lumaCardFetch<EventsResponse>(`/api/v1/events?${qs}`);
  allEvents.push(...page.events);
  cursor = page.page.nextCursor;
} while (cursor);
```

Treat cursors as opaque. Do not decode or construct them in your app.

## Sorting Dates In Your App

The events endpoint returns a stable server order, but most apps should sort
for their UI explicitly.

Recommended "upcoming first" ordering:

```ts
function eventTime(event: EventDTO): number | null {
  const time = Date.parse(event.startAt);
  return Number.isFinite(time) ? time : null;
}

function sortUpcomingFirst(events: EventDTO[], now = Date.now()): EventDTO[] {
  return [...events].sort((a, b) => {
    const at = eventTime(a);
    const bt = eventTime(b);
    const au = at !== null && at >= now;
    const bu = bt !== null && bt >= now;

    if (au !== bu) return au ? -1 : 1;
    if (at === null && bt === null) return a.name.localeCompare(b.name);
    if (at === null) return 1;
    if (bt === null) return -1;
    return au ? at - bt : bt - at;
  });
}
```

This puts future events first by nearest date, then past events by most recent.

## Errors

Error responses are JSON:

```json
{ "error": "invalid_token" }
```

| HTTP | `error` | Meaning |
| --- | --- | --- |
| `401` | `missing_token` | No `Authorization` header was sent. |
| `401` | `invalid_token` | Token is malformed, unknown, or revoked. |
| `400` | `bad_params` | Invalid query parameter, such as a bad ISO date or cursor. |
| `500` | `server_error` | Server-side failure while reading calendars/events. |

All REST responses include permissive CORS headers and `cache-control: no-store`.

## MCP Router

The app also exposes an MCP server for OAuth-capable clients:

| Route | Purpose |
| --- | --- |
| `/mcp` | Main MCP endpoint. |
| `/.mcp/list-tools` | Lists available MCP tools. |
| `/.mcp/invoke-tool/:tool` | Invokes one MCP tool. |
| `/.well-known/oauth-protected-resource` | OAuth protected-resource metadata. |

Current tools:

| Tool | Purpose |
| --- | --- |
| `whoami` | Verify the authenticated user id and email. |
| `list_calendars` | List connected Luma calendars. |
| `list_my_badges` | List generated badges, optionally by `event_id`. |
| `list_event_style_presets` | List saved AI style presets for an event. |

Use the REST API for ordinary app integrations. Use MCP when the consumer is an
agent/client that already speaks MCP and can complete the Supabase OAuth flow.

## TypeScript Types

```ts
type CalendarSource = "api" | "scrape";

type CalendarDTO = {
  id: string;
  name: string | null;
  slug: string | null;
  source: CalendarSource;
  isDefault: boolean;
  url: string | null;
};

type EventCalendarDTO = {
  calendarId: string;
  name: string;
  slug: string | null;
  source: CalendarSource;
};

type EventSourceDTO = {
  sourceType: "api" | "calendar_scrape" | "event_scrape" | "profile_scrape";
  sourceKey: string;
  calendarId: string | null;
  calendarName: string | null;
  sourceUrl: string;
  externalEventId: string | null;
  hostName: string | null;
  lastSyncedAt: string;
};

type EventDTO = {
  id: string;
  name: string;
  coverUrl: string | null;
  url: string;
  startAt: string;
  endAt: string | null;
  city: string | null;
  description: string | null;
  externalIds: {
    lumaEventId?: string;
    scrapedEventKeys: string[];
  } | null;
  sources: EventSourceDTO[] | null;
  tags: string[];
  calendar: EventCalendarDTO | null;
};

type CalendarsResponse = {
  calendars: CalendarDTO[];
};

type EventsResponse = {
  events: EventDTO[];
  page: {
    limit: number;
    offset: number;
    total: number;
    nextCursor: string | null;
  };
  mode: "canonical" | "sources";
};
```
