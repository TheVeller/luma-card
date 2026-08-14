# Mis calendarios + sincronización a Notion

## 1. Marcar calendarios como "míos"

- Nueva bandera por calendario (`is_mine`) en la tabla de calendarios, con valor inicial verdadero para los que están conectados por API (los que hoy figuran como "connected") y falso para los externos/importados por link.
- En **Settings**, cada fila de calendario gana un toggle "Mine". Se puede activar/desactivar en cualquier momento y queda guardado por usuario.
- Acción rápida en la cabecera de la lista: "Mark all API calendars as mine" para no tocar 140 filas a mano.
- Los contadores de la biblioteca ganan una línea extra: cuántos calendarios y eventos son míos.

## 2. Ver solo mis eventos

- En **Events**, nuevo filtro "Ownership": `All` / `Mine` / `Not mine`, guardado en la URL igual que los filtros actuales (búsqueda, provider, status, labels), así que es compartible y persistente.
- El selector de calendarios arriba a la izquierda gana una entrada "My calendars" que combina solo los calendarios marcados como míos.
- Las vistas guardadas y la exportación (JSON/CSV) respetan el filtro, así que puedes exportar solo tus eventos.
- La API pública `/api/v1/events` gana el parámetro `mine=true|false` con la misma semántica.

## 3. Conexión a Notion (App User Connector)

- Cada usuario conecta su propio workspace de Notion con un botón "Connect Notion" en Settings (consentimiento OAuth por usuario; se elige en Notion qué páginas compartir).
- La conexión de cada usuario se guarda cifrada del lado servidor; se puede desconectar desde la misma pantalla.
- Tras conectar, el usuario elige la **base de datos destino** en Notion desde un desplegable con las bases que compartió (o crea una nueva base con el esquema correcto si no tiene ninguna).

## 4. Llenado automático de la base de Notion

- La sincronización toma **solo los eventos de los calendarios marcados como míos** y crea/actualiza una página por evento.
- Campos que se escriben: Nombre, Fecha de inicio, Fecha de fin, Estado (Upcoming / Ongoing / Past), Calendario, Provider, Ciudad / Online, Link del evento, Imagen de portada (cover de la página), Tags/Topics y Descripción corta.
- Idempotente: cada evento guarda el id de su página de Notion, así que re-sincronizar actualiza en lugar de duplicar.
- Automático: se dispara al terminar una sincronización de calendarios y, además, mediante un endpoint programado periódico. También hay un botón "Sync now" con el resumen (creados / actualizados / omitidos / fallidos) y el último estado de sincronización visible en Settings.
- Los errores de Notion (página no compartida, permiso revocado, límite de tasa) se muestran tal cual en Settings en lugar de fallar en silencio.

## Detalles técnicos

- Migración: `user_luma_calendars.is_mine boolean not null default false` + backfill `is_mine = (ownership = 'connected')`; índice parcial por `user_id` donde `is_mine`. Nueva tabla `app_user_connections` (clave de conexión cifrada por usuario/conector) y `notion_sync_state` (user_id, database_id, mapeo `canonical_event_id -> notion_page_id`, último resultado).
- Contabilidad: extender `get_event_library_stats` para incluir totales "mine" y exponerlos en `EventLibraryStats`.
- Lectura: `aggregateCanonicalEventsForUser` acepta `ownership: 'mine' | 'all' | 'not_mine'`, filtrando por los calendarios marcados; el filtro se aplica en la consulta, no en cliente.
- Notion: App User Connector (`connector_id: notion`, sin scopes) con `callAsAppUser` desde server functions; escrituras por lotes con respeto de paginación/rate limit. Cron vía ruta `src/routes/api/public/notion-sync.ts` protegida por secreto.
- Tests: filtro de ownership en agregación, stats "mine", y mapeo evento → propiedades de Notion (idempotencia).
