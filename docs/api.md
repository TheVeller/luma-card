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

const { events } = await lumaCardFetch<EventsResponse>("/api/v1/events?calendar=all&limit=50");
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
  "groups": [
    {
      "id": "b53ea106-79d1-45fe-98b7-50de70ef9d22",
      "name": "Startups & Venture",
      "order": 0
    }
  ],
  "calendars": [
    {
      "id": "cal-abc123",
      "name": "Founder Dinners",
      "slug": "founder-dinners",
      "source": "api",
      "kind": "calendar",
      "provider": "luma",
      "ownership": "connected",
      "isDefault": true,
      "url": "https://lu.ma/founder-dinners",
      "avatarUrl": "https://images.lumacdn.com/calendars/founders.png",
      "coverUrl": "https://images.lumacdn.com/calendar-cover-images/founders.jpg",
      "description": "Founder events and community dinners.",
      "color": "#ff6600",
      "eventCount": 42,
      "hasEvents": true,
      "order": 0,
      "group": {
        "id": "b53ea106-79d1-45fe-98b7-50de70ef9d22",
        "name": "Startups & Venture",
        "order": 0
      },
      "curatedName": "Founder Dinners",
      "remoteName": "Founder Dinners",
      "suggestedGroup": null,
      "sync": {
        "status": "completed",
        "error": null,
        "discovered": 42,
        "imported": 42,
        "lastSyncedAt": "2026-07-28T13:00:00.000Z",
        "lastAttemptedAt": "2026-07-28T13:00:00.000Z",
        "historicalSyncCompletedAt": "2026-07-27T13:00:00.000Z",
        "scope": "maintenance",
        "nextSyncAt": "2026-07-29T13:00:00.000Z"
      }
    },
    {
      "id": "scr-xyz789",
      "canonicalCalendarId": "cal-xyz789",
      "aliases": ["scr-cal-xyz789", "https://luma.com/example"],
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

| Field                 | Type                                          | Notes                                                                            |
| --------------------- | --------------------------------------------- | -------------------------------------------------------------------------------- |
| `id`                  | `string`                                      | Pass this as `calendar` to `/api/v1/events`.                                     |
| `canonicalCalendarId` | `string \| null`                              | Stable Luma `cal-*` identity when it has been resolved.                          |
| `aliases`             | `string[]`                                    | Permanent legacy IDs, URLs, and slugs accepted anywhere a calendar ID is used.   |
| `name`                | `string \| null`                              | Display name from Luma or the imported calendar.                                 |
| `slug`                | `string \| null`                              | Luma slug when available.                                                        |
| `source`              | `"api" \| "scrape"`                           | `api` is a connected Luma API calendar; `scrape` is an imported public calendar. |
| `kind` / `sourceKind` | `"api" \| "calendar" \| "profile" \| "event"` | The logical source type (`sourceKind` is the explicit canonical field).          |
| `provider`            | `"luma" \| "eventbrite" \| "meetup"`          | Remote event provider.                                                           |
| `ownership`           | `"connected" \| "external"`                   | Whether the source comes from an authorized organizer connection.                |
| `isDefault`           | `boolean`                                     | User's default calendar in this app.                                             |
| `url`                 | `string \| null`                              | Calendar URL when known.                                                         |
| `avatarUrl`           | `string \| null`                              | Calendar/profile logo with branding fallbacks applied.                           |
| `coverUrl`            | `string \| null`                              | Calendar cover or social image.                                                  |
| `description`         | `string \| null`                              | Latest public description.                                                       |
| `color`               | `string \| null`                              | Luma tint color when available.                                                  |
| `eventCount`          | `number`                                      | Number of imported events currently stored.                                      |
| `upcomingCount`       | `number`                                      | Upcoming and currently ongoing canonical events for this calendar.               |
| `pastCount`           | `number`                                      | Canonical events that have already ended or started without an end time.         |
| `unknownCount`        | `number`                                      | Canonical events without a usable start timestamp.                               |
| `hasEvents`           | `boolean`                                     | Convenience flag derived from `eventCount`.                                      |
| `group`               | `object \| null`                              | User-defined group and its display order.                                        |
| `order`               | `number`                                      | Calendar order inside its group.                                                 |
| `curatedName`         | `string \| null`                              | User-controlled display label, preserved across syncs.                           |
| `remoteName`          | `string \| null`                              | Latest name reported by Luma.                                                    |
| `suggestedGroup`      | `object \| null`                              | Deterministic grouping suggestion awaiting approval.                             |
| `sync`                | `object`                                      | Status, counts, last successful/attempted timestamps, scope, and historical completion. |

Sync status is one of `idle`, `queued`, `running`, `completed`, `partial`,
`failed`, or `inaccessible`. A `partial` source used a fallback but could not
confirm every event. Calendars confirmed to have no published events remain in
the collection with `hasEvents: false`.

### `GET /api/v1/events`

Returns routed events for the caller. By default it reads all connected
calendars, merges API-backed and imported calendars, and returns one canonical
event with every source where it appeared.

Query parameters:

| Param      | Type                                  | Default     | Notes                                                                                                            |
| ---------- | ------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- |
| `calendar` | `string`                              | `all`       | Use `all`, omit it, or pass a current `id`, `canonicalCalendarId`, or any alias returned by `/api/v1/calendars`. |
| `provider` | `luma \| eventbrite \| meetup`        | —           | Restrict results to one provider.                                                                                |
| `owned`    | `true \| false`                       | —           | Restrict results by authorized organizer ownership.                                                              |
| `mode`     | `canonical \| sources`                | `canonical` | `canonical` returns unique events with `sources`; `sources` returns one row per source/calendar sighting.        |
| `status`   | `all \| upcoming \| ongoing \| past`  | `all`       | `upcoming` includes events currently in progress; use `ongoing` to return only those events.                     |
| `sort`     | `upcoming \| start_asc \| start_desc` | `upcoming`  | `upcoming` orders ongoing events first, future events nearest-first, then past events newest-first.              |
| `at`       | ISO date string                       | server time | Reference instant for status/order. Reuse the first response's `generatedAt` on later pages.                     |
| `from`     | ISO date string                       | none        | Inclusive lower bound on `startAt`.                                                                              |
| `to`       | ISO date string                       | none        | Inclusive upper bound on `startAt`.                                                                              |
| `limit`    | integer `1..200`                      | `100`       | Page size.                                                                                                       |
| `cursor`   | opaque string                         | none        | `page.nextCursor` from the previous response.                                                                    |

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
      "temporalStatus": "upcoming",
      "durationMinutes": 180,
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
      "sourceCount": 1,
      "sourceCalendars": [
        {
          "calendarId": "cal-abc123",
          "name": "Founder Dinners",
          "slug": "founder-dinners",
          "source": "api"
        }
      ],
      "tags": [],
      "suggestedTags": [],
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
  "mode": "canonical",
  "filters": {
    "calendar": "all",
    "status": "all",
    "at": null,
    "from": null,
    "to": null
  },
  "sort": "upcoming",
  "generatedAt": "2026-07-28T14:00:00.000Z"
}
```

Event fields:

| Field             | Type                                     | Notes                                                                            |
| ----------------- | ---------------------------------------- | -------------------------------------------------------------------------------- |
| `id`              | `string`                                 | Luma event id, or `scr-*` for imported public events.                            |
| `name`            | `string`                                 | Event name.                                                                      |
| `coverUrl`        | `string \| null`                         | Cover image URL when available.                                                  |
| `url`             | `string`                                 | Public event URL.                                                                |
| `startAt`         | `string`                                 | ISO date string.                                                                 |
| `endAt`           | `string \| null`                         | ISO date string when known.                                                      |
| `temporalStatus`  | `upcoming \| ongoing \| past \| unknown` | Status calculated against the response's `generatedAt` instant.                  |
| `durationMinutes` | `number \| null`                         | Event duration when both timestamps form a valid interval.                       |
| `city`            | `string \| null`                         | Human-readable city/location when available.                                     |
| `description`     | `string \| null`                         | Markdown/text description when available.                                        |
| `externalIds`     | `object \| null`                         | Canonical mode only: known Luma/scraped ids.                                     |
| `sources`         | `array \| null`                          | Canonical mode only: calendars/imports/profile sources where the event appeared. |
| `sourceCount`     | `number`                                 | Number of distinct source sightings merged into this event.                      |
| `sourceCalendars` | `array`                                  | Every known calendar containing the event, without duplicates.                   |
| `tags`            | `string[]`                               | Approved tags. Empty until tagging is configured.                                |
| `suggestedTags`   | `string[]`                               | Suggested but not yet approved tags.                                             |
| `calendar`        | `object \| null`                         | Source calendar metadata.                                                        |

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

## Dates And Ordering

All timestamps are ISO 8601 instants. The server calculates `temporalStatus`
using both `startAt` and `endAt` against `generatedAt`, so an event that already
started but has not ended is `ongoing`, not `past`.

Use `status=upcoming&sort=upcoming` for a discovery feed. This includes ongoing
events first, followed by future events from nearest to farthest. Use
`status=past&sort=start_desc` for history.

For multipage reads, send the first page's `generatedAt` back as `at` on every
later request. This freezes temporal classification and ordering while the
consumer traverses the collection.

## Errors

Error responses are JSON:

```json
{ "error": "invalid_token" }
```

| HTTP  | `error`         | Meaning                                                    |
| ----- | --------------- | ---------------------------------------------------------- |
| `401` | `missing_token` | No `Authorization` header was sent.                        |
| `401` | `invalid_token` | Token is malformed, unknown, or revoked.                   |
| `400` | `bad_params`    | Invalid query parameter, such as a bad ISO date or cursor. |
| `500` | `server_error`  | Server-side failure while reading calendars/events.        |

All REST responses include permissive CORS headers and `cache-control: no-store`.

## MCP Router

The app also exposes an MCP server for OAuth-capable clients:

| Route                                   | Purpose                            |
| --------------------------------------- | ---------------------------------- |
| `/mcp`                                  | Main MCP endpoint.                 |
| `/.mcp/list-tools`                      | Lists available MCP tools.         |
| `/.mcp/invoke-tool/:tool`               | Invokes one MCP tool.              |
| `/.well-known/oauth-protected-resource` | OAuth protected-resource metadata. |

Current tools:

| Tool                       | Purpose                                          |
| -------------------------- | ------------------------------------------------ |
| `whoami`                   | Verify the authenticated user id and email.      |
| `list_calendars`           | List connected Luma calendars.                   |
| `list_my_badges`           | List generated badges, optionally by `event_id`. |
| `list_event_style_presets` | List saved AI style presets for an event.        |

Use the REST API for ordinary app integrations. Use MCP when the consumer is an
agent/client that already speaks MCP and can complete the Supabase OAuth flow.

## TypeScript Types

```ts
type CalendarSource = "api" | "scrape";
type EventProvider = "luma" | "eventbrite" | "meetup";

type CalendarGroupDTO = {
  id: string;
  name: string;
  order: number;
};

type CalendarDTO = {
  id: string;
  canonicalCalendarId: string | null;
  aliases: string[];
  name: string | null;
  slug: string | null;
  source: CalendarSource;
  sourceKind: "api" | "calendar" | "profile" | "event";
  provider: EventProvider;
  ownership: "connected" | "external";
  isDefault: boolean;
  url: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  description: string | null;
  color: string | null;
  eventCount: number;
  upcomingCount: number;
  pastCount: number;
  unknownCount: number;
  hasEvents: boolean;
  group: CalendarGroupDTO | null;
  order: number;
};

type EventCalendarDTO = {
  calendarId: string;
  name: string;
  slug: string | null;
  source: CalendarSource;
  provider: EventProvider;
  ownership: "connected" | "external";
};

type EventSourceDTO = {
  provider: EventProvider;
  sourceType:
    | "api"
    | "calendar_scrape"
    | "event_scrape"
    | "profile_scrape"
    | "eventbrite_api"
    | "eventbrite_public"
    | "meetup_api"
    | "meetup_public";
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
  temporalStatus: "upcoming" | "ongoing" | "past" | "unknown";
  durationMinutes: number | null;
  city: string | null;
  description: string | null;
  externalIds: {
    lumaEventId?: string;
    scrapedEventKeys: string[];
  } | null;
  sources: EventSourceDTO[] | null;
  sourceCount: number;
  sourceCalendars: EventCalendarDTO[];
  tags: string[];
  suggestedTags: string[];
  calendar: EventCalendarDTO | null;
};

type CalendarsResponse = {
  groups: CalendarGroupDTO[];
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
  filters: {
    calendar: string;
    status: "all" | "upcoming" | "ongoing" | "past";
    at: string | null;
    from: string | null;
    to: string | null;
  };
  sort: "upcoming" | "start_asc" | "start_desc";
  generatedAt: string;
};
```
