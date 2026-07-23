# Plan: Seed histórico + rediseño Luma

## 1. Seed histórico placeholder (solo tu cuenta)

**Alcance:** 7 badges placeholder — los 6 eras del history repo + Vibe Code Fest:
- Code Brew, v0 Zero-to-Agent, GTM Hackathon, Cursor Meetup, Cursor Buildathon SV, Code Brew SV, Vibe Code Fest

**Datos del placeholder:**
- Nombre: `Ignacio Velásquez`
- Rol: `Founder, GPT Chain`
- Foto: subida vía `lovable-assets` desde `/mnt/user-uploads/Ignacio_Velásquez.jpeg` → JSON pointer en `src/assets/ignacio-placeholder.png.asset.json`

**Ejecución:** un botón admin visible solo si `session.user.email === "ivelasquezfr@gmail.com"`, ubicado en `/settings` ("Seed my historical gallery"). Al pulsarlo:
1. Client trae `listEvents()` y hace fuzzy-match por nombre contra los 7 títulos objetivo (case-insensitive, contains + fallback a la mejor coincidencia por token overlap).
2. Para cada match: fetch cover → `analyzeEventArt` para style spec → `renderBadge()` con la foto+datos de Ignacio → `supabase.storage.upload` bucket `badges` → `INSERT` en `badges` con `user_id` del usuario.
3. Idempotente: antes de insertar, chequea si ya existe un badge con `first_name='Ignacio Velásquez'` para ese `event_id` y skippea.
4. UI: progress log ("Matched 6/7 events · rendered 6/6").

Sin cambios de schema (la tabla ya soporta todo). Sin backend privilegiado — corre en el navegador del user autenticado, respetando RLS de insert.

## 2. Rediseño global con look de Luma

**Referencias del lenguaje visual Luma:**
- Fondo casi-negro cálido con textura sutil, tipografía **Inter** (o similar sans compacto), acentos color de brand del evento pero contenidos.
- Cards con `border-radius: 16-20px`, bordes hairline `rgba(255,255,255,0.08)`, superficies apiladas con overlay translúcido y blur suave.
- Botones pill primarios sobre superficie clara alta-contraste; secundarios outline hairline.
- Metadata en mayúsculas dispersas para labels (`FEATURED`, `SOLD OUT`) — mantenemos esta convención que ya usamos.
- Imágenes hero grandes con overlay gradiente inferior; sin bordes duros.

**Cambios concretos:**

### 2.1 Design tokens — `src/styles.css`
Reemplazar la paleta cream por sistema oscuro Luma-like:
- `--background: oklch(0.14 0.008 60)` (charcoal cálido)
- `--surface: oklch(0.18 0.008 60)`, `--surface-2: oklch(0.22 0.008 60)`
- `--foreground: oklch(0.96 0.005 60)`, `--muted: oklch(0.65 0.01 60)`
- `--accent: oklch(0.72 0.18 55)` (naranja cálido Luma-style, como default; se sigue permitiendo override por-evento en el badge canvas)
- `--hairline: color-mix(in oklab, white 8%, transparent)`
- Cargar Inter + Inter Tight vía `<link>` en `__root.tsx` head; token `--font-sans: "Inter"`, `--font-display: "Inter Tight"`.

### 2.2 Shell — `src/routes/_authenticated/route.tsx`
- Header traslúcido con blur (`backdrop-filter`), hairline inferior, avatar del calendario circular pequeño + nombre + email a la derecha, botón Sign out ghost.
- Fondo global oscuro con grain sutil vía `@utility grain { &::after {…} }`.

### 2.3 Landing — `src/routes/index.tsx`
Full redesign: hero centrado tipo Luma discovery, tipografía tight, un CTA primario ("Continue with Google") + link secundario. Feature grid en 3 columnas con iconos monoline.

### 2.4 Auth — `src/routes/auth.tsx`
Card centrada 420px sobre fondo oscuro, borde hairline, botón Google grande con logo, mensaje pequeño de privacidad.

### 2.5 Events grid — `src/routes/_authenticated/events.tsx`
Cards Luma-style: cover 1:1 con radio 16px, overlay inferior con date/city, título en display font, hover eleva con shadow. Sección Upcoming/Past si hay dato de fecha. Botón filtro pill.

### 2.6 Event page — `src/routes/_authenticated/e.$eventId.tsx`
- Chrome oscuro (inputs, chat, botones) usando tokens.
- El canvas del badge (`renderBadge`) **no se toca** — sigue leyendo el `StyleSpec` del AI.
- Los swatches del "AI style" panel y el chat visualmente adoptan el theme oscuro.
- Preview del badge sobre superficie oscura con hairline en vez de cream.
- Botones share: X/LinkedIn/Native mantienen sus brand colors, resto pill.

### 2.7 Settings — `src/routes/_authenticated/settings.tsx`
Card única con input del Luma key, estado del calendario detectado (avatar + nombre), botón save/test. Añade el nuevo botón "Seed my historical gallery" al final (solo visible para tu email).

### 2.8 Componentes internos
- `EventBadgeGallery` — grid oscuro, cards con hairline.
- `BadgeChat` — burbujas sobre surface-2, input pill, botón send con accent.
- `CameraCapture` — modal oscuro con hairline.

**Fuera de alcance de este plan:**
- No cambio de la lógica del `renderBadge` ni del pipeline AI. El badge en sí sigue reflejando el brand del evento (esa era la petición previa).
- No cambio de esquema DB, ni de rutas, ni de auth flow.

## Detalles técnicos

- **Foto de Ignacio:** subida como Lovable Asset (`lovable-assets create --file /mnt/user-uploads/Ignacio_Velásquez.jpeg`) → import del `.asset.json` → fetch de la URL para convertir a dataURL antes de pasar a `renderBadge`.
- **Match fuzzy** implementado en cliente: normalize (lowercase, sin diacríticos), check substring bidireccional + token overlap ≥ 0.5 como fallback.
- **Idempotencia del seed:** query previa `select id from badges where event_id=? and first_name='Ignacio Velásquez' and user_id=auth.uid()` antes de cada insert.
- **Fonts:** `<link rel="preconnect" href="https://fonts.googleapis.com">` + Inter/Inter Tight en el head de `__root.tsx`. Google Fonts dinámicos del badge (`google-fonts.ts`) siguen funcionando aparte.
- **Grain:** una capa `::after` fixed con SVG noise inline como data-URI, `opacity: 0.03`, `pointer-events: none`.
