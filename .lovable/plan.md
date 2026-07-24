
## 1. Gallery: show full badge, not a square crop

Badges render at 1080×1600 (27:40) but the gallery grids force `aspect-square` + `object-cover`, so ~30% of each badge (name/QR area) is cut off.

- `src/components/EventBadgeGallery.tsx` and `src/routes/_authenticated/gallery.tsx`:
  - Grid tiles → `aspect-[27/40]` with `object-contain` on a `bg-surface-2` backdrop, so every badge fits fully.
  - Slightly reduce column count on `lg` (5 → 4) to compensate for taller tiles.
  - Modal preview: keep `object-contain`, cap by height (`max-h-[85vh]`) instead of width so tall badges don't overflow.

## 2. Save & reuse style presets per event

Every render should snapshot the `StyleSpec` used, so returning to an event surfaces prior generations as one-click presets.

- New table `event_style_presets` (migration):
  - `id`, `user_id` (fk auth.users), `event_id text`, `label text`, `style_spec jsonb`, `created_at`.
  - RLS: owner can select/insert/delete their rows. Grants for `authenticated` + `service_role`.
  - Unique on `(user_id, event_id, hash(style_spec))` to avoid duplicates when re-rendering with the same theme (implemented via a small `spec_hash` text column).
- New server fns in `src/lib/event-style-presets.functions.ts`:
  - `listEventPresets({ eventId })` → recent-first.
  - `saveEventPreset({ eventId, styleSpec, label? })` idempotent via `spec_hash`.
  - `deleteEventPreset({ id })`.
- `src/routes/_authenticated/e.$eventId.tsx`:
  - On successful `generate()` (after `renderBadge`), call `saveEventPreset` with the current spec.
  - New "Previous styles for this event" strip above the shared Templates strip, showing swatch+font tiles that call `setSpec(preset.styleSpec)` on click. Delete-on-hover ✕.
  - Initial `useEffect`: if presets exist for the event, apply the most recent one instead of running `runAnalyze` automatically (user can still hit ↻ Re-detect). Otherwise run analyze as today.

## 3. AI fonts actually render on the canvas

Symptom: analyzer picks e.g. "IBM Plex Mono" / "Playfair Display" but the badge keeps rendering in the system fallback. Root causes:

- `loadGoogleFontPair` only awaits two specific `document.fonts.load(...)` sizes; canvas uses weights (400/700/900) and sizes (14–104px) that aren't preloaded, so `ctx.font` falls back on first draw.
- Some AI/Firecrawl-picked families aren't on Google Fonts (e.g. `Helvetica Neue`, `SF Pro`); we already alias, but the final `spec.fonts.*` isn't validated before rendering.

Changes in `src/lib/google-fonts.ts` + `src/lib/badge-render.ts`:

- Validate family against an allow-list of loadable Google families (already used in `style-analyze`). If not on the list and no alias applies, fall back to the default pair and mark `fonts.source = 'default'`.
- Expand `loadGoogleFontPair` to preload every weight×representative-size the renderer uses (`400/700/900` heading, `400/500/700` body, at 16/22/40/90 px) and use `document.fonts.check(...)` after `await document.fonts.ready` to confirm each combo, retrying once, then downgrading to fallback when still unavailable.
- Await `loadGoogleFontPair` inside `renderBadge` (defensive), not only in `generate()`, so the chat/preset flows that re-render also get correct fonts.
- Quote families with spaces uniformly and reject empty strings.

## 4. English-only home page

`src/routes/index.tsx` still has Spanish copy ("Cada usuario trae su propia Luma API key…", "Pega tu Luma API key…", etc.). Translate the hero paragraph and the three step cards to English, matching the tone of the rest of the app. No layout changes.

Also sweep `src/routes/phase-2.tsx` for any remaining Spanish (quick pass; keep meaning).

## 5. Event link + copy button under titles

Everywhere we surface an event title, add a small row underneath with the Luma URL as a hyperlink plus a copy icon button.

- `src/routes/_authenticated/e.$eventId.tsx`: below `<h1>{event.name}</h1>` add:
  - `<a href={event.url} target="_blank" rel="noreferrer">{prettyUrl}</a>` (truncated) + a `⧉` copy button that writes `event.url` to clipboard with a 1s "Copied" state.
- `src/routes/_authenticated/events.tsx` card: keep the card link, but add a small copy button on hover in the corner that copies the event URL without navigating.
- `src/components/EventBadgeGallery.tsx` and `src/routes/_authenticated/gallery.tsx` modals: show event URL + copy under the event name.

Copy helper lives in `src/lib/utils.ts` (`copyToClipboard(text)` with `navigator.clipboard.writeText` + fallback + toast-less local state).

## Technical notes

- Migration structure follows the mandatory `CREATE TABLE → GRANT → ENABLE RLS → CREATE POLICY` order. No `anon` grant on `event_style_presets` (all policies scoped to `auth.uid()`).
- `spec_hash` = stable JSON of `{style, palette, fonts.heading, fonts.body}` hashed with `SubtleCrypto.digest('SHA-1')` client-side before insert to keep the migration free of pg extensions.
- Auto-applied presets should not overwrite user changes: the preset auto-apply runs only on first mount for an event, guarded by a `hasHydratedPreset` ref.
- Font validation list is exported from `google-fonts.ts` and imported by both the loader and `style-analyze.functions.ts` to guarantee the AI never returns a non-loadable family.
- Gallery images already come from public storage; `object-contain` needs no CORS changes.

## Out of scope

- No changes to badge layout math, chat, Firecrawl, or Luma ingestion.
- No new share targets.
