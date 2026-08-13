# Optimizar carga y API de eventos

## Qué está pasando hoy

Cada vez que se abre la página de eventos, el servidor:

1. Lee todos los calendarios del usuario (144).
2. Trae todas las fuentes de eventos en una sola consulta, incluyendo el `payload` JSON completo de cada evento (muy pesado) — y esa consulta se corta en 1000 filas, así que la lista puede quedar incompleta.
3. Reagrupa y deduplica los ~4.275 eventos en memoria, consulta sus etiquetas y manda la lista entera al navegador.
4. El navegador recibe varios MB, y solo después filtra, ordena y muestra.

El resultado es una primera carga lenta, filtros que se sienten pesados y resultados potencialmente truncados.

## Qué vamos a hacer

### 1. Lectura paginada y filtrada en el servidor
Nueva función de servidor que consulta directamente la tabla canónica con filtros (búsqueda, proveedor, ciudad, país, idioma, formato, online, rango de fechas, estado temporal), orden y paginación reales, devolviendo solo la página visible más el total. La página de eventos pasa a pedir páginas de 60 eventos con scroll/paginación en lugar de la biblioteca completa.

### 2. Payload liviano
Se dejan de traer los campos pesados (`payload`, descripciones largas) en las listas. La descripción completa y las fuentes se cargan solo al abrir el detalle del evento. Esto reduce drásticamente el peso de la respuesta.

### 3. Sin truncados silenciosos
Los caminos que sí necesitan la biblioteca completa (sincronización, exportación de dataset, `/api/v1/events`) leen en lotes de 1000 con paginación explícita, para que nunca falte información.

### 4. Índices de base de datos
Agregar los índices que faltan para los filtros nuevos (proveedor, ciudad/país, búsqueda por texto sobre nombre) de modo que la consulta paginada responda rápido con 4k+ eventos.

### 5. Cachés y experiencia de carga
- Reutilizar resultados previos mientras llega la página nueva (sin pantallas en blanco).
- Búsqueda con retardo corto para no disparar una consulta por cada tecla.
- Metadatos de calendarios y estadísticas con caché de sesión, en lugar de recalcularse en cada navegación.

### 6. API externa `/api/v1/events`
El filtrado y la paginación pasan a hacerse en la base de datos en lugar de en memoria, respetando los mismos parámetros públicos actuales (sin cambios incompatibles para quien ya consuma la API).

## Detalles técnicos

- Nueva `listEventsPage` en `src/lib/luma.functions.ts` (validada con Zod: `calendarId`, `q`, `provider`, `status`, `sort`, `from`/`to`, `city`, `country`, `language`, `online`, `format`, `topics`, `limit`, `offset`) que llama a un nuevo `queryCanonicalEventsPage` en `src/lib/events-aggregate.server.ts` usando `select(..., { count: "exact" })` + `.range()` y `.or(name.ilike...)` para la búsqueda.
- `collectEventSourceInputsForUser` mantiene el camino "full library" pero con paginación por lotes (`.range(offset, offset+999)` en bucle) y sin `payload` salvo cuando el llamador lo pida (`includePayload`), que sí lo necesita la sincronización.
- Migración con `CREATE INDEX IF NOT EXISTS` sobre `canonical_events (user_id, event_format)`, `(user_id, country_code)`, `(user_id, lower(city))`, índice `gin` trigram para `name`, y `event_sources (user_id, provider, canonical_event_id)`.
- `src/routes/_authenticated/events.tsx`: la query pasa a `keepPreviousData`, incluye los filtros en la `queryKey`, aplica `useDebouncedValue` de 250 ms a la búsqueda; los chips de tags/topics con conteos se alimentan de las facetas devueltas por el servidor.
- `src/routes/api/v1/events.ts` delega filtros/orden/cursor a `queryCanonicalEventsPage`; el cursor opaco sigue codificando el offset.
- Tests: extender `src/lib/__tests__/event-filtering.test.ts` y `api-v1.test.ts` para cubrir paginación, conteo total y equivalencia de filtros con la lógica anterior.

## Fuera de alcance

Sin cambios de diseño visual ni de la lógica de generación de badges.
