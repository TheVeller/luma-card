
## Estado verificado (lecturas de esta sesión)

- `supabase_migrations.schema_migrations` **no** contiene `20260728210000_repair_owner_calendar_library` → la migración no está aplicada.
- `public.scraped_events` conserva la constraint global `scraped_events_user_id_event_key_key` (bloqueando aggregators); el índice nuevo `scraped_events_user_calendar_event_key` sí existe (creado por una corrida parcial anterior).
- `public.event_sync_jobs` tiene `sync_scope` pero **no** `updated_at` — la migración actual escribe `updated_at = now()` en la línea 173 y romperá.
- El owner (`ivelasquezfr@gmail.com`) tiene 67 calendarios activos, con múltiples duplicados API+pública además de los 5 nombrados.
- `event_sync_jobs` carece de índice único parcial sobre `(source_id) WHERE status IN ('queued','running')`, por lo que el `ON CONFLICT DO NOTHING` de la migración es un no-op y podría insertar jobs duplicados si se re-ejecuta.
- El worker (`src/lib/calendar-sync.server.ts`) marca `historicalComplete = scope.kind==='full' && snapshot.complete`; no valida `total === upcoming + past + unknown` ni distingue truncamiento por paginación cortada.

## Riesgos del SQL actual

1. **Referencia a columna inexistente** (`event_sync_jobs.updated_at`) → aborta la migración entera.
2. **`ON CONFLICT DO NOTHING`** sin índice de soporte → no impide duplicar jobs si se corre más de una vez.
3. **`register_luma_calendar_identity` puede fusionar filas** y devolver un `v_cursor_id` distinto; los updates posteriores usan el nuevo id (correcto) pero cualquier alias añadido antes al id viejo se pierde si no confiamos en `merge_calendar_rows` (sí lo migra, ok — mantener).
4. **Alcance de consolidación** limitado a 5 nombres exactos + Ignacio. Los otros ~55 duplicados de los 67 quedan intactos. Confirmar con el owner si esta migración solo debe tocar los pares nombrados (recomendado) y dejar el resto a un pase posterior guiado.
5. **`sync_all_events=true, event_limit=2000`** en Cursor Community exige que el fetcher agote paginación en `future` y `past` (2 y 18 páginas). Hoy el worker respeta el flag pero la señal `snapshot.complete` viene del provider — hay que garantizar que solo sea `true` cuando ambas colas se agoten y `total == upcoming+past+unknown`.
6. **Sin transacción explícita**: el DO block corre en la transacción de la migración de Supabase (ok), pero la operación es costosa; documentar tiempo esperado.

## Plan

### 1. Nueva migración de reparación (idempotente, reemplaza la anterior)

Archivo: `supabase/migrations/20260728220000_repair_owner_calendar_library_v2.sql`.

Contenido:

- **Blindaje del esquema `event_sync_jobs`**:
  ```sql
  ALTER TABLE public.event_sync_jobs
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
  CREATE UNIQUE INDEX IF NOT EXISTS event_sync_jobs_active_source_idx
    ON public.event_sync_jobs (source_id)
    WHERE status IN ('queued','running');
  ```
- **Constraint global de `scraped_events`**:
  ```sql
  ALTER TABLE public.scraped_events
    DROP CONSTRAINT IF EXISTS scraped_events_user_id_event_key_key;
  -- índice por-calendario ya existe; se asegura idempotencia
  CREATE UNIQUE INDEX IF NOT EXISTS scraped_events_user_calendar_event_key
    ON public.scraped_events (user_id, calendar_id, event_key);
  ```
- **DO block owner-scoped**, idempotente:
  - Resuelve `v_user_id` por email; si no existe → `RETURN` con `NOTICE`.
  - Registra identidad canónica de Cursor Community, marca `sync_all_events=true`, `event_limit=2000`, `historical_sync_completed_at=NULL`, `next_sync_at=now()`, `sync_status='queued'`. Añade aliases URL + luma_id.
  - Para cada par nombrado (`cursor lima, peru`, `cursor arequipa, peru`, `flit festival`, `hack0 community`, `notion arequipa`): elige ganadora API, fusiona TODAS las perdedoras públicas vía `merge_calendar_rows(..., 'owner_api_duplicate_repair')`.
  - Fusiona `Ignacio Velasquez` (calendar 0 eventos) hacia `Ignacio Velasquez profile` (8 eventos).
  - Upgrade a `sync_scope='full'` de jobs ya `queued` de los 6 calendarios objetivo (sin `updated_at` — ahora existe).
  - Inserta jobs `full` faltantes con `ON CONFLICT (source_id) WHERE status IN ('queued','running') DO NOTHING` (soportado por el nuevo índice único parcial).
  - `PERFORM public.cleanup_merged_calendar_rows(v_user_id);`
