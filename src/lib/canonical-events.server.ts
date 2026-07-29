import {
  canonicalKeyFor,
  eventIdentityFingerprint,
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
  const identityFingerprint = eventIdentityFingerprint(input);
  const source = sourceDTO(input);
  const event = input.event;
  const normalizedUrl = normalizeCanonicalUrl(event.url) ?? event.url;
  const providerExternalIds = {
    ...(input.provider === "eventbrite" ? { eventbrite: input.externalEventId ?? event.id } : {}),
    ...(input.provider === "meetup" ? { meetup: input.externalEventId ?? event.id } : {}),
    ...((input.provider ?? "luma") === "luma" && /^evt-/i.test(input.externalEventId ?? event.id)
      ? { luma: input.externalEventId ?? event.id }
      : {}),
  };
  const canonicalValues = {
    luma_event_id: /^evt-/i.test(input.externalEventId ?? event.id)
      ? (input.externalEventId ?? event.id)
      : null,
    name: event.name,
    url: normalizedUrl,
    cover_url: event.coverUrl,
    start_at: event.startAt,
    end_at: event.endAt ?? null,
    city: event.city ?? null,
    description: event.description ?? null,
    host_name: input.hostName ?? null,
    updated_at: new Date().toISOString(),
    identity_fingerprint: identityFingerprint,
    external_ids: providerExternalIds,
  };

  const { data: matchingUrl, error: matchingUrlError } = await supabaseAdmin
    .from("canonical_events" as never)
    .select("id,external_ids")
    .eq("user_id", userId)
    .eq("url", normalizedUrl)
    .maybeSingle();
  if (matchingUrlError) throw new Error(matchingUrlError.message);

  const { data: matchingFingerprint, error: matchingFingerprintError } = matchingUrl
    ? { data: null, error: null }
    : await supabaseAdmin
        .from("canonical_events" as never)
        .select("id,external_ids")
        .eq("user_id", userId)
        .eq("identity_fingerprint", identityFingerprint)
        .maybeSingle();
  if (matchingFingerprintError) throw new Error(matchingFingerprintError.message);
  const matchingCanonical = matchingUrl ?? matchingFingerprint;

  const canonicalQuery = matchingCanonical
    ? supabaseAdmin
        .from("canonical_events" as never)
        .update({
          ...canonicalValues,
          external_ids: {
            ...(((matchingCanonical as { external_ids?: Record<string, string> }).external_ids ??
              {}) as Record<string, string>),
            ...providerExternalIds,
          },
        } as never)
        .eq("id", (matchingCanonical as { id: string }).id)
    : supabaseAdmin.from("canonical_events" as never).upsert(
        {
          ...canonicalValues,
          user_id: userId,
          canonical_key: canonicalKey,
        } as never,
        { onConflict: "user_id,canonical_key" },
      );
  const { data: canonical, error: canonicalError } = await canonicalQuery.select("id").single();
  if (canonicalError) throw new Error(canonicalError.message);

  const canonicalEventId = (canonical as { id: string }).id;
  const sourceValues = {
    user_id: userId,
    canonical_event_id: canonicalEventId,
    source_type: source.sourceType,
    provider: source.provider,
    provider_event_id: source.externalEventId,
    origin_provider_source_id:
      typeof input.payload?.originCalendarApiId === "string"
        ? input.payload.originCalendarApiId
        : null,
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
  };
  let { error: sourceError } = await supabaseAdmin
    .from("event_sources" as never)
    .upsert(sourceValues as never, { onConflict: "user_id,source_type,source_key" });
  if (
    sourceError?.code === "23514" &&
    sourceError.message.includes("event_sources_source_type_check") &&
    !["api", "calendar_scrape", "event_scrape", "profile_scrape"].includes(source.sourceType)
  ) {
    const retry = await supabaseAdmin.from("event_sources" as never).upsert(
      {
        ...sourceValues,
        // Compatibility with databases where the provider columns landed
        // before the expanded source_type constraint.
        source_type: "calendar_scrape",
      } as never,
      { onConflict: "user_id,source_type,source_key" },
    );
    sourceError = retry.error;
  }
  if (sourceError) throw new Error(sourceError.message);
  return { canonicalEventId };
}

function isMissingCanonicalSchema(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /canonical_events.*schema cache/i.test(message) ||
    /identity_fingerprint.*schema cache/i.test(message) ||
    /external_ids.*schema cache/i.test(message) ||
    /event_sources.*schema cache/i.test(message) ||
    /(provider|provider_event_id|origin_provider_source_id).*schema cache/i.test(message) ||
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
