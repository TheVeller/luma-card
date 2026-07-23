
# Luma-Driven Event Badge Generator

Un generador de tarjetas/badges estilo `code-brew-bog` (foto + stamp filatélico + QR), pero donde el branding (color, logos, título, QR link, arte del evento) se compone dinámicamente desde eventos de **Luma Calendar API**. Fase 1: Luma API. Fase 2 (solo documentada): scraping con Firecrawl/Playwright.

---

## Fase 1 — Alcance a construir ahora

### 1. Flujo de usuario

1. Pantalla "Setup" (`/`): el usuario pega su **Luma Calendar API Key** (`x-luma-api-key`) y opcionalmente un `calendar_api_id`. Se guarda como secret (Cloud) — no en el frontend.
2. Pantalla "Eventos" (`/events`): lista todos los eventos del calendario con su cover art, nombre, fecha y link.
3. Página del evento (`/e/$eventId`): réplica del generador de `code-brew-bog` pero tematizada:
   - Paleta y tipografía derivadas del arte del evento (color dominante del cover como acento principal).
   - Header/seal reemplaza el "El Salvador · Code Brew" con el nombre del evento + logo/cover del evento.
   - Los stamps del sponsor pasan a ser configurables por evento (por ahora: stamp del evento + un stamp genérico "Powered by Luma").
   - QR apunta al `url` del evento en Luma (reemplaza el link de WhatsApp).
   - Flujo: usuario sube/toma foto → se compone el badge con Satori → descarga PNG.
4. Playground (`/e/$eventId/playground`): idéntico al del repo original, útil para ajustar posiciones.

### 2. Integración Luma

- Endpoint base: `https://api.lu.ma/public/v1`.
- Header: `x-luma-api-key: <API_KEY>`.
- Endpoints usados:
  - `GET /calendar/list-events` → lista de eventos del calendario dueño de la API key.
  - `GET /event/get?event_api_id=...` → detalle (cover_url, name, url, start_at, description).
- Todas las llamadas van desde **server functions** de TanStack (`createServerFn`), nunca desde el browser, para no exponer la API key.
- La API key se guarda con `add_secret` como `LUMA_API_KEY` (input del usuario en la pantalla Setup dispara el flujo `add_secret`).

### 3. Port del repositorio `crafter-station/code-brew-bog`

El repo es Next.js App Router + Satori + sharp + Drizzle + Vercel Blob. Se porta a nuestro stack (TanStack Start + Vite + Cloudflare Workers + Lovable Cloud) manteniendo la **misma composición visual**:

| Origen (Next.js)                               | Destino (TanStack Start)                                             |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| `app/page.tsx` (flujo captura + preview)       | `src/routes/e.$eventId.tsx`                                          |
| `app/playground/page.tsx`                      | `src/routes/e.$eventId.playground.tsx`                               |
| `app/api/generate-badge/route.ts` (POST)       | `src/routes/api/generate-badge.ts` (server route, POST)              |
| `app/api/generate/route.ts`                    | `src/routes/api/generate.ts` (server route)                          |
| `app/api/gallery/route.ts`                     | `src/routes/api/gallery.ts`                                          |
| `app/api/check-fingerprint/route.ts`           | `src/routes/api/check-fingerprint.ts`                                |
| `lib/generate-badge.tsx` (`renderBadgeToBuffer`) | `src/lib/generate-badge.server.tsx`                                 |
| `lib/fingerprint.ts`, `lib/ratelimit.ts`       | `src/lib/fingerprint.ts`, `src/lib/ratelimit.ts`                     |
| `components/badge-preview.tsx`                 | `src/components/badge-preview.tsx`                                   |
| `public/*.png / *.svg` (seals, stamps, brand)  | `src/assets/brand/*` (copiados tal cual como fallback default)       |
| `db/schema.ts` (Drizzle + Postgres)            | Reemplazado por tablas Lovable Cloud (`events_cache`, `badges`)      |
| Vercel Blob                                    | Lovable Cloud Storage bucket `badges`                                |

**Cambio crítico de runtime**: el repo usa `sharp` para convertir SVG→PNG. `sharp` no funciona en Cloudflare Workers (native addon). Se reemplaza por `@resvg/resvg-wasm` (WASM, soportado en Workers). El resto (`satori`, `satori-html`, Geist fonts) funciona igual.

### 4. Theming dinámico por evento

Al abrir `/e/$eventId`, el loader (server fn) trae el evento desde Luma y calcula un `EventTheme`:

```ts
type EventTheme = {
  eventId: string;
  name: string;
  url: string;          // deep link Luma → QR
  coverUrl: string;     // hero + seal
  accentColor: string;  // derivado del cover (color dominante server-side)
  startAt: string;
  description?: string;
};
```

- Color dominante extraído server-side con `colorthief`/`vibrant` (JS puro, edge-safe) sobre el cover_url.
- Ese `accentColor` reemplaza `#2970EF` (Code Brew blue) en `generate-badge.server.tsx`.
- El "seal" central se sustituye por el cover del evento (recortado circular en Satori).
- El caption del stamp muestra `EVENT_NAME · DATE`.
- El QR se genera apuntando a `theme.url`.

