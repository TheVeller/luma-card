
## Contexto y decisión sobre OmniRoute

OmniRoute es un **gateway self-hosted** (tipo LiteLLM/OpenAI-compatible proxy) — se despliega en Docker/Render/Fly, no es una librería para instalar en la app. Lovable corre en Cloudflare Workers, así que no puede hostearlo internamente.

Como confirmaste, usamos **Lovable AI Gateway** (`LOVABLE_API_KEY`, ya provisto). Ventajas:
- Cero setup, ya está configurado
- OpenAI-compatible igual que OmniRoute
- Cubre Gemini/GPT + generación de imagen en un solo endpoint
- **Migración a OmniRoute más adelante = cambiar solo `baseURL` y `API-Key` header** en `src/lib/ai-gateway.server.ts` (5 líneas). Deja documentado el hook de migración.

## Arquitectura AI del generador (Fase 1 mejorada)

Enfoque **híbrido** con 3 llamadas AI por evento:

```text
Evento Luma
   │
   ├─ [1] Vision → Style Spec (JSON)
   │      • Analiza el cover art del evento
   │      • Devuelve: paleta (bg/accent/text/highlight),
   │        par de Google Fonts (heading + body),
   │        mood, estilo del hero (ej. "líneas abstractas neón cyber")
   │
   ├─ [2] Image Gen → Hero Art
   │      • Prompt derivado del style spec
   │      • Usa cover del evento como referencia
   │      • Output: PNG limpio (sin texto, sin overlays)
   │
   └─ [3] Canvas Compose → Badge final
          • Frame/borde tipo stamp del repo original
          • Hero art generado en la ventana principal
          • Tipografía dinámica cargada desde Google Fonts
          • Título/fecha/venue del evento con colores del spec
          • QR al link del evento
          • Todo el texto es capa canvas → siempre nítido, sin overlays
```

**Chat nativo** en la página del evento: cada mensaje del usuario ("más oscuro", "usa serif", "hero más minimalista", "acento dorado") pasa por Gemini con tool-calling que actualiza el `StyleSpec` y/o dispara re-generación del hero. Preview se actualiza en vivo.

## Modelos

| Uso | Modelo | Por qué |
|---|---|---|
| Vision → style spec | `google/gemini-3.6-flash` | Multimodal barato, buen JSON estructurado |
| Hero image gen | `google/gemini-3-pro-image` | Máxima calidad (usuario pidió "great quality") |
| Chat iterativo | `google/gemini-3.6-flash` | Rápido + tool-calling para editar spec |

Todos vía `LOVABLE_API_KEY` con AI SDK + `@ai-sdk/openai-compatible` como indica `ai-sdk-lovable-gateway`.

## Archivos a crear / modificar

**Nuevos**
- `src/lib/ai-gateway.server.ts` — provider Lovable AI (baseURL + header) con helper de run-id. Punto único de migración a OmniRoute.
- `src/lib/style-spec.ts` — tipo `StyleSpec` + Zod schema (paleta, fonts, mood, hero prompt).
- `src/lib/style-analyze.functions.ts` — `analyzeEventArt(eventId)`: descarga cover vía proxy, llama Gemini vision con `Output.object`, devuelve `StyleSpec`.
- `src/lib/hero-generate.functions.ts` — `generateHeroArt(spec, eventId)`: llama modelo de imagen con prompt derivado + cover como referencia, devuelve data URL / lo cachea.
- `src/routes/api/chat-badge.ts` — server route streaming (`streamText`) con tool `updateStyleSpec` y tool `regenerateHero`. Historial por evento.
- `src/components/BadgeChat.tsx` — panel `useChat` a la derecha del preview.
- `src/lib/google-fonts.ts` — helper para cargar dinámicamente un par heading+body de Google Fonts en el canvas (via FontFace API antes de renderizar).

**Modificados**
- `src/lib/badge-render.ts` — recibe `StyleSpec + heroDataUrl` en vez de deducir color en cliente; carga fonts vía `google-fonts.ts`; layout del repo intacto (frame stamp, QR, márgenes 1080x1600).
- `src/routes/e.$eventId.tsx` — split view: izquierda preview live, derecha chat. Botón "Auto-generate" corre `analyze → generate → render`. Botón "Regenerate hero" y "Reset". Muestra `StyleSpec` actual en un drawer colapsable.
- `src/lib/luma.functions.ts` — sin cambios funcionales; asegurar que devuelve `cover_url` para el vision call.
- `phase-2.tsx` — añadir sección "Migrar a OmniRoute" con el patch exacto de `ai-gateway.server.ts`.

## StyleSpec (contrato)

```ts
type StyleSpec = {
  palette: { bg: string; surface: string; accent: string; text: string; textMuted: string }
  fonts: { heading: string; body: string } // Google Fonts family names
  mood: string       // "cyberpunk neon", "minimal editorial", etc.
  heroPrompt: string // prompt para image gen, sin texto ni overlays
  heroStyle: "illustration" | "photo" | "abstract" | "3d"
}
```

Sin `.min()/.max()/enum` largos en el schema (regla `ai-sdk-lovable-gateway`); los límites van en el prompt y se clampan en código. Guardar cache por evento en localStorage para no re-gastar créditos.

## Flujo del usuario

1. Entra a `/e/:eventId`
2. Auto-corre `analyze` al montar (o lee cache) → StyleSpec inicial
3. Auto-corre `generateHero` → preview con badge completo
4. Chat: "hazlo más rojo, tipo brutalist" → tool actualiza `palette.accent` + `fonts` + `mood` → canvas re-renderiza. Si el hero necesita cambiar, llama `regenerateHero`.
5. Sube foto opcional del asistente (mantiene la feature del repo original).
6. Download PNG / Share.

## Verificación

- `LOVABLE_API_KEY` presente (auto-provisto) — llamar `ai_gateway--create` si falta.
- Test end-to-end: cargar un evento real de Luma, ver StyleSpec en JSON, ver hero generado, iterar 2 mensajes de chat.
- Server-function logs para 402/429 (mostrar toast claro sobre créditos/rate-limit).
- No overlays: hero es capa base, texto siempre encima como canvas paths — verificado visualmente.

## Fuera de scope de esta fase

- Instalación/hosteo de OmniRoute (documentado en `phase-2` como opción).
- Scraping sin API de Luma (sigue en Fase 2).
- Persistencia server-side de badges generados (localStorage por ahora).
