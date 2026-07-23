## 1. Compact sort selector, moved next to Export

- Remove the standalone Nearest / Newest / Oldest pill group from the filters row in `src/routes/_authenticated/events.tsx`.
- Add a small dropdown (icon + label, ~90 px wide) next to the Export button in the top-right actions row:
  - Default label: "Sort: Nearest".
  - Menu items: Nearest (default), Newest, Oldest.
  - Same visual style as the Export dropdown (hairline pill, glass menu).
- Keep the sort logic unchanged; only the UI moves and shrinks.

## 2. Fix "Style analysis failed on both primary and fallback models"

Root cause confirmed from dev-server logs: the Vercel AI Gateway is returning `400 invalid_request_error, param: response_format`. The AI SDK's OpenAI-compatible provider is still emitting a `response_format` field on requests with image parts, which Vercel's Gemini route rejects.

Fixes, in order:
- Stop routing through `@ai-sdk/openai-compatible` for this call. Replace `generateText` with a direct `fetch` POST to Vercel's OpenAI-compatible chat endpoint (`https://ai-gateway.vercel.sh/v1/chat/completions`) built by hand so we control the body exactly — no `response_format`, standard OpenAI multimodal `content` blocks (`type: "text"` + `type: "image_url"` with `image_url.url`).
- Data-URL the cover before sending: cover URLs pass through `/api/public/image` today for CORS on canvas, but the model can fetch remote URLs directly — we'll pass the raw Luma CDN URL as `image_url.url`.
- Model choice: primary `google/gemini-2.5-pro`, fallback `google/gemini-2.5-flash`. Log both statuses + response bodies on failure.
- Keep the JSON-in-prompt + `extractJson` + `StyleSpecSchema.safeParse` path; surface a clearer error to the UI when both models fail (include HTTP status).
- Verify by hitting `↻ Re-detect` on an event and reading dev-server logs.

## 3. Light mode + dark/light toggle

- Extend `src/styles.css`:
  - Give `:root` the light palette (cream `#f7f6f1` bg, deep charcoal text, subtle warm accent — Luma light feel).
  - Move current dark values into `.dark { ... }` so `<html class="dark">` activates dark mode.
- Add a `ThemeProvider` (small React context) + `useTheme` hook in `src/components/ThemeProvider.tsx`:
  - Persists to `localStorage("theme")` with values `light | dark | system`.
  - Applies/removes `.dark` on `<html>`; respects `prefers-color-scheme` when `system`.
  - Reads initial value inside `useEffect` to avoid SSR hydration mismatch (default to `dark` during SSR to preserve current look).
- Wrap the app in `ThemeProvider` inside `src/routes/__root.tsx`.
- Add a compact icon toggle button (sun/moon) in the authenticated header (`src/routes/_authenticated/route.tsx`), sitting next to the calendar switcher.
- The badge canvas keeps its per-event palette — theme only affects the app shell, not the generated badge.

## 4. Historical seed uses the real PNGs from `event-badge-history`

Today `seed-history.ts` re-renders each badge locally via `renderBadge`, which produces mismatched output (wrong palette on Cursor, off fonts, overlaps). The repo already ships the canonical PNGs. Switch the admin seed to use those directly.

- Copy the 6 code-brew-bog PNGs into the project as static assets: `src/assets/history/era1-code-brew.png` … `era6-codebrew-sv.png` (fetched from `raw.githubusercontent.com/crafter-station/event-badge-history/main/badges/code-brew-bog/...`).
- Rewrite `src/lib/seed-history.ts`:
  - Replace `HISTORIC_EVENT_NAMES` with a `HISTORIC_ERAS` table encoding each era's canonical event name, date hint, palette, and the imported asset URL:
    ```ts
    { id: "era1", name: "Code Brew (original)", aliases: ["Code Brew"], asset: era1 }
    { id: "era2", name: "v0 / Zero to Agent", aliases: ["v0 Zero-to-Agent", "Zero to Agent"], asset: era2 }
    { id: "era3", name: "The GTM Hackathon", aliases: ["GTM Hackathon"], asset: era3 }
    { id: "era4", name: "Cursor Meetup", aliases: ["Cursor Meetup Bogotá"], asset: era4 }
    { id: "era5", name: "Cursor Buildathon El Salvador 2026", aliases: ["Cursor Buildathon", "Buildathon SV"], asset: era5 }
    { id: "era6", name: "Code Brew El Salvador", aliases: ["Code Brew SV"], asset: era6 }
    ```
  - Improve `scoreMatch`: use max(canonical, aliases) instead of a single target, keep the token-set fallback, raise the acceptance threshold to `0.6`.
  - For each match, fetch the imported PNG (`fetch(asset)` → blob) and upload directly to `storage/badges/{eventId}/{uuid}.png` with `first_name = "Ignacio Velásquez"`, `role = "Founder, GPT Chain"`, `user_id = auth.uid()`.
  - Drop the `analyze` + `renderBadge` + font-loading path from this file — the seed no longer analyzes or renders; the `analyze` parameter and `SeedProgress.rendering` phase remain compatible but do nothing.
- The gallery route already reads from `badges` + storage, so seeded rows show up unchanged, but now with the real, well-composed PNGs.
- Result on Ignacio's account: each matched event gets the canonical, correctly-styled historical badge (Cursor palette on Cursor events, red/black on Code Brew, etc.), no more Luma-blue leaks.

## Technical details

Files changed:
- `src/routes/_authenticated/events.tsx` — sort UI relocation.
- `src/lib/style-analyze.functions.ts` — swap to raw `fetch` POST; drop `@ai-sdk/openai-compatible` for this call site.
- `src/styles.css` — light theme in `:root`, dark theme in `.dark`.
- `src/components/ThemeProvider.tsx` — new file.
- `src/routes/__root.tsx` — wrap with `ThemeProvider`.
- `src/routes/_authenticated/route.tsx` — theme toggle button.
- `src/lib/seed-history.ts` — real PNGs, better matcher.
- `src/assets/history/*.png` — 6 canonical historical badges.

Out of scope for this iteration:
- Adding `she-ships` / `vibecode-fest` historical PNGs (only `code-brew-bog` matches the current app's target — we can extend later if desired).
- Retraining the runtime badge renderer to imitate era palettes (the seed uses the pre-rendered PNGs, so no renderer change needed for correctness on the admin-seeded gallery).