- **No** toca calendarios fuera de la lista explícita.

### 2. Cambio de código para completion segura del worker

En `src/lib/calendar-sync.server.ts` (solo en las ramas Luma API y públicas donde se calcula `historicalComplete`):

- Requerir para `historicalComplete = true` las tres condiciones simultáneas:
  1. `scope.kind === 'full'`
  2. `snapshot.complete === true` **y** `snapshot.truncated !== true`
  3. `snapshot.totals && snapshot.totals.total === snapshot.totals.upcoming + snapshot.totals.past + snapshot.totals.unknown`
- Si falla la comprobación, marcar el job como `partial`, dejar `historical_sync_completed_at` sin tocar y programar `next_sync_at = now() + 1 min` para reintento.
- Añadir tipo `SnapshotTotals` opcional al retorno del provider (Luma API/pública) y populate desde el paginador; cuando falte, degradar a `historicalComplete=false` (conservador).

### 3. Ejecución segura

1. Aplicar migración vía la herramienta de migraciones de Lovable Cloud (una sola tanda).
2. Verificar en el mismo turno con `supabase--linter`.
3. Ejecutar `syncOneSource({ scope: 'full' })` para Cursor Community y observar `event_sync_jobs.status` hasta `completed`.
4. Repetir para los otros 5 calendarios API.

### 4. Rollback

- La migración es aditiva salvo el DROP de la constraint global. Rollback controlado:
  ```sql
  -- si algo sale mal antes de fusionar, restaurar constraint global
  ALTER TABLE public.scraped_events
    ADD CONSTRAINT scraped_events_user_id_event_key_key UNIQUE (user_id, event_key);
  ```
  Solo viable si no hay filas duplicadas — validar con `SELECT user_id,event_key,count(*) FROM public.scraped_events GROUP BY 1,2 HAVING count(*)>1 LIMIT 1;` antes de intentarlo.
- `merge_calendar_rows` deja auditoría en `calendar_merge_audit`; para revertir una fusión hay que restaurar manualmente desde ese log (documentado, no automatizado).

### 5. Comprobaciones finales

Consultas de aceptación (owner):

```sql
-- 1. Constraint global eliminada
SELECT conname FROM pg_constraint
WHERE conrelid='public.scraped_events'::regclass
  AND conname='scraped_events_user_id_event_key_key'; -- 0 filas

-- 2. Índice por-calendario presente
SELECT indexname FROM pg_indexes
WHERE tablename='scraped_events' AND indexname='scraped_events_user_calendar_event_key';

-- 3. Cursor Community configurado full
SELECT id,curated_name,sync_all_events,event_limit,sync_status,historical_sync_completed_at
FROM public.user_luma_calendars
WHERE luma_calendar_id='cal-61Cv6COs4g9GKw7' AND merged_into_id IS NULL;

-- 4. Duplicados nombrados resueltos
SELECT lower(coalesce(curated_name,remote_name,calendar_name,'')) name, count(*)
FROM public.user_luma_calendars
WHERE user_id=$owner AND merged_into_id IS NULL
  AND lower(coalesce(curated_name,remote_name,calendar_name,'')) = ANY(ARRAY[
    'cursor lima, peru','cursor arequipa, peru','flit festival',
    'hack0 community','notion arequipa','ignacio velasquez','ignacio velasquez profile'
  ])
GROUP BY 1; -- cada uno debe tener count=1

-- 5. Cursor Community después del full sync
SELECT count(*) total,
       count(*) FILTER (WHERE start_at > now()) upcoming,
       count(*) FILTER (WHERE start_at <= now()) past
FROM public.canonical_events e
JOIN public.event_sources s ON s.canonical_event_id=e.id
WHERE s.calendar_row_id = (SELECT id FROM public.user_luma_calendars
                           WHERE luma_calendar_id='cal-61Cv6COs4g9GKw7' AND merged_into_id IS NULL);
-- esperado: 927 total, 81 upcoming, 846 past (±ventana de tiempo)

-- 6. Sin jobs duplicados activos
SELECT source_id,count(*) FROM public.event_sync_jobs
WHERE status IN ('queued','running') GROUP BY 1 HAVING count(*)>1; -- 0 filas
```

Verificación UI: recargar `/settings`, confirmar que Cursor Community aparece en `running`→`completed`, y que los 6 calendarios objetivo aparecen una sola vez con logo/orden/default preservados.

## Fuera de alcance (proponer en un plan siguiente)

- Consolidación de los ~55 duplicados restantes del owner (necesitamos su mapeo explícito).
- Cron de mantenimiento (`upcoming + ventana reciente de past`): ya cubierto por `resolveSyncScope`; sólo hace falta comprobar el schedule después de que el full sync termine.
