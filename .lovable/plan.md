## What I verified in your account first

Consultas reales sobre la base conectada (no supuestos):

- Calendarios activos: **138** — 3 Luma conectados (con API key), 61 Luma externos, 80 Meetup (79 grupos + 1 evento suelto). **0 filas ocultas** (`merged_into_id` no nulo) y sólo 6 registros en `calendar_merge_audit`.
- **No existe hoy ninguna fusión Luma↔Meetup**: la hipótesis de "calendarios Luma ocultos por fusión cruzada" no se confirma. No haré una "restauración" de filas que no están ocultas; sí dejaré la guarda para que nunca ocurra.
- **Eventos duplicados: 0.** 2.770 eventos canónicos con 2.770 claves y 2.770 URLs únicas. Sí hay **80 eventos canónicos huérfanos** (sin ninguna fuente) que inflan estadísticas.
- **Causa raíz real de "no traen eventos": 91 calendarios en estado `failed` con el error `Could not find the function public.finalize_scoped_calendar_sync`.** La migración `20260728190000_incremental_calendar_sync.sql` se aplicó a medias: las columnas existen, la función no. El sync importa los eventos y luego revienta al finalizar, por eso quedan como fallidos con `imported_count > 0`.
- **Segundo problema: 44 calendarios Luma marcados `inaccessible**` ("Calendar is not publicly accessible"). `resolveLumaCalendar` sólo intenta descargar el HTML público del slug; si Luma responde bloqueado, devuelve `null` aunque la fila ya tenga `luma_calendar_id` (`cal-...`) conocido de sincronizaciones previas.

## Plan

### 1. Migración de reparación (SQL, idempotente, sin borrar datos)

- `CREATE OR REPLACE` de `finalize_scoped_calendar_sync` con la firma exacta que llama el código, con sus `REVOKE`/`GRANT` a `service_role`.
- Índice único parcial `user_id + provider + provider_source_id` (donde `merged_into_id IS NULL` y `provider_source_id` no nulo) para blindar la idempotencia por proveedor.
- Guarda en `merge_calendar_rows`: `RAISE EXCEPTION` si el ganador y el perdedor tienen distinto `provider` — nunca se podrá fusionar Luma con Meetup/Eventbrite.
- Limpieza de los 80 eventos canónicos huérfanos.
- Reencolado de los 91 calendarios en `failed` cuyo error sea el de la función faltante (vuelven a `queued` con `next_sync_at = now()`), sin tocar los demás.
- Reparación defensiva e idempotente: si existiera alguna fila con `merged_into_id` apuntando a un calendario de otro proveedor, se restaura (`merged_into_id = NULL`, conserva key, default, grupo, orden, metadatos) y se reencola. Hoy son 0 filas; queda como red de seguridad.

### 2. Resolución de calendarios Luma "inaccessible"

En `src/lib/calendar-sync.server.ts` / `luma-public.server.ts`, antes de declarar un calendario inaccesible:

1. Usar `luma_calendar_id` ya conocido de la fila (o el alias `cal-...`) y consultar directamente por ID.
2. Si no hay ID, extraerlo de los aliases o de `source_metadata`.
3. Sólo si ambos fallan, intentar Firecrawl y luego marcar `inaccessible`.

Además: un calendario que ya tiene eventos importados nunca pasará a `inaccessible` sin conservar su histórico; se marcará `partial` con el motivo.

### 3. Identidad estricta por proveedor

- `providerSourceId` y la resolución de duplicados sólo cruzan dentro del mismo `provider`: Luma por `luma_calendar_id` / `provider_source_id` / aliases Luma; Meetup por `provider = 'meetup'` + slug de grupo normalizado.
- Se elimina cualquier coincidencia genérica por `calendar_id` o URL entre proveedores en `calendar-identity.server.ts` y en el alta de fuentes.
- La reimportación del mismo CSV no crea filas nuevas ni convierte fuentes Luma existentes.

### 4. Contadores unificados

Una sola consulta canónica (extendiendo `get_event_library_stats`) devuelve: calendarios activos, Luma conectados, Luma externos, Meetup externos, fuentes ocultas/fusionadas, eventos totales, pasados, futuros y sin fecha. Settings y la biblioteca consumen ese mismo resultado; hoy mezclan listas distintas. Cada fila de la biblioteca muestra su proveedor y el motivo de error cuando lo hay.

En el importador Meetup, el resumen reportará: filas procesadas, URLs únicas, duplicados ignorados, URLs inválidas, fuentes creadas y fuentes ya existentes.

### 5. Ejecución y verificación

- Aplicar la migración, luego drenar la cola de sync para los calendarios reencolados.
- Comprobaciones finales por SQL: `failed` con el error de la función = 0; huérfanos = 0; eventos duplicados por `canonical_key`/URL = 0; 79 grupos Meetup activos; los 3 Luma conectados intactos con su API key y su default.

### 6. Pruebas

Tests nuevos en `src/lib/__tests__/`: 79 grupos únicos desde el CSV, reimportación idempotente, colisión de ID/URL entre proveedores sin fusión, y coherencia de contadores. Se corre typecheck, lint, tests y build.

Fuera de alcance

No se toca el contrato del API público (`/api/v1/*`); queda como tarea separada.

### Informe final

Al terminar entrego: Luma activos, Meetup activos, filas restauradas, fusiones legítimas conservadas, eventos totales/pasados/futuros, y la lista de fuentes que sigan con error con su motivo.