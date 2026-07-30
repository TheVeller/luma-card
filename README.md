# Luma Card

## Event Router · Badge Studio

Luma Card turns scattered event calendars into one reliable, deduplicated event library—and gives you a design studio for the events you own.

Connect Luma, Eventbrite, and Meetup sources, import historical events, keep upcoming events fresh, and expose the result to other products through a token-authenticated REST API or MCP.

> Built with Lovable. Pushes to `main` synchronize the connected Lovable project.

## What it does

| Capability | How it helps |
| --- | --- |
| **Multi-source ingestion** | Connect Luma calendars and import public Eventbrite or Meetup sources. |
| **Canonical event library** | Merge repeated sightings into one event while retaining every source and calendar. |
| **Historical imports** | Load the complete available history, then maintain an upcoming-event window automatically. |
| **Data enrichment** | Normalize location, language, modality, format, topics, audience, branding, and image fallbacks. |
| **Event discovery** | Search and filter by source, format, topic, audience, location, language, modality, and dates. |
| **Badge Studio** | Generate personalized, shareable event badges with reusable brand kits and style presets. |
| **Integration API** | Consume calendars, canonical events, and incremental changes from another app. |
| **MCP router** | Let OAuth-capable agents discover calendars, badges, and style presets. |

## Architecture

```text
Luma API / public Luma / Eventbrite / Meetup
                    │
                    ▼
       Provider adapters + scrape fallbacks
                    │
                    ▼
     Canonical events + source lineage + taxonomy
          │                 │                │
          ▼                 ▼                ▼
     Events UI        REST API          MCP router
          │
          ▼
      Badge Studio
```

Canonicalization is the boundary between ingestion and consumers: integrations receive stable event identities, while `sources` preserves where each event was found.

## Quick start

The project uses [Bun](https://bun.sh) for local development.

```bash
git clone git@github.com:TheVeller/luma-card.git
cd luma-card
cp .env.example .env
bun install
bun run dev
```

Open `http://localhost:3000` and connect a calendar from **Settings**.

Useful commands:

```bash
bun run dev          # local development
bun run build        # production build
bun run preview      # preview the production build
bun run lint         # ESLint checks
bun run format       # Prettier formatting
bun test             # Bun test suite
```

The browser needs Supabase publishable values. Server-only secrets—such as `SUPABASE_SERVICE_ROLE_KEY`, `APP_ENCRYPTION_KEY`, and AI gateway keys—must be injected by the Cloudflare/Lovable runtime and must never be committed. See [.env.example](.env.example).

## Use the API

Create a read-only token in **Settings → Calendar router API**, then make a request:

```bash
curl \
  -H "Authorization: Bearer luma_sk_..." \
  "https://your-deployment.example/api/v1/events?calendar=all&status=upcoming&limit=50"
```

The API supports:

- `GET /api/v1/calendars` — calendars, groups, provider identity, branding, counts, and sync health.
- `GET /api/v1/events` — canonical or source-level events with filtering and opaque cursor pagination.
- `GET /api/v1/events/{canonicalId}` — one canonical event.
- `GET /api/v1/events/changes` — incremental upserts and delete tombstones.
- MCP endpoints under `/mcp` and `/.mcp/*` for OAuth-backed clients.

Read the complete integration guide in [docs/api.md](docs/api.md) or use the machine-readable contract in [docs/openapi.yaml](docs/openapi.yaml).

## Sync model

Each source performs one complete historical import when possible. Routine maintenance then prioritizes upcoming events and the previous seven days. Historical events remain in the canonical library; use **Full resync** in Settings when an explicit historical reconciliation is needed.

Sync metadata records discovery, imported counts, completeness, last attempt, last successful sync, scope, and failures. Public-source imports can use provider APIs, structured page data, metadata previews, or Firecrawl fallbacks depending on availability.

## Security and data ownership

- API tokens are shown once and stored only as SHA-256 hashes.
- Tokens are scoped to the creating user and can be revoked from Settings.
- REST endpoints require Bearer authentication and enforce read scopes and per-token rate limits.
- Supabase Row Level Security protects user-owned calendars, tags, groups, tokens, and badges.
- Secrets stay server-side; never place them in the client bundle or repository.

## Stack

- **TanStack Start**, React 19, TypeScript, and Vite
- **Tailwind CSS** and shadcn/ui
- **Supabase** for auth, Postgres, RLS, and persistence
- **Cloudflare Workers** through Nitro `cloudflare-module`
- Provider sources: Luma API/public pages, Eventbrite API/public pages, Meetup public/API paths, and Firecrawl fallbacks

## Contributing

Keep `main` deployable because it is connected to Lovable. Make focused commits, run the relevant tests and build before pushing, and never rewrite published history. For API changes, update both [docs/api.md](docs/api.md) and [docs/openapi.yaml](docs/openapi.yaml) in the same change.

## Links

- [API integration guide](docs/api.md)
- [OpenAPI contract](docs/openapi.yaml)
- [Lovable](https://lovable.dev)
- [Repository](https://github.com/TheVeller/luma-card)
