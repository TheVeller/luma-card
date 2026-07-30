
# Solidificar contabilidad, migración pendiente y filtros por etiquetas

## Lo que confirmé en la base de datos (no supuesto)

| Dato | Realidad en DB | Lo que muestra la UI |
|---|---|---|
| Eventos canónicos | **4.136** (1.223 Luma + 2.913 Meetup) | 985 |
| Filas de calendario | **144**, todas activas (0 fusionadas) | 141 activos |
| Luma conectados | **3** (con API key) | 0 |
| Luma externos | 58 | 61 |
| Meetup | 80 | 80 |

Causas confirmadas:

1. **Techo de 1.000 filas**: la vista autenticada de Settings lee `event_sources` fila por fila desde el navegador; PostgREST corta en 1.000 filas → 985 eventos únicos. No es un problema de datos, es la consulta.
2. **La RPC `get_my_event_library_stats` no existe** en la base (`to_regproc` = null), así que nunca se usa el camino rápido del servidor.
3. **Luma conectados = 0**: el resumen deduplica por identidad y descarta la fila conectada cuando ya vio una externa equivalente, en vez de preferir la conectada.
4. **La migración `20260729180000_api_enrichment_change_log.sql` nunca se aplicó**: faltan `topics`, `audience`, `language_code`, `country_code`, `is_online`, `event_format`, `enrichment`, `timezone`, la tabla `event_change_log` y `api_tokens.scopes/expires_at`. Por eso hay 23 sync jobs fallidos con `column canonical_events.external_ids does not exist` y las etiquetas (`tags`, `suggested_tags`) están 100% vacías (0 de 4.136).
5. Las otras causas históricas de fallo (constraint global de `scraped_events`, `finalize_scoped_calendar_sync`, `source_type` check) **ya están reparadas**; esos 932 jobs `failed` son antiguos. Lo que sigue vivo es "Calendar is not publicly accessible" (596 intentos, calendarios Luma públicos que Luma bloquea).

Sobre "muchas dbs con eventos": no son bases distintas, son 4 tablas de una misma base con roles distintos — `event_sources` (6.5k = una fila por avistamiento de un evento en un calendario), `scraped_events` (5.6k = caché crudo del scraper), `canonical_events` (4.1k = la verdad deduplicada), `event_sync_jobs` (1.1k = historial de jobs). La jerarquía es correcta; lo que falta es limpieza de caché y que **todos los contadores salgan solo de `canonical_events`**.

## Plan

### 1. Migración (backend nativo de Lovable)
- Aplicar la migración de enriquecimiento pendiente (columnas de `canonical_events`, `event_change_log`, `api_tokens.scopes/expires_at`) de forma idempotente.
- Crear una única RPC canónica `get_my_event_library_stats()` (SECURITY DEFINER, scoped a `auth.uid()`) que devuelva en **una sola consulta**: total de calendarios, activos, Luma conectados, Luma externos, Meetup, otros, fusionados/ocultos, fuentes con error, y total / upcoming / past / sin fecha de eventos — global y por proveedor, contando `DISTINCT canonical_event_id`.
- Retención de caché: purgar `scraped_events` de calendarios ya consolidados y jobs `failed` de más de 7 días, para que las tablas dejen de crecer sin control.

### 2. Contabilidad en el servidor
- `event-library-stats.functions.ts`: usar la RPC como única fuente; eliminar el fallback que pagina `event_sources` desde el cliente (origen del techo de 1.000).
- Corregir el resumen de biblioteca para que una fila conectada gane siempre sobre su duplicada externa (Luma conectados debe dar 3, no 0).

### 3. Settings — panel principal + detalle plegable
- Fila principal simétrica de 4: **Calendarios · Eventos · Upcoming · Past**.
- Debajo, un toggle ("Details") que despliega una rejilla alineada por columna:
  - bajo Calendarios: Luma conectados / Luma externos / Meetup / fusionados / con error;
  - bajo Eventos: eventos Luma / eventos Meetup / sin fecha.
- Colapsado por defecto para no ocupar espacio.

### 4. Etiquetas y filtros avanzados en Events
- Derivar etiquetas de los campos ya definidos por la API (`tags`, `suggested_tags`, `topics`, `audience`, `format`, `level`, `city`, `country`, `language`, `online`).
- UI de Events: barra de filtros con chips de etiquetas multi-selección, selects de proveedor / ciudad / idioma / formato / online, búsqueda, y los toggles de estado y orden ya existentes; contador de resultados, chips removibles y "Clear all".
- Estado de filtros en la URL (search params) para que sea compartible, sin romper el orden por defecto (más cercano primero).

### 5. API v1
- Verificar `?tag=`/`?topic=`/`?format=`/`?online=`/`?language=` contra las nuevas columnas y que `scopes`/`expires_at` de tokens se apliquen; actualizar `docs/api.md` y `docs/openapi.yaml` si difieren.

### 6. Verificación final
- Confirmar por SQL que Settings muestra 144 calendarios y 4.136 eventos (o el valor real tras resync), Luma conectados = 3.
- Reencolar los calendarios Luma que fallaron por enrichment y reportar los que siguen inaccesibles con su motivo.
- Tests + typecheck + build.

## Nota
No borro ni reseteo datos existentes; solo caché (`scraped_events`) y jobs antiguos, que se regeneran.
