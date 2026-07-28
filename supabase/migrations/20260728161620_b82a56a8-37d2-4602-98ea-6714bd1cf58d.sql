ALTER TABLE public.canonical_events
  ADD COLUMN IF NOT EXISTS external_ids jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.event_sources
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'luma',
  ADD COLUMN IF NOT EXISTS provider_event_id text,
  ADD COLUMN IF NOT EXISTS origin_provider_source_id text;

CREATE INDEX IF NOT EXISTS canonical_events_external_ids_idx
  ON public.canonical_events USING gin (external_ids);