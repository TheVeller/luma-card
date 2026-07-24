// Per-event style preset history: remember the exact StyleSpec used for
// each successful render so the user can re-apply it on future visits.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { StyleSpecSchema, normalizeStyleSpec, type StyleSpec } from "./style-spec";

export type EventStylePresetDTO = {
  id: string;
  eventId: string;
  label: string | null;
  styleSpec: StyleSpec;
  createdAt: string;
};

type Row = {
  id: string;
  event_id: string;
  label: string | null;
  style_spec: unknown;
  created_at: string;
};

function mapRow(r: Row): EventStylePresetDTO {
  const parsed = StyleSpecSchema.safeParse(r.style_spec);
  return {
    id: r.id,
    eventId: r.event_id,
    label: r.label,
    styleSpec: parsed.success ? normalizeStyleSpec(parsed.data) : normalizeStyleSpec({}),
    createdAt: r.created_at,
  };
}

async function hashSpec(spec: StyleSpec): Promise<string> {
  const canonical = JSON.stringify({
    style: spec.style,
    palette: spec.palette,
    heading: spec.fonts.heading,
    body: spec.fonts.body,
  });
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const listEventPresets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { eventId: string }) => d)
  .handler(async ({ data, context }): Promise<EventStylePresetDTO[]> => {
    const { data: rows, error } = await context.supabase
      .from("event_style_presets" as never)
      .select("id, event_id, label, style_spec, created_at")
      .eq("event_id", data.eventId)
      .order("created_at", { ascending: false })
      .limit(24);
    if (error) throw new Error(error.message);
    return ((rows ?? []) as unknown as Row[]).map(mapRow);
  });

export const saveEventPreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { eventId: string; styleSpec: StyleSpec; label?: string | null }) => d,
  )
  .handler(async ({ data, context }): Promise<EventStylePresetDTO | null> => {
    const spec = normalizeStyleSpec(data.styleSpec);
    const hash = await hashSpec(spec);
    const { data: row, error } = await context.supabase
      .from("event_style_presets" as never)
      .upsert(
        {
          user_id: context.userId,
          event_id: data.eventId,
          label: data.label ?? null,
          style_spec: spec,
          spec_hash: hash,
        } as never,
        { onConflict: "user_id,event_id,spec_hash", ignoreDuplicates: false },
      )
      .select("id, event_id, label, style_spec, created_at")
      .single();
    if (error) throw new Error(error.message);
    return row ? mapRow(row as unknown as Row) : null;
  });

export const deleteEventPreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("event_style_presets" as never)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
