# luma-card — Luma Badge Studio

Reads your [Luma](https://lu.ma) event calendars and generates personalized,
shareable badge images per event. Built and kept in sync with
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

## Built with

- **TanStack Start** (React 19 + TypeScript, Vite)
- **Tailwind CSS** + shadcn/ui
- **Supabase** — auth + Postgres (RLS)
- **Cloudflare Workers** — deploy target (Nitro `cloudflare-module`)
- Calendar sources: Luma public API + Firecrawl scraping
