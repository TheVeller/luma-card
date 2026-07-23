## Objetivo

Convertir la app en multi-tenant: cada usuario entra con Google, guarda su propia **Luma API key**, y ve solo sus eventos + su galería. Además: auto-detectar el **nombre y logo del calendario** (ya no mostrar el ID) y arreglar el **AI style analysis** que dejó de funcionar tras migrar a Vercel AI Gateway.

---

## 1) Auth con Google (Lovable Cloud)

- Activar Google sign-in gestionado por Lovable Cloud (default managed OAuth, sin BYOK).
- Nuevo layout `_authenticated` que redirige a `/auth` cuando no hay sesión.
- Página `/auth`: card con **Continuar con Google** (usa `lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin })`).
- Header con avatar/email + botón "Sign out".
- Rutas protegidas: `/` (dashboard tras login), `/events`, `/e/$eventId`. Landing pública queda en `/auth` (o rediseñamos `/` como landing pública con CTA sign in — recomendado, para preservar shareability).

## 2) Luma API key **por usuario** (backend)

- Tabla `public.user_luma_keys` en Lovable Cloud:
  ```
  user_id uuid PK  (fk auth.users, on delete cascade)
  api_key_ciphertext text NOT NULL
  calendar_id text
  calendar_name text
  calendar_slug text
  calendar_avatar_url text
  calendar_url text
  updated_at timestamptz
  ```
  RLS: solo el owner puede leer/escribir su fila; `service_role` full.
- Cifrado AES-256-GCM en el servidor con `APP_ENCRYPTION_KEY` (autogenerada, 32 bytes base64) — nunca guardar la key en texto plano.
- Server functions (`requireSupabaseAuth`):
  - `saveLumaKey({ apiKey })` → valida contra `/calendar/get`, cifra, upsert (guarda también name/slug/avatar).
  - `getLumaConfig()` → `{ configured, calendar: {name, slug, avatarUrl, url} | null }`.
  - `deleteLumaKey()`.
- Refactor `src/lib/luma.server.ts`: `fetchAllEvents(apiKey)` / `fetchEvent(apiKey, id)` / `fetchCalendar(apiKey)` reciben la key como parámetro (no leer `process.env.LUMA_API_KEY` global).
- Refactor `src/lib/luma.functions.ts`: cada server fn resuelve la key del usuario autenticado antes de llamar a Luma.
- Nuevo secret runtime: seed inicial — el `LUMA_API_KEY` existente **se importa a la fila de `ivelasquezfr@gmail.com`** la primera vez que se loguee (una sola migración one-shot). Después el env var se puede ignorar.

## 3) Onboarding + header con nombre/logo del calendario

- Nueva ruta `/settings` (o modal en dashboard) para pegar la Luma API key. Al guardar se valida llamando a `GET /calendar/get` (comprobado: devuelve `name`, `slug`, `avatar_url`, `url`).
- Si el usuario no tiene key configurada → redirect a `/settings` con mensaje.
- Header global (en `_authenticated`): logo del calendario + nombre (ej. **Hack0 Community**) en vez del ID de calendario. Link a `/settings` para reemplazar la key.
- El header pasa a las páginas `events` y `e/$eventId` (hoy dicen "· LUMA BADGE STUDIO", ahora "· HACK0 COMMUNITY" con avatar).

## 4) Aislar datos por usuario

- Tabla `public.badges` ya existe. Añadir columna `user_id uuid` (nullable para retro-compat, luego se puede filtrar por usuario si el owner del evento coincide). RLS: insert por `authenticated` con `user_id = auth.uid()`; select público sigue permitido para la galería del evento (mantiene el loop social — badges de otras personas del mismo evento son visibles).
- La galería `EventBadgeGallery` sigue mostrando todos los badges del evento; el "mis badges" se filtra por `user_id`.

## 5) Fix AI style analysis

Actualmente falla probablemente porque `Output.object` + `google/gemini-2.5-flash` sobre openai-compatible con Vercel Gateway no siempre respeta `response_format: json_schema` en modelos Gemini vía ese path. Diagnóstico + fix:
- Añadir logging del error real vía `stack_modern--server-function-logs` para confirmar la causa.
- Fix: usar `generateObject` (en vez de `generateText` + `Output.object`) con `mode: "json"` sobre Gemini, o cambiar el modelo a `openai/gpt-4o-mini` / `openai/gpt-5-mini` para análisis multimodal donde `json_schema` es sólido. Preferencia: mantener Gemini si funciona; fallback OpenAI si no.
- Mantener el fallback existente `NoObjectGeneratedError` → `JSON.parse(error.text)` → `DEFAULT_STYLE_SPEC`.

## 6) Restricción de uso (fase 1)

- El usuario pide que "cualquiera pueda usar la app, pero por ahora solo yo (ivelasquezfr@gmail.com) uso la Luma key configurada actualmente". Con la refactor:
  - Todos pueden hacer sign up con Google.
  - Cada uno debe configurar **su propia** Luma API key en `/settings`.
  - La key actual queda asociada solo a `ivelasquezfr@gmail.com` en el seed inicial.
- No hay allowlist ni bloqueos adicionales — modelo self-serve.

---

## Detalles técnicos

- Providers: mantener Vercel AI Gateway para chat/analysis; Lovable AI para image gen (ya está así).
- Encryption module: `src/lib/crypto.server.ts` con `encryptString`/`decryptString` (AES-256-GCM, IV+tag+ct base64).
- Migrations (una sola, ordenada): `user_luma_keys` + `badges.user_id` + GRANTs + RLS + policies.
- Google sign-in flow ya soporta iframes de Lovable via `@lovable.dev/cloud-auth-js`; usar exactamente el patrón documentado.
- No tocar `src/integrations/supabase/*` autogenerado. Middleware `attachSupabaseAuth` ya está registrado.

## Fuera de alcance (no ahora)

- Rotación de key, revocación, admin dashboard, uso compartido de una key entre miembros de un workspace.
- Login con métodos distintos a Google (se puede añadir email/password luego).
- Phase 2 (scraping sin API key).

---

## Riesgos

- Si Vercel Gateway sigue rompiendo structured output con Gemini, caemos a OpenAI para análisis (misma calidad multimodal, ligeramente más caro).
- La primera vez cualquier usuario ve `/settings` vacío — hay que dejar copy claro con dónde obtener la Luma API key (https://docs.lu.ma/reference/getting-started-with-your-api).

## Checklist ejecución

1. Enable Google auth + configure_social_auth.
2. Crear migración: `user_luma_keys`, `badges.user_id`, RLS + grants.
3. `src/lib/crypto.server.ts` + `APP_ENCRYPTION_KEY` (generate_secret 32 bytes base64).
4. Refactor `luma.server.ts` / `luma.functions.ts` para recibir key por usuario + añadir `fetchCalendar`.
5. Rutas: `/auth`, `_authenticated` layout, `/settings`, dashboard con header calendario, protección de `/events` y `/e/$eventId`.
6. Seed one-shot: al login de `ivelasquezfr@gmail.com`, migrar el env `LUMA_API_KEY` a su fila cifrada.
7. Fix `style-analyze` con logs + `generateObject` / fallback OpenAI.
8. Verificar end-to-end con Playwright (login → settings → events con header "Hack0 Community" → generar badge → galería propia).
