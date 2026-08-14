# Settings: hacer entendible "Mine" y la lista de calendarios

## Problema

Hoy el control de "Mine" es un botón pequeño con borde fino, mezclado entre "Sync now", "Full resync", selects de grupo y "Default". Parece una etiqueta, no un control, y queda al final de una fila muy cargada (a 1016px se envuelve y se pierde). Además la lista sólo se agrupa por grupos, sin forma de ver rápido "los míos" ni de filtrar.

## Cambios de UX

### 1. Barra de control arriba de la lista

- Buscador por nombre de calendario.
- Segmented control (pestañas): **All · Mine · Connected · Not mine**, con el conteo de cada uno.
- Botones de acción masiva sobre el subconjunto visible: **Mark visible as mine** / **Unmark visible**, más el ya existente "Claim connected".
- Botones **Expand all / Collapse all** para los grupos.

### 2. Fila de calendario más legible

- El control de "Mine" pasa a ser un **switch real** (shadcn `Switch`) con la etiqueta "Mine" al lado, colocado al inicio del bloque de acciones (antes de Sync), con estado de guardado (deshabilitado + spinner breve) y feedback por toast.
- Se quita la etiqueta duplicada "mine" del título: el estado lo comunica el switch. Las filas marcadas ganan un borde/acento izquierdo suave para que se vean de un ojo.
- Las acciones secundarias (Full resync, Brand kit, Group, Default, Remove) se mueven a un menú "⋯" por fila, dejando visible sólo: switch Mine, Sync now y el menú. Así la fila deja de envolverse en pantallas medianas.

### 3. Grupos desplegables con estado

- Cada grupo sigue siendo colapsable, pero la cabecera muestra `nombre · N calendarios · M mine` y el estado abierto/cerrado se recuerda en la sesión.
- Por defecto: grupos abiertos si tienen algún calendario "mine", cerrados si no (con 141 calendarios evita el muro de scroll).

### 4. Explicación en pantalla

Una línea de ayuda bajo el título: "Mark the calendars you own. 'My calendars' in Events and the Notion sync only use these." Así el usuario entiende para qué sirve el switch.

## Detalles técnicos

- Sólo cambia `src/routes/_authenticated/settings.tsx` (presentación) más el uso de `@/components/ui/switch`, `dropdown-menu` y `sonner` ya disponibles.
- Filtro/búsqueda en estado local del componente de lista; los conteos se derivan de `calendars` (ya trae `isMine`, `ownership`, `provider`).
- El switch llama al `setCalendarMine` existente; la acción masiva itera con concurrencia limitada y luego un único `refresh()` + invalidación de `event-library-stats`.
- No se toca el backend ni las funciones de servidor.
