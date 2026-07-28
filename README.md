# luma-card — Event Router & Badge Studio

Aggregates Luma, Eventbrite, and Meetup sources into a canonical event router,
then generates personalized, shareable badge images with reusable brand kits
for owned events. Built and kept in sync with
[Lovable](https://lovable.dev); every change pushed to `main` syncs back into the
Lovable editor.

## Development

This project uses **[Bun](https://bun.sh)** as the package manager.

```sh
git clone git@github.com:TheVeller/luma-card.git
cd luma-card
cp .env.example .env   # fill in Supabase publishable values
bun install
bun run dev
```

Scripts: `bun run dev` · `bun run build` · `bun run preview` · `bun run lint` · `bun run format`.

Server-only secrets (`SUPABASE_SERVICE_ROLE_KEY`, `APP_ENCRYPTION_KEY`,
AI gateway keys) are injected at the Cloudflare/Lovable runtime — never commit them.
See `.env.example`.

## API

The app exposes a user-scoped Calendar Router API for integrations:

- `GET /api/v1/calendars`
- `GET /api/v1/events`
- MCP router endpoints under `/mcp` and `/.mcp/*`

See [docs/api.md](docs/api.md) for authentication, response schemas,
pagination, error codes, and TypeScript examples.

## Built with

- **TanStack Start** (React 19 + TypeScript, Vite)
- **Tailwind CSS** + shadcn/ui
- **Supabase** — auth + Postgres (RLS)
- **Cloudflare Workers** — deploy target (Nitro `cloudflare-module`)
- Event sources: Luma public/API, Eventbrite API/public links, Meetup GraphQL/public links, and Firecrawl fallbacks