### 5. Persistencia (Lovable Cloud)

Se habilita Lovable Cloud para:
- Cachear eventos Luma (`events_cache`: `event_id`, `payload jsonb`, `fetched_at`).
- Guardar badges generados (`badges`: `id`, `event_id`, `image_url`, `created_at`, `fingerprint`) para galería opcional por evento.
- Storage bucket `badges` para los PNG generados.

### 6. Pantallas y rutas finales

```text
/                       Setup (pegar Luma API key)
/events                 Grid de eventos del calendario
/e/$eventId             Generador de badge del evento (foto → PNG)
/e/$eventId/playground  Ajuste de posiciones/composición
/e/$eventId/gallery     Badges generados para ese evento
/api/generate-badge     POST → Satori + resvg-wasm → PNG buffer
/api/gallery            GET  → lista badges por evento
```

### 7. Detalles técnicos

- Server fns: `getLumaEvents`, `getLumaEvent(eventId)`, `computeEventTheme(eventId)`.
- Renderizado de badge: server route (raw HTTP) porque devuelve `Response` binario PNG.
- `sharp` → **no instalar**. Usar `@resvg/resvg-wasm` con el `.wasm` embebido.
- Fonts Geist: se cargan como `ArrayBuffer` dentro de la server route (import estático del `.ttf`).
- Secret `LUMA_API_KEY` leído dentro del `.handler()`, nunca a nivel de módulo.
- Todas las llamadas fetch a `api.lu.ma` desde server fns; el frontend solo consume DTOs.

---

## Fase 2 — Solo documentación (no se implementa aún)

Objetivo: dejar de depender de la Luma API y aceptar cualquier URL de evento o calendario Luma.

Documento `docs/phase-2-scraping.md` con:

1. **Estrategia**:
   - Frontend: input de "Pega URL de evento o calendario Luma".
   - Backend: server route `/api/ingest-luma` que decide entre Firecrawl (default, hosted, edge-friendly) o Playwright (self-host, para casos que requieran interacción).
2. **Firecrawl**:
   - Conector `firecrawl` (Lovable connector) o secret `FIRECRAWL_API_KEY`.
   - `POST /v1/scrape` con `formats: ["json"]` y un `jsonOptions.schema` que extraiga `name`, `cover_url`, `start_at`, `location`, `description`, `host`, `url`.
   - Para calendarios: `POST /v1/crawl` sobre `lu.ma/<calendar>` con `includePaths: ["/e/**"]`.
3. **Playwright fallback**:
   - Solo si Firecrawl no captura eventos privados o requieren cookies; corre fuera del Worker (no compatible con edge runtime).
4. **Contrato unificado**: ambos backends devuelven el mismo `EventTheme` que ya usa la Fase 1, para que el generador de badges no cambie.
5. **Riesgos**: ToS de Luma, rate limits, cover_url expira, contenido detrás de auth.
6. **Migración**: la Fase 1 seguirá funcionando; Fase 2 solo añade un origen alterno de datos con la misma forma.

---

## Tareas de ejecución (orden)

1. Habilitar Lovable Cloud (tablas + storage bucket `badges`).
2. Pedir `LUMA_API_KEY` con `add_secret` desde la pantalla Setup.
3. Instalar deps: `satori`, `satori-html`, `@resvg/resvg-wasm`, `qrcode`, `node-vibrant` (o `colorthief`), `zod`.
4. Copiar assets del repo (`public/*.png/.svg`) a `src/assets/brand/` como defaults.
5. Portar `lib/generate-badge.tsx` → `src/lib/generate-badge.server.tsx` (reemplazar `sharp` por `resvg-wasm`, aceptar `EventTheme` como parámetro).
6. Crear server fns Luma (`src/lib/luma.functions.ts` + `src/lib/luma.server.ts`).
7. Crear rutas `/`, `/events`, `/e/$eventId`, `/e/$eventId/playground`, `/e/$eventId/gallery`.
8. Crear server routes `/api/generate-badge`, `/api/generate`, `/api/gallery`, `/api/check-fingerprint`.
9. Reemplazar placeholder `src/routes/index.tsx` por la pantalla Setup / lista de eventos según haya API key.
10. `head()` propio por ruta con título/description/og del evento (og:image = cover del evento).
11. Escribir `docs/phase-2-scraping.md`.

---

## Preguntas antes de ejecutar

1. **API key de Luma**: ¿ya la tienes? Cuando aprueben este plan te abro el formulario seguro para pegarla (`add_secret` → `LUMA_API_KEY`). No la pegues en el chat.
2. **Calendario específico**: ¿quieres restringir a un solo `calendar_api_id` (hardcoded) o soportar múltiples calendarios (el usuario elige uno)?
3. **Galería/persistencia**: ¿guardamos cada badge generado en Cloud (para vista pública por evento) o el badge es efímero (solo download)? Afecta si habilitamos Cloud ahora o solo en Fase 2.

Responde y arranco la ejecución.
