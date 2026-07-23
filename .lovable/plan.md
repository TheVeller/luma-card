Improve badge generation end-to-end: sharper AI style detection, guaranteed non-overlapping layout, gallery clear + manual delete, chat that already knows the event on turn 1, and a Templates section built from the 6 historical eras so any style can be re-applied to any event.

## 1 · Sharper AI style detection (`src/lib/style-analyze.functions.ts`)

Current model returns a bucket + rough palette, but the palette often ignores what the cover actually contains.

Changes:
- Keep the raw `fetch` path to the Vercel gateway (works today).
- Rewrite the prompt: return **two** things — the classifier bucket **and** an evidence-first palette (`dominant`, `secondary`, `accent`, `text`, `surface`, `bg`) with each color justified by ~1 sentence, then fold that into the existing `StyleSpec` shape.
- Add explicit rules: don't invent hues absent from the cover; pick the accent from the highest-chroma pixel family, not the largest area; if the cover is truly monochrome, accent = darkest ink; require WCAG-legible `text on bg` (compute contrast, retry once with a corrected text color if below 4.5:1).
- Send the cover **both** as a URL and as a base64 fallback in case Gemini refuses the CORS URL; keep the `gemini-2.5-pro → gemini-2.5-flash` fallback ladder.
- Extract a small on-device swatch (existing `extractAccent` logic, generalized to top-5 buckets) and pass it in the prompt as "pixel evidence"; the model must reconcile its choice with that evidence.

## 2 · Badge layout: zero overlaps, dynamic packing (`src/lib/badge-render.ts`)

Rewrite the layout as a single-column vertical stack with **measured** band heights and hard gaps, so nothing collides regardless of name length, wrap depth, or role length.

Sections top→bottom, each with a computed `y` and a fixed `gap` after:
1. Frame (margin + inner hairline).
2. Header block: kicker → wrapped headline (max 3 lines, auto-shrink) → meta row (city + date, right-aligned; falls to next line if width < sum).
3. Seal (cover as circle) — anchored to the **header block's** top-right, sized to fit the reserved column; if headline would collide, seal moves below meta row instead of into it.
4. Photo square — centered, size clamped to `W − PAD·2` and to remaining budget.
5. Caption (date line) — centered under photo.
6. Name band (auto-shrink + wrap up to 2 lines).
7. Role line (auto-shrink, single line, ellipsis).
8. Divider.
9. Scan block: left column (SCAN → / description / wrapped URL) and right column (QR). QR width is **subtracted** from left column's `maxWidth` so URL never runs under the QR.
10. Footer.

Then the renderer computes total content height. If it exceeds `H − MARGIN·2`, it uniformly reduces the photo size (in 20px steps) until it fits — never squeezes text or lets bands overlap. Every `fillText` is preceded by a rect measurement, so debug builds can assert no two bounding boxes intersect (added assertion in a dev-only guard).

## 3 · Gallery wipe + manual delete

**DB migration** (`badges` policies + storage):
- Add DELETE policy on `public.badges` for `authenticated` where `auth.uid() = user_id`.
- Add storage.objects DELETE policy on the `badges` bucket for the owner (via joining `badges.image_path`).

**Wipe existing 9**: server function `wipeMyBadges()` — auth-only, deletes all `badges` rows for the current user + removes their storage objects. Exposed as a button on `/gallery` behind a confirm dialog labeled "Clear my gallery (9)".

**Manual delete per badge**: 
- Add `deleteBadge({ id })` server function (auth-only, owner-scoped, deletes DB row + storage object).
- Add a trash icon on each gallery tile and inside the lightbox on `/gallery` and `/e/$eventId`'s `EventBadgeGallery`.
- Both invalidate the `["all-badges"]` and `["badges", eventId]` query keys.

## 4 · Chat context on turn 1 (`src/components/BadgeChat.tsx` + `src/routes/api/chat-badge.ts`)

