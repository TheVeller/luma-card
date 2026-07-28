import {
  canonicalKeyFor,
  normalizeCanonicalUrl,
  sourceDTO,
  type SourceEventInput,
} from "./canonical-events";

export * from "./canonical-events";

export async function upsertCanonicalEventSource(
  userId: string,
  input: SourceEventInput,
): Promise<{ canonicalEventId: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const canonicalKey = canonicalKeyFor(input);
  const source = sourceDTO(input);
  const event = input.event;

  const { data: canonical, error: canonicalError } = await supabaseAdmin
    .from("canonical_events" as never)
    .upsert(
      {
        user_id: userId,
        canonical_key: canonicalKey,
        luma_event_id: /^evt-/i.test(input.externalEventId ?? event.id)
          ? (input.externalEventId ?? event.id)
          : null,
        name: event.name,
        url: normalizeCanonicalUrl(event.url) ?? event.url,
        cover_url: event.coverUrl,
        start_at: event.startAt,
        end_at: event.endAt ?? null,
        city: event.city ?? null,
        description: event.description ?? null,
        host_name: input.hostName ?? null,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "user_id,canonical_key" },
    )
    .select("id")
    .single();
  if (canonicalError) throw new Error(canonicalError.message);

  const canonicalEventId = (canonical as { id: string }).id;
  const { error: sourceError } = await supabaseAdmin.from("event_sources" as never).upsert(
    {
      user_id: userId,
      canonical_event_id: canonicalEventId,
      source_type: source.sourceType,
      source_key: source.sourceKey,
      calendar_row_id: input.calendarRowId ?? null,
      calendar_public_id: source.calendarId,
      calendar_name: source.calendarName,
      source_url: source.sourceUrl,
      external_event_id: source.externalEventId,
      host_name: source.hostName,
      payload: input.payload ?? {},
      last_synced_at: source.lastSyncedAt,
      updated_at: source.lastSyncedAt,
    } as never,
    { onConflict: "user_id,source_type,source_key" },
  );
  if (sourceError) throw new Error(sourceError.message);
  return { canonicalEventId };
}

function isMissingCanonicalSchema(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /canonical_events.*schema cache/i.test(message) ||
    /event_sources.*schema cache/i.test(message) ||
    /relation ["']?public\.(canonical_events|event_sources)["']? does not exist/i.test(message)
  );
}

/**
 * Keep imports usable while the canonical-event migration is being deployed.
 * Other database failures remain fatal so permission and data issues are visible.
 */
export async function tryUpsertCanonicalEventSource(
  userId: string,
  input: SourceEventInput,
): Promise<boolean> {
  try {
    await upsertCanonicalEventSource(userId, input);
    return true;
  } catch (error) {
    if (!isMissingCanonicalSchema(error)) throw error;
    console.warn(
      "[canonical-events] canonical tables are not installed; source persistence skipped",
    );
    return false;
  }
}
