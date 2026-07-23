# Plan: Kill AI hero + fix composition & style auto-detection

## Diagnóstico de la simulación

Comparando la cover (`Agents That Ship`, monocromo terminal negro/crema) vs el resultado:

1. **AI no detectó el estilo**: la cover es negro sobre crema con tipografía pixel/mono; el badge salió con `accent = #2970ef` (default azul) y `heading = Space Grotesk`. Nada del análisis se pegó → o el modelo devolvió el default, o el fallback tapó el error silenciosamente.
2. **Colisión de texto en el header**: `LU.MA` (subtitle) se dibuja encima de `AUGUST 1 — 9:00 AM` (date). Ver el screenshot: las letras se pisan.
3. **Caption bajo la foto** es `· LU.MA ·`, redundante y feo — debería mostrar la fecha o el nombre corto del evento.
4. **Foto con corner brackets azules gruesos** rompe cuando el evento es monocromo — el accent domina y no es del evento.
5. **Header derecha (seal circular)** funciona, pero el resto del badge no honra el lenguaje visual de la cover.
6. **AI hero** ya no lo quieres → borrar botón + endpoint + campos del spec.

## 1. Eliminar "Generate AI hero"

- Borrar `src/lib/hero-generate.functions.ts`.
- Quitar de `src/routes/_authenticated/e.$eventId.tsx`: import de `generateHeroArt`, estado `heroDataUrl` y `heroBusy`, función `makeHero`, botón "Generate AI hero", y el paso de `heroDataUrl` a `renderBadge`.
- En `src/lib/badge-render.ts`: quitar el parámetro `heroDataUrl` y todo el bloque "Hero band (behind header)". El header queda limpio sobre el paper del `bg`.
- En `src/lib/style-spec.ts`: eliminar `heroPrompt` y `heroStyle` del schema y del default.
- En `src/routes/api/chat-badge.ts` (si referencia `heroPrompt` como tool arg): quitar esa herramienta / esos campos.
- En `src/lib/seed-history.ts`: quitar cualquier referencia a hero (no genera hero, pero verificar).

## 2. Rediseñar la auto-detección de AI style

Objetivo: que la cover `Agents That Ship` (mono negro/crema, mono/pixel) produzca **accent = casi-negro, text = negro, bg = crema/beige, heading = "Space Mono" o "JetBrains Mono", body = "IBM Plex Mono"**, no el default azul.

Cambios en `src/lib/style-analyze.functions.ts`:

- **Subir de modelo**: `google/gemini-2.5-flash` → `google/gemini-3-pro` (o `google/gemini-2.5-pro`) para vision más fiel. Fallback al flash si el pro falla.
- **Reescribir el system prompt** con:
  - Un **taxonomy fijo** de 6 estilos visuales que el modelo debe clasificar la cover primero: `mono-terminal`, `editorial-serif`, `bold-punk`, `industrial-mono`, `warm-paper`, `dark-mode-tech`, `vibrant-illustration`, y para cada uno el rango de paleta y font pair recomendado (basado en las eras del history repo). El modelo primero clasifica, luego adapta.
  - Regla dura: **el accent tiene que ser el color más distintivo de la cover, no un gris**. Si la cover es blanco-y-negro sin croma, el accent va casi-negro `#111` y el `bg` va crema `#efe9d8` (era paper). Nunca devolver el default azul cuando la cover no lo justifica.
  - Regla dura: la font pair tiene que existir en Google Fonts. Ampliar la lista permitida incluyendo mono: `Space Mono`, `JetBrains Mono`, `IBM Plex Mono`, `DM Mono`, `Fira Code`, `Geist Mono` (Space Mono como sustituto portable).
- **Multimodal correcto**: el actual usa `{ type: "image", image: new URL(coverUrl) }`. Con Vercel Gateway + Google models, la ruta chat-completions espera `{ type: "image_url", image_url: { url } }`. Cambiar y pasar la URL directamente. Si `coverUrl` es de `lumacdn.com`, proxear vía `/api/public/image?url=` para evitar 403.
- **Guardar el classifier bucket** en el objeto retornado (`style: "mono-terminal"` etc.) para debuggear + mostrar en el panel "AI style".
- **Log de fallo real** al panel: si el AI devuelve default, marcarlo `aiError = "AI returned default — modelo no clasificó"` en vez de silenciar.
- **Warm-up**: precargar la font pair del spec en el DOM apenas llega la respuesta (ya lo hace `loadGoogleFontPair`, verificar que corre antes del primer render del canvas).

