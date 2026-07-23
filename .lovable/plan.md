## Goal

Add three things to the badge generator:
1. **Camera capture** as an alternative to file upload on the badge form.
2. **Field consistency**: replace "Role / Vibe" with **Role / Company** ("e.g. Designer, Acme Inc") — First Name stays.
3. **Per-event gallery**: every rendered badge is saved and shown in a gallery for that event, so people see previous badges and get social proof / FOMO. Requires **Lovable Cloud** for storage + database.

## Phase A — Camera + field label (frontend only)

In `src/routes/e.$eventId.tsx`:

- Rename `role` label to `ROLE / COMPANY` with placeholder `e.g. Designer, Acme Inc`. Keep the state var, just tweak label/placeholder and default (empty).
- Add a **photo source toggle**: two buttons "Upload" / "Take photo".
  - Upload = current `<input type=file>` flow.
  - Take photo = opens a small in-page camera modal using `navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } })`, shows a live `<video>` preview, a "Capture" button that draws the current frame into an offscreen canvas and returns a data URL via `setPhotoDataUrl`. "Retake" resets. Stream is stopped on close/capture.
  - Mobile fallback: also accept the native `<input type="file" accept="image/*" capture="user">` shortcut for browsers without `getUserMedia` permission.
- Show a small thumbnail preview of the selected/captured photo instead of just "✓ photo selected".

No changes to `badge-render.ts` — it already takes a `photoDataUrl` regardless of source.

## Phase B — Enable Lovable Cloud + gallery backend

1. **Enable Lovable Cloud** (`supabase--enable`).
2. **Storage bucket** `badges` (public, read-only for anon) via `supabase--storage_create_bucket`. Public URLs make sharing trivial.
3. **Migration** creating `public.badges`:
   ```
   id uuid pk default gen_random_uuid()
   event_id text not null           -- Luma event id, e.g. evt-xxx
   first_name text not null
   role text
   image_path text not null          -- storage path inside `badges` bucket
   created_at timestamptz default now()
   ```
   Plus:
   - GRANTs (SELECT to anon+authenticated, INSERT to anon+authenticated, ALL to service_role).
   - RLS enabled.
   - Policies: `SELECT` open to anon+authenticated (public gallery); `INSERT` open to anon+authenticated with a light length check on `first_name`, `role`, `event_id`.
   - Index on `(event_id, created_at desc)`.
4. **Storage RLS** on `storage.objects` for the `badges` bucket: public SELECT, INSERT allowed for anon+authenticated (path must start with the event id so one event can't overwrite another: `bucket_id = 'badges' AND (storage.foldername(name))[1] = event_id_from_path`). Simpler acceptable variant: allow anon INSERT under any path in `badges`.

## Phase C — Save on render + gallery UI

In `src/routes/e.$eventId.tsx`, after `renderBadge` succeeds:

1. Convert canvas to blob, upload to `badges/${eventId}/${crypto.randomUUID()}.png` using the browser `supabase` client.
2. Insert a row into `public.badges` with `event_id`, `first_name`, `role`, `image_path`.
3. Invalidate the gallery query so the new badge appears immediately.

Gallery section: new component `EventBadgeGallery` rendered below the preview (full width on the event page).

- Uses TanStack Query + a public server fn `listBadgesForEvent({ eventId, limit: 24 })` in `src/lib/badges.functions.ts` that queries with the server publishable client (narrow `TO anon` SELECT policy already covers this) and returns `{ id, firstName, role, publicUrl, createdAt }` — resolving each `image_path` to a public storage URL server-side.
- Grid of square thumbs (`aspect-square`, `object-cover`), name + role caption. Click opens the full badge in a lightbox with Share/Download.
- Empty state: "Be the first to make a badge for this event."

## Notes & non-goals

- No auth added. Anyone visiting the event page can post a badge. Acceptable for the current "growth loop" goal; we can gate later.
- No moderation/reporting UI yet — flag as a TODO if we want it.
- Camera permission is best-effort; on denial we fall back silently to the file input.
- Field label change ("Company") does not change the badge canvas layout — role text still renders as-is.

## Technical section

- Files touched: `src/routes/e.$eventId.tsx` (fields, camera modal, save-on-render, gallery mount), new `src/components/CameraCapture.tsx`, new `src/components/EventBadgeGallery.tsx`, new `src/lib/badges.functions.ts`, new migration in `supabase/migrations/`.
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` for client uploads; `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` for the read server fn.
- Upload path convention: `${eventId}/${uuid}.png` — makes per-event listing trivial and enforceable via storage RLS.
