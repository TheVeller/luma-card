# Luma Card

<div align="center">

### The event router for the open web

**One canonical event library for Luma, Eventbrite, and Meetup—plus a badge studio for the events you own.**

[![GitHub stars](https://img.shields.io/github/stars/TheVeller/luma-card?style=flat&logo=github)](https://github.com/TheVeller/luma-card/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/TheVeller/luma-card?style=flat&logo=github)](https://github.com/TheVeller/luma-card/issues)
[![Bun](https://img.shields.io/badge/runtime-Bun-black?style=flat&logo=bun)](https://bun.sh)
[![Cloudflare Workers](https://img.shields.io/badge/deploy-Cloudflare%20Workers-f38020?style=flat&logo=cloudflare)](https://workers.cloudflare.com/)

[Product overview](#why-luma-card) · [API quick start](#api-in-60-seconds) · [Architecture](#how-routing-works) · [Docs](#documentation-and-links)

</div>

## Why Luma Card

Event calendars are fragmented. The same event can appear in a Luma calendar, a Meetup group, an Eventbrite listing, and a scraped public page—each with a different ID, image, title, and update cadence.

Luma Card is the layer that makes those sources useful together:

- **Discover** events across every connected or imported source.
- **Normalize** inconsistent provider data into one predictable shape.
- **Deduplicate** repeated sightings without losing source lineage.
- **Enrich** events with location, language, modality, format, topics, audience, and branding.
- **Route** the canonical library to your own app through REST or MCP.
- **Create** personalized, shareable badges for events you own.

It is both a product for people who organize events and infrastructure for developers who need a dependable event feed.

## What you can build with it

| Use case | Luma Card gives you |
| --- | --- |
| Personal event discovery | One searchable library across Luma, Meetup, and Eventbrite. |
| Community operations | Full historical imports, daily maintenance syncs, grouping, logos, and source health. |
| Event directories | A canonical REST feed with provider filters, dates, location, tags, and pagination. |
| Agent workflows | OAuth-backed MCP tools for calendars, badges, and style presets. |
| Owned-event promotion | Badge Studio, reusable brand kits, cover-image fallbacks, and shareable output. |
| Data pipelines | Incremental change cursors with upserts and delete tombstones. |

## How routing works

```text
       Luma API / public Luma / Meetup / Eventbrite
                              │
                              ▼
                 Provider adapters and fallbacks
             API → JSON-LD/metadata → Firecrawl (last resort)
                              │
                              ▼
        Canonical event router + stable identity + taxonomy
                 │              │               │
                 ▼              ▼               ▼
             Web UI        REST API          MCP router
                 │                              │
                 ▼                              ▼
            Badge Studio                 Agents and automations
```

### The important boundary: canonical events

The router separates **identity** from **sightings**:

- `canonicalId` is the stable identity consumed by integrations.
- `sources` records every provider/calendar where the event appeared.
- `externalIds` preserves provider-specific identifiers.
- `tags` and `tagDetails` expose controlled taxonomy labels and provenance.
- `updatedAt` and sync metadata make freshness observable.

Consumers can choose the right shape:

- `mode=canonical`: one deduplicated event, with all known sources attached.
- `mode=sources`: one row per provider/calendar sighting.

That means a downstream app can build a clean directory without throwing away the evidence needed for attribution, debugging, or reconciliation.

## Product surface

### Event Router

Connect calendars and public sources from Settings. Historical imports are preserved; maintenance syncs focus on upcoming events and the recent past. Events can be filtered by provider, time, format, topic, audience, location, language, online status, and source.

### Enrichment and resilient media

Provider payloads are normalized into a shared enrichment shape. When a cover or calendar logo is missing, the ingestion pipeline can fall back to provider branding, metadata images, social previews, or cached assets instead of rendering a blank card.

### Badge Studio

For events you own, generate a personalized badge using reusable brand kits, style presets, logos, QR codes, and event imagery. The badge editor is data-driven, so layouts can be inspected, patched, validated, and rendered consistently.

## API in 60 seconds

1. Open **Settings → Calendar router API**.
2. Create a read-only token and copy it—the raw token is shown once.
3. Request canonical events:

```bash
curl \
  -H "Authorization: Bearer luma_sk_..." \
  "https://your-deployment.example/api/v1/events?calendar=all&status=upcoming&limit=50"
```

Use a published public deployment (`*.lovable.app` or a custom domain) for
external clients. Lovable preview/sandbox URLs (`*.lovableproject.com`) may
redirect to the Lovable login before requests reach the API. Verify the origin
first with `GET /api/v1/health` (no token required).

The response is designed for integrations:

```json
{
  "events": [
    {
      "id": "provider-event-id",
      "canonicalId": "00000000-0000-0000-0000-000000000001",
      "name": "AI Builders Night",
      "startAt": "2026-08-01T00:00:00.000Z",
      "temporalStatus": "upcoming",
      "tags": ["ai", "meetup"],
      "sources": [{ "provider": "meetup", "sourceKey": "meetup:group:event" }]
    }
  ],
  "page": { "limit": 50, "offset": 0, "total": 1, "nextCursor": null },
  "mode": "canonical"
}
```

### REST endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/health` | Public liveness check for deployment verification. |
| `GET /api/v1/calendars` | Calendars, groups, provider identity, branding, counts, and sync health. |
| `GET /api/v1/events` | Canonical or source-level events with filtering and opaque cursor pagination. |
| `GET /api/v1/events/{canonicalId}` | Fetch one canonical event by stable identity. |
| `GET /api/v1/events/changes` | Read incremental upserts and delete tombstones. |

Useful event filters include `provider`, `owned`, `q`, `country`, `city`, `language`, `online`, `format`, `topic`, `status`, `from`, `to`, `sort`, and `calendar`.

For an agent-native integration, use the OAuth-backed MCP router under `/mcp` and `/.mcp/*`.

→ **[Read the complete API guide](docs/api.md)** · **[Open the OpenAPI contract](docs/openapi.yaml)**

## Sync and data guarantees

- A source attempts a complete historical import before switching to maintenance mode.
- Maintenance prioritizes upcoming events and the previous seven days.
- Canonicalization prevents duplicate event rows while retaining every source relationship.
- Sync metadata exposes discovered, imported, failed, partial, and inaccessible states.
- Public-source ingestion can fall back from provider APIs to structured metadata and Firecrawl.
- Change consumers should persist `nextCursor` and apply upserts by `canonicalId`; delete entries are tombstones, not ordinary events.

## Security model

- REST uses `Authorization: Bearer luma_sk_...` tokens.
- Tokens are scoped to the creating user, shown once, stored only as SHA-256 hashes, and revocable from Settings.
- Read scopes are explicit: `events:read`, `calendars:read`, and `changes:read`.
- Requests are rate-limited per token and return structured JSON errors.
- Supabase Row Level Security protects user-owned calendars, tags, groups, tokens, and badges.
- Server-only keys never belong in `.env` committed to Git or in browser code.

## Local development

The project uses [Bun](https://bun.sh), [TanStack Start](https://tanstack.com/start), [React](https://react.dev/), [Supabase](https://supabase.com/), and [Cloudflare Workers](https://workers.cloudflare.com/).

```bash
git clone git@github.com:TheVeller/luma-card.git
cd luma-card
cp .env.example .env
bun install
bun run dev
```

Open `http://localhost:3000`, then connect a calendar from **Settings**.

```bash
bun run dev          # development server
bun run build        # production build
bun run preview      # preview production output
bun test             # test suite
bun run lint         # ESLint
bun run format       # Prettier
```

The browser needs Supabase publishable values. Server-only secrets such as `SUPABASE_SERVICE_ROLE_KEY`, `APP_ENCRYPTION_KEY`, and AI gateway keys are injected by the Cloudflare/Lovable runtime. See [.env.example](.env.example).

## Repository map

```text
src/routes/_authenticated/   Product UI: Events, Settings, Badge Studio
src/routes/api/v1/           Token-authenticated REST endpoints
src/lib/events-aggregate*    Canonicalization and source lineage
src/lib/event-providers*     Provider detection and ingestion adapters
src/lib/event-tags*          Controlled taxonomy and saved views
supabase/migrations/         Persistence, RLS, sync metadata, and constraints
docs/api.md                  Human-readable integration guide
docs/openapi.yaml            Machine-readable API contract
```

## Contributing

Keep `main` deployable because it is connected to Lovable. Make focused commits, run the relevant tests and build before pushing, and never rewrite published history. API changes should update both [docs/api.md](docs/api.md) and [docs/openapi.yaml](docs/openapi.yaml).

## Documentation and links

- [API integration guide](docs/api.md)
- [OpenAPI contract](docs/openapi.yaml)
- [Lovable](https://lovable.dev)
- [Repository](https://github.com/TheVeller/luma-card)
- [Open an issue](https://github.com/TheVeller/luma-card/issues)