## 3. Corregir la composición del badge

En `src/lib/badge-render.ts`:

### 3.1 Header sin colisiones

- Reorganizar el header como grid vertical estricto:
  - Kicker (`· WHAT'S BREWING?`) — y0
  - Headline (evento) 1-2 líneas, auto-fit — y1 (después del kicker)
  - Row inferior: **city (izq)** + **date (der)** en la misma línea, tipografía chica mono, sin pisarse. La `subtitle` con font display gigante se elimina — era la fuente de la colisión.
- Header bottom baja a `~360` para dejar respirar la foto.

### 3.2 Foto — corner brackets adaptativos

- Reducir grosor: `cornerThick 8 → 5`, `cornerLen 44 → 36`.
- Color de corner brackets: si `accent` tiene baja saturación (mono), usar `text` en su lugar. Regla: si `chroma(accent) < 0.06` en OKLCH → brackets = `text` con alpha 0.8.
- Frame outer (`strokeRect` con accent): mismo criterio — usar `text` con alpha 0.5 cuando el accent es mono para no forzar un accent inexistente.

### 3.3 Caption bajo la foto

- Reemplazar `· LU.MA ·` por el `dateLine` real en mono pequeño, centrado. Si el nombre del evento cabe corto (<20 chars), alternar con `· ${event.name.toUpperCase()} ·`.

### 3.4 Name band

- Bajar `NAME_TOP` de `PHOTO_BOTTOM + 44` a `+ 60` para separar más del caption.
- Nombre a 2 líneas si supera el ancho (ej. "IGNACIO VELÁSQUEZ" cabe en 1 con auto-fit, pero nombres largos como "MARÍA JOSÉ FERNÁNDEZ" hoy se comprimen; permitir wrapLines con maxLines=2 a partir de umbral).

### 3.5 Role / divider

- Divider: hoy es un bloque accent + hairline. Con accent mono, el bloque se pierde — usar `text` cuando accent es mono (misma regla que brackets).

### 3.6 QR / footer

- Sin cambios de layout, solo colores adaptativos con la misma regla mono-vs-cromo.
- Footer text: hoy dice `event.name.toLowerCase() · powered by luma_`. Mantener.

### 3.7 Regla helper compartida

Añadir en `badge-render.ts` (o `style-spec.ts`):

```ts
function isMonoPalette(spec: StyleSpec): boolean {
  // devuelve true cuando accent no tiene suficiente chroma para leerse como color
  // (compara accent vs text en distancia euclidiana RGB simple).
}
function effectiveAccent(spec: StyleSpec): string {
  return isMonoPalette(spec) ? spec.palette.text : spec.palette.accent;
}
```

Y usar `effectiveAccent(spec)` en: frame outer, corner brackets, divider, role text color, kicker.

## 4. UI del panel "AI style"

En `src/routes/_authenticated/e.$eventId.tsx`:

- Añadir chip con el **estilo clasificado** (`mono-terminal`, etc.) arriba de los swatches.
- El botón "↻ Re-detect" ya existe (se agregó turno pasado). Verificar que fuerza nueva llamada y no cachea.

## Fuera de alcance

- No cambio schema DB.
- No cambio flow auth ni multi-calendar.
- No tocar la galería ni el export dataset (ya funcionan).
- No cambio la generación real de hero (se elimina completa).

## Verificación

Después de aplicar:
1. Abrir el evento "Agents That Ship" y llamar re-detect. El panel debe mostrar `style: mono-terminal`, accent casi-negro, heading = Space Mono o similar.
2. Generar badge → chequear que:
   - No hay overlap de `LU.MA` con la fecha.
   - Corner brackets son finos y color texto (no azul).
   - Caption bajo la foto muestra la fecha real, no `· LU.MA ·`.
   - Divider y kicker heredan el color texto.
3. Correr en un evento cromático (ej. GTM Hackathon con cover roja) para asegurar que la regla mono-vs-cromo no rompe el path colorido — el accent rojo debe seguir apareciendo.
