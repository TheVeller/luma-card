# "Mine" en API y MCP + solidificación

## Estado actual (verificado)

- `/api/v1/events` ya acepta `?mine=true|false` y lo mapea al filtro `ownership` de `events-aggregate.server.ts`. Funciona, pero **no está documentado** en `docs/api.md` ni `docs/openapi.yaml`.
- `/api/v1/calendars` **no expone `isMine`** en su respuesta (sí expone `ownership`), así que un consumidor de la API no puede saber qué calendarios marcaste como tuyos ni filtrar por ellos.
- El MCP server no tiene nada de "mine": `list_calendars` no selecciona la columna `is_mine`, y **no existe ningún tool para listar eventos** (solo calendars, badges, presets, whoami).
- Los 4 tools MCP duplican el helper `userClient` inline en vez de usar una fábrica compartida.

## Cambios

### 1. API REST — "mine" de primera clase

- `src/routes/api/v1/calendars.ts`: añadir `isMine` a cada calendario de la respuesta (misma derivación que el DTO interno: `is_mine ?? ownership === "connected"`), y aceptar `?mine=true|false` para filtrar la lista. Validación `bad_params` coherente con el resto.
- `src/routes/api/v1/events.ts`: sin cambios de lógica (ya soporta `mine`); sólo asegurar que `filters.mine` se refleja en la respuesta (ya lo hace).
- Documentación: actualizar `docs/openapi.yaml` (parámetro `mine` en `/events` y `/calendars`, campo `isMine` en el schema de calendar) y `docs/api.md` (tablas de parámetros y campos).

### 2. MCP — exponer "mine" y eventos

- Crear `src/lib/mcp/supabase.ts` con la fábrica compartida `supabaseForUser(ctx)` (env resolution lazy, sin top-level reads) y refactorizar los 4 tools existentes para usarla (elimina 4 copias de `userClient`).
- `list_calendars`: incluir `is_mine` en el select y en la salida, y añadir input opcional `mine: z.boolean()` para filtrar.
- Nuevo tool `list_events`: lista eventos del usuario autenticado con filtros `mine` (boolean), `calendar_id`, `status` (upcoming/ongoing/past/all), `limit`. Implementación: consulta a `canonical_events` + `event_sources` con RLS vía token forwardeado, filtrando por calendarios `is_mine` del usuario — devuelve id, nombre, fechas, ciudad, url, cover, calendario.
- Registrar `list_events` en `src/lib/mcp/index.ts` y actualizar `instructions`.
- Ejecutar `app_mcp_server--extract_mcp_manifest` para regenerar `.lovable/mcp/manifest.json` con los nuevos schemas.

### 3. Solidificación y verificación

- Añadir tests en `src/lib/__tests__/api-v1.test.ts` (o uno nuevo) para: mapeo `mine=true|false` → ownership, rechazo de valores inválidos, y derivación de `isMine` en la respuesta de calendars.
- Correr la suite de tests (`bun test` en `src/lib/__tests__`) y revisar `build-errors.log`.
- Smoke test con curl contra preview: `/api/v1/calendars?mine=true`, `/api/v1/events?mine=true`, y `/.mcp/list-tools` para confirmar que el MCP anuncia `list_events` y el nuevo schema de `list_calendars`.

## Fuera de alcance

- No se toca el flujo OAuth del MCP (ya configurado) ni la UI de Settings.
- No se añaden tools MCP de escritura (sync, crear badge) — se puede evaluar después.
