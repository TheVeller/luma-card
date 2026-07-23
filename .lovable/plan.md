# Plan: AI style fix, dataset export, unified gallery, multi-calendar

## 1. AI style — arreglar y añadir botón de re-detectar

**Diagnóstico (a confirmar en la ejecución):** El `useEffect` en `e.$eventId.tsx` corre `analyze` en cada montaje pero no hay retry ni forma de reintentar cuando falla o cuando cambia el cover. Además, si el server fn lanza (por schema/timeout), la UI queda en `DEFAULT_STYLE_SPEC` sin feedback claro y sin manera de reintentar.

**Cambios en `src/routes/_authenticated/e.$eventId.tsx`:**
- Extraer la lógica de análisis en una función `runAnalyze()` que setea `analyzing`, `aiError` y `spec`. El `useEffect` la llama al montar; el nuevo botón la vuelve a llamar.
- Añadir botón **"Re-detect style"** dentro del panel "AI style" (al lado del label), habilitado siempre que `!analyzing`. Muestra spinner mientras corre.
- Mostrar el mensaje de error del server de forma legible (ya existe `aiError`, revisar que se pinte también cuando cae en el fallback default).
- Cuando cambia el `spec`, invalidar `heroDataUrl` y `badgeUrl` para forzar coherencia visual.

**Verificar en el server (`src/lib/style-analyze.functions.ts`):** revisar logs con `stack_modern--server-function-logs` para confirmar la causa real (esquema, URL de cover inválida, timeout de Vercel). Si es por el URL del cover no llegando (Luma CDN), pasar la versión proxied `/api/public/image?url=…` como fallback cuando la URL directa falla.

## 2. Descargar dataset de eventos

**En `src/routes/_authenticated/events.tsx`:**
- Al lado del botón "Refresh", añadir botón **"Export JSON"** y **"Export CSV"** (o un split button "Export ▾"). Genera cliente-side desde `data` (ya cargada), ordenada por `startAt` desc.
- Campos incluidos: `id, name, url, startAt, endAt, city, coverUrl, description` (todo lo que ya trae `EventDTO`).
- CSV: escape correcto de comas/quotes/newlines. Nombre de archivo: `luma-events-{calendarSlug|calendarId}-{YYYY-MM-DD}.{ext}`.
- Sin cambios de backend.

## 3. Galería unificada de badges generados

**Nueva ruta `src/routes/_authenticated/gallery.tsx`:**
- Server fn nueva `listAllBadgesForUser` en `src/lib/badges.functions.ts` (autenticada, filtra por `user_id = context.userId`, RLS-friendly). Devuelve badges con `event_id, first_name, role, image_path, created_at, publicUrl`, más el join lógico con eventos vía cache client-side (o incluye `event_name` derivándolo de un `listEvents()` en paralelo).
- UI:
  - Header con conteo y export CSV del dataset de badges.
  - Filtros: por evento (dropdown poblado con eventos que tienen ≥1 badge), search por nombre/role, sort (recientes / alfabético por nombre / por evento).
  - Grid tipo `EventBadgeGallery` pero con badge del evento (chip) debajo de cada card.
  - Click abre modal con detalle + link al evento.
- Enlace "Gallery" en el header del layout autenticado (`src/routes/_authenticated/route.tsx`) — al lado de "Events" y "Settings".

## 4. Soporte multi-calendario

**Schema — nueva migración:**

```text
convertir user_luma_keys en tabla de N filas por usuario
  → PK compuesta (user_id, calendar_id) o id uuid + unique(user_id, calendar_id)
añadir columna `is_default boolean not null default false`
grants a authenticated preservados, RLS scoped a auth.uid()
```

Migración detallada:
1. `CREATE TABLE user_luma_calendars` con la misma forma (encrypted key, calendar meta, is_default) — nueva tabla para no romper nada.
2. Copiar filas de `user_luma_keys` a `user_luma_calendars` con `is_default=true`.
3. Dejar `user_luma_keys` en su lugar por ahora (fallback) — se retira en un cleanup posterior.
4. GRANT + RLS por `auth.uid() = user_id`.

**Backend:**
- Nuevo `src/lib/user-luma-calendars.functions.ts` con: `listCalendars`, `addCalendar` (encripta key, llama `/calendar/get`, guarda meta), `removeCalendar`, `setDefaultCalendar`.
- `resolveUserLumaKey(userId, calendarId?)` acepta un `calendarId` opcional; sin él, usa el default.
- `listEvents` y `getEvent` aceptan `calendarId?` en el input; si no viene, default.

**UI — selector de calendarios (arriba-izquierda, como pide el user):**
- En el layout `_authenticated/route.tsx`, reemplazar el bloque "avatar + nombre calendar" por un **dropdown de comunidades** (avatar + nombre del calendario activo, chevron). Al abrir muestra la lista de calendarios del user + entry "+ Add calendar".
- Estado del calendario activo en `localStorage` (`activeCalendarId`) + React Query keyed por calendarId. Cambiar de calendario invalida `["luma-events", calendarId]`.
- `/settings`: sección "Calendars" con lista de calendarios (avatar, nombre, badge "default"), botones set default / remove, y un formulario "Add calendar" (input key → server fn valida + guarda). El campo Luma key legacy se mantiene por retrocompatibilidad pero migra silenciosamente a la primera fila de `user_luma_calendars`.
- Nueva vista opcional "All calendars combined" (toggle en el dropdown → `calendarId = "__all__"`): server fn hace fan-out en paralelo a las N keys y concatena, marcando cada `EventDTO` con `calendarId` y `calendarName` para poder filtrar en events grid.

## Notas técnicas

- Ficheros nuevos: `src/routes/_authenticated/gallery.tsx`, `src/lib/user-luma-calendars.functions.ts`, `src/components/CalendarSwitcher.tsx`, migración SQL.
- Ficheros modificados: `e.$eventId.tsx` (re-detect + invalidación con calendarId), `events.tsx` (export + calendarId), `route.tsx` (switcher), `settings.tsx` (multi-calendar section), `luma.functions.ts` (calendarId), `user-luma-key.functions.ts` (mantener + delegar), `badges.functions.ts` (listAll).
- Sin cambios en `renderBadge`, en el pipeline de style-analyze salvo el fallback proxied de cover, ni en auth.
- Verificación: probar re-detect, exports, gallery filters, y añadir un segundo calendario con otra API key para confirmar que el switch funciona y "All combined" mergea.

## Fuera de alcance

- Retirar la tabla legacy `user_luma_keys` (se hará en un cleanup posterior una vez estable).
- Compartir calendarios entre users, roles, workspaces.
