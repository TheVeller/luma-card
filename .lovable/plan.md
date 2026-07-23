# Firecrawl para style detection y ingesta por link

Meta: usar Firecrawl como capa complementaria para (a) subir la precisión del AI style (colores + fuentes reales de la página del evento) y (b) permitir ingesta por URL de Luma sin API — un calendario completo o un evento aislado.

## Conexión

- Conectar Firecrawl vía `standard_connectors--connect` (connector `firecrawl`). Se lee el flag `uses_connector_gateway` que devuelve el connect y se usa el patrón correspondiente (gateway o direct). Sin llamadas manuales a `api.firecrawl.dev` — todo detrás de un server route/function.
- Nuevo helper `src/lib/firecrawl.server.ts` con `fcScrape`, `fcMap`, `fcExtract` (JSON schema). Sólo se importa desde server functions y `src/routes/api/*`.

## 1. AI style con Firecrawl (branding + fuentes)

Hoy `style-analyze.functions.ts` sólo mira la imagen. Añadir un segundo pase opcional que scrapea la página pública del evento (`event.url` de Luma) con `formats: ['branding','screenshot']`:

- Firecrawl `branding` devuelve `colors`, `fonts[].family`, `typography.fontFamilies.{primary,heading,code}`, logo, ogImage. Estos son **evidencia** dura, no una alucinación del LLM.
- Merge de evidencia (prioridad):
  1. `pixelEvidence` del cover (ya existe) → paleta base.
  2. Firecrawl `branding.colors` → confirma/afina paleta y detecta accent no presente en el cover.
  3. Firecrawl `fonts` + `typography.fontFamilies` → **nuevas** `spec.typography.displayFamily` y `bodyFamily` como Google Fonts si existen; fallback a la sugerencia del LLM.
- El LLM sigue clasificando `bucket`/`mood` con ambas evidencias en el prompt.
- Extender `StyleSpec` con `typography.source: 'firecrawl' | 'ai' | 'default'` para mostrar un badge "detected from event page" en la UI.
- `badge-render.ts` ya carga Google Fonts dinámicos — sólo pasa las nuevas familias.

Si Firecrawl no está conectado o el scrape falla → degradar silenciosamente al pipeline actual (solo imagen).

## 2. Ingesta por link — calendario Luma sin API

Nueva página `src/routes/_authenticated/import.tsx` + server fn `importLumaCalendarByUrl` en `src/lib/luma-scrape.functions.ts`:

- Input: URL tipo `https://lu.ma/{slug}` (calendar) o alias.
- Firecrawl `map` con `search: 'lu.ma'` para descubrir URLs de eventos del calendario, luego `scrape` con extracción JSON de cada evento (schema: name, startAt, endAt, city, coverUrl, description, url, hostName).
- Batch limit configurable (default 40). Se guarda como calendario "scraped" en `user_luma_calendars` con flag `source: 'scrape'` (nueva columna) y `api_key_ciphertext` NULL permitido para filas scraped.
- Migración: `ALTER TABLE user_luma_calendars ADD COLUMN source text NOT NULL DEFAULT 'api'`, hacer `api_key_ciphertext` nullable, agregar CHECK (`source='api' AND api_key_ciphertext IS NOT NULL`) OR (`source='scrape'`).
- El listado de eventos (`listEvents`) ya recibe `calendarId`; para calendarios `source='scrape'` se leerán de una nueva tabla `scraped_events` (cache) en vez de llamar a Luma. Refresh explícito re-corre Firecrawl.

## 3. Ingesta por link — evento aislado

Mismo endpoint: si la URL es `https://lu.ma/{eventSlug}` sin ser un calendario, `scrape` solo esa página, y se guarda como evento suelto en `scraped_events` bajo un calendario virtual "Standalone events" del usuario (auto-creado, `source='scrape'`).

Esto reutiliza toda la ruta `/e/$eventId` — se genera un `eventId` sintético (`scr-<hash>`), y `fetchEvent` en `luma.server.ts` detecta el prefijo `scr-` y consulta `scraped_events` en vez de Luma.

## 4. UI

- **Header**: junto a "Refresh" en `/events`, botón "Import from link" → modal con input de URL y toggle "Este es un calendario / evento único". Usa la server fn de arriba y muestra progreso.
- **Sidebar de calendarios**: los `source='scrape'` se muestran con icono ⌘ y tooltip "Scraped — no API key".
- **Generator (`/e/$eventId`)**: en el panel AI style, mostrar el origen de fuentes/colores (chip "font: Inter · from event page"). Botón "Re-detect" ya existente ahora dispara ambos pasos (pixel + Firecrawl).

## Detalles técnicos

- `StyleSpec` amplía: `typography: { displayFamily: string; bodyFamily: string; source: 'firecrawl'|'ai'|'default' }`. Retro-compatibilidad: si falta, se resuelve a las familias actuales del bucket.
- `style-analyze.functions.ts`: acepta `eventUrl?` opcional; si presente + Firecrawl conectado, hace scrape branding y lo pasa como evidencia al modelo. La respuesta JSON incluye typography.
- Nuevo `src/routes/api/firecrawl-scrape.ts` NO — Firecrawl se usa sólo desde server functions internas, no expuesto públicamente.
- Rate limit / créditos: si Firecrawl devuelve 402/429, se cachea el fallo por 5 min y se cae al pipeline actual.
- Migraciones en un solo paso: columna `source`, nullable key, tabla `scraped_events` (id, user_id, virtual_calendar_id, event_id, payload jsonb, cover_url, created_at) con RLS `auth.uid()=user_id` y GRANTs.

## Alcance de esta iteración

Sí: conexión Firecrawl, upgrade de style detection con fuentes, ingesta por link (calendario y evento), migraciones y UI mínima.

No: crawl profundo/paginación de calendarios grandes, edición manual de eventos scraped, sync programado (cron). Se documentan como fase siguiente.

## Preguntas antes de ejecutar

1. ¿Confirmo que ya tienes (o quieres crear ahora) una conexión Firecrawl en el workspace? Sin ella no puedo probar el scrape end-to-end.
2. ¿Los calendarios scraped deben aparecer mezclados en el switcher junto a los de API, o preferís una sección aparte "Sin API"?
3. Para el "Standalone events" (eventos sueltos por link) — ¿un solo calendario virtual por usuario, o uno por dominio (`lu.ma`, futuros `eventbrite.com`, etc.)?