Today the chat only knows `spec` + `eventName`. It should also know the cover analysis and event metadata immediately, so the first user turn can be as short as "make it warmer" and the model already has full context.

Changes:
- `BadgeChat` receives `eventContext`: `{ name, date, city, description, coverUrl, initialSpec, styleEvidence }` (styleEvidence = the palette + mood from the analyzer). Passed straight through in the transport body.
- Server route embeds `eventContext` into the system prompt as a compact briefing block (name / date / city / cover URL / 200-char description / current spec + evidence).
- Seed one **assistant** starter message client-side (no model call): "I've analyzed <event>. It reads as <mood>, palette <bg / accent / text>. Try: 'make it more editorial', 'add a serif heading', 'shift to warm cream'."
- Keep the multimodal image part in the first message: attach the cover as `image_url` in the initial system-adjacent user turn (once, at conversation init), so the model can look at the art itself if asked "why this palette?".

## 5 · Templates system (new)

Six historical eras are already bundled as PNGs. Promote them from a one-shot seed to a first-class **template library** any user can browse and apply.

**DB migration** — new table `public.templates`:
- `id uuid pk`, `slug text unique`, `name text`, `description text`, `style_spec jsonb`, `preview_path text` (path in `badges` bucket or a new `templates` bucket), `source_url text` (github link), `is_system boolean`, `created_by uuid`, `created_at`.
- Grants + RLS: public SELECT for system templates and each user's own, authenticated INSERT/UPDATE/DELETE only on their own rows, service_role full.

**Storage**: reuse `badges` bucket under `templates/` prefix (already public), or create a `templates` bucket via `storage_create_bucket` — will use existing bucket to avoid a new one.

**Server functions** (`src/lib/templates.functions.ts`): `listTemplates`, `createTemplate` (from a saved badge or upload), `deleteTemplate` (own only), `applyTemplate({ templateId })` returns its `StyleSpec`.

**Seed migration**: inserts 6 rows (era1–era6) with hand-tuned `style_spec` derived from each cover, `preview_path` uploaded from `src/assets/history/*.png` (uploaded once via a one-shot server function on first admin visit, or via `supabase--storage_upload` at migration time), `is_system=true`.

**UI**:
- New route `src/routes/_authenticated/templates.tsx`: grid of templates with preview, name, palette swatches, "Apply to current event" (opens event picker), and for own templates a delete button.
- On `/e/$eventId`: add a "Templates" tab next to the AI style panel — one click applies a template's `StyleSpec` to the current preview without touching the AI analysis (user can re-detect anytime).
- Header nav gets a "Templates" link between Gallery and Settings.

Existing `src/lib/seed-history.ts` becomes a thin wrapper that (a) ensures the 6 system templates exist and (b) still allows `ivelasquezfr@gmail.com` to bulk-materialize the historical badges into their personal gallery.

## Technical details

- **Style contrast helper**: add `wcagContrast(fg, bg)` in `style-spec.ts`; used inside `normalizeStyleSpec` to auto-correct text color when contrast < 4.5.
- **Layout invariants**: `renderBadge` returns `{ canvas, bands }` in dev where `bands` is an array of `{ name, x, y, w, h }`; a `assertNoOverlap(bands)` runs in dev to catch regressions.
- **Delete flow**: single `deleteBadgeIds(ids: string[])` server function used by both wipe and per-row delete; deletes storage objects first, then DB rows.
- **Templates seed**: migration writes rows; a small server function `ensureSystemTemplatePreviews()` uploads the 6 bundled PNGs to storage on first call (idempotent by `slug`).
- **Chat body size**: cover base64 is only sent on the FIRST turn of a conversation; subsequent turns include only the compact evidence block to keep tokens low.

## What stays untouched

- Auth, Luma key encryption, calendar switcher, theme toggle, sort dropdown — all untouched.
- Event list page, export dataset — untouched.
- OG images / metadata — untouched (leaf routes already correct).
