import { classifyEventTags, TAXONOMY_VERSION, type TagNamespace } from "./event-tagging";

export type EventTagDTO = {
  namespace: TagNamespace;
  slug: string;
  label: string;
  origin: "system" | "manual";
  state: "active" | "dismissed";
  confidence: number | null;
  taxonomyVersion: number;
};

export async function refreshCanonicalEventTags(userId: string, canonicalEventId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: event, error } = await supabaseAdmin
    .from("canonical_events" as never)
    .select("name,description,event_format,topics,audience,is_online")
    .eq("id", canonicalEventId)
    .eq("user_id", userId)
    .single();
  if (error || !event) return;
  const input = event as Record<string, unknown>;
  const candidates = classifyEventTags({
    name: String(input.name ?? ""),
    description: typeof input.description === "string" ? input.description : null,
    format: typeof input.event_format === "string" ? input.event_format : null,
    topics: Array.isArray(input.topics) ? input.topics.map(String) : [],
    audience: Array.isArray(input.audience) ? input.audience.map(String) : [],
    isOnline: typeof input.is_online === "boolean" ? input.is_online : null,
  });
  const { data: definitions } = await supabaseAdmin
    .from("event_tag_definitions" as never)
    .select("id,namespace,slug")
    .eq("taxonomy_version", TAXONOMY_VERSION)
    .eq("active", true);
  const ids = new Map(
    (
      (definitions as Array<{ id: string; namespace: TagNamespace; slug: string }> | null) ?? []
    ).map((definition) => [`${definition.namespace}:${definition.slug}`, definition.id]),
  );
  const { data: existing } = await supabaseAdmin
    .from("canonical_event_tags" as never)
    .select("tag_id,state,origin")
    .eq("user_id", userId)
    .eq("canonical_event_id", canonicalEventId);
  const protectedIds = new Set(
    ((existing as Array<{ tag_id: string; state: string; origin: string }> | null) ?? [])
      .filter((tag) => tag.origin === "manual")
      .map((tag) => tag.tag_id),
  );
  for (const candidate of candidates) {
    const tagId = ids.get(`${candidate.namespace}:${candidate.slug}`);
    if (!tagId || protectedIds.has(tagId)) continue;
    await supabaseAdmin.from("canonical_event_tags" as never).upsert(
      {
        user_id: userId,
        canonical_event_id: canonicalEventId,
        tag_id: tagId,
        origin: "system",
        state: candidate.confidence >= 0.8 ? "active" : "dismissed",
        confidence: candidate.confidence,
        classifier_version: TAXONOMY_VERSION,
      } as never,
      { onConflict: "user_id,canonical_event_id,tag_id" },
    );
  }
}
