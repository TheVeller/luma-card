import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { TAXONOMY_VERSION, type TagNamespace } from "./event-tagging";
import type { EventTagDTO } from "./event-tags.server";

const TagInput = z.object({
  namespace: z.enum(["format", "topic", "audience"]),
  slug: z.string().min(1).max(80),
});
const EventIds = z.array(z.string().uuid()).min(1).max(200);

type DefinitionRow = {
  id: string;
  namespace: TagNamespace;
  slug: string;
  label: string;
  taxonomy_version: number;
};
type AssignmentRow = {
  tag_id: string;
  origin: "system" | "manual";
  state: "active" | "dismissed";
  confidence: number | null;
  classifier_version: number | null;
};

function mapTags(definitions: DefinitionRow[], assignments: AssignmentRow[]): EventTagDTO[] {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  return assignments
    .map((assignment) => {
      const definition = byId.get(assignment.tag_id);
      if (!definition) return null;
      return {
        namespace: definition.namespace,
        slug: definition.slug,
        label: definition.label,
        origin: assignment.origin,
        state: assignment.state,
        confidence: assignment.confidence,
        taxonomyVersion: definition.taxonomy_version,
      } satisfies EventTagDTO;
    })
    .filter((tag): tag is EventTagDTO => Boolean(tag));
}

export const listEventTagDefinitions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("event_tag_definitions" as never)
      .select("id,namespace,slug,label,taxonomy_version")
      .eq("active", true)
      .eq("taxonomy_version", TAXONOMY_VERSION)
      .order("namespace")
      .order("label");
    if (error) throw new Error(error.message);
    return (data as DefinitionRow[] | null) ?? [];
  });

export const listEventTags = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ eventIds: EventIds }).parse(value))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [
      { data: definitions, error: definitionError },
      { data: assignments, error: assignmentError },
    ] = await Promise.all([
      supabaseAdmin
        .from("event_tag_definitions" as never)
        .select("id,namespace,slug,label,taxonomy_version")
        .eq("active", true),
      supabaseAdmin
        .from("canonical_event_tags" as never)
        .select("canonical_event_id,tag_id,origin,state,confidence,classifier_version")
        .eq("user_id", context.userId)
        .in("canonical_event_id", data.eventIds),
    ]);
    if (definitionError || assignmentError)
      throw new Error(definitionError?.message ?? assignmentError?.message);
    const definitionRows = (definitions as DefinitionRow[] | null) ?? [];
    const grouped = new Map<string, AssignmentRow[]>();
    for (const assignment of (assignments as Array<
      AssignmentRow & { canonical_event_id: string }
    > | null) ?? []) {
      const current = grouped.get(assignment.canonical_event_id) ?? [];
      current.push(assignment);
      grouped.set(assignment.canonical_event_id, current);
    }
    return Object.fromEntries(
      data.eventIds.map((id) => [id, mapTags(definitionRows, grouped.get(id) ?? [])]),
    );
  });

async function updateTags(
  userId: string,
  eventIds: string[],
  tags: Array<z.infer<typeof TagInput>>,
  mode: "add" | "remove" | "accept" | "dismiss",
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: definitions, error: definitionError } = await supabaseAdmin
    .from("event_tag_definitions" as never)
    .select("id,namespace,slug")
    .eq("active", true)
    .eq("taxonomy_version", TAXONOMY_VERSION);
  if (definitionError) throw new Error(definitionError.message);
  const definitionIds = new Map(
    (
      (definitions as Array<{ id: string; namespace: TagNamespace; slug: string }> | null) ?? []
    ).map((definition) => [`${definition.namespace}:${definition.slug}`, definition.id]),
  );
  for (const eventId of eventIds) {
    for (const tag of tags) {
      const tagId = definitionIds.get(`${tag.namespace}:${tag.slug}`);
      if (!tagId) throw new Error(`Unknown tag: ${tag.namespace}:${tag.slug}`);
      if (mode === "add" || mode === "accept") {
        await supabaseAdmin.from("canonical_event_tags" as never).upsert(
          {
            user_id: userId,
            canonical_event_id: eventId,
            tag_id: tagId,
            origin: mode === "add" ? "manual" : "system",
            state: "active",
            confidence: mode === "add" ? 1 : null,
            classifier_version: TAXONOMY_VERSION,
          } as never,
          { onConflict: "user_id,canonical_event_id,tag_id" },
        );
      } else {
        await supabaseAdmin.from("canonical_event_tags" as never).upsert(
          {
            user_id: userId,
            canonical_event_id: eventId,
            tag_id: tagId,
            origin: mode === "dismiss" ? "system" : "manual",
            state: mode === "dismiss" ? "dismissed" : "dismissed",
            confidence: null,
            classifier_version: TAXONOMY_VERSION,
          } as never,
          { onConflict: "user_id,canonical_event_id,tag_id" },
        );
      }
    }
  }
  return { updated: eventIds.length * tags.length };
}

export const updateEventTags = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) =>
    z
      .object({
        eventIds: EventIds,
        tags: z.array(TagInput).min(1).max(20),
        mode: z.enum(["add", "remove", "accept", "dismiss"]),
      })
      .parse(value),
  )
  .handler(({ data, context }) => updateTags(context.userId, data.eventIds, data.tags, data.mode));

export type SavedEventViewDTO = {
  id: string;
  name: string;
  filters: SavedEventViewFilters;
  sortMode: string;
  viewMode: string;
  updatedAt: string;
};

export type SavedEventViewFilters = {
  search?: string;
  provider?: string;
  online?: string;
  tag?: string;
  formats?: string[];
  topics?: string[];
  audiences?: string[];
  cities?: string[];
  countries?: string[];
  languages?: string[];
  dateFrom?: string;
  dateTo?: string;
};

export const listSavedEventViews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("saved_event_views" as never)
      .select("id,name,filters,sort_mode,view_mode,updated_at")
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (
      (data as Array<{
        id: string;
        name: string;
        filters: SavedEventViewFilters;
        sort_mode: string;
        view_mode: string;
        updated_at: string;
      }> | null) ?? []
    ).map((row) => ({
      id: row.id,
      name: row.name,
      filters: row.filters,
      sortMode: row.sort_mode,
      viewMode: row.view_mode,
      updatedAt: row.updated_at,
    }));
  });

export const saveEventView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(80),
        filters: z.object({
          search: z.string().optional(),
          provider: z.string().optional(),
          online: z.string().optional(),
          tag: z.string().optional(),
          formats: z.array(z.string()).optional(),
          topics: z.array(z.string()).optional(),
          audiences: z.array(z.string()).optional(),
          cities: z.array(z.string()).optional(),
          countries: z.array(z.string()).optional(),
          languages: z.array(z.string()).optional(),
          dateFrom: z.string().optional(),
          dateTo: z.string().optional(),
        }),
        sortMode: z.string().max(30),
        viewMode: z.string().max(30),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const query = data.id
      ? supabaseAdmin
          .from("saved_event_views" as never)
          .update({
            name: data.name,
            filters: data.filters,
            sort_mode: data.sortMode,
            view_mode: data.viewMode,
          } as never)
          .eq("id", data.id)
          .eq("user_id", context.userId)
      : supabaseAdmin.from("saved_event_views" as never).insert({
          user_id: context.userId,
          name: data.name,
          filters: data.filters,
          sort_mode: data.sortMode,
          view_mode: data.viewMode,
        } as never);
    const { error } = await query;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteEventView = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ id: z.string().uuid() }).parse(value))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("saved_event_views" as never)
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
