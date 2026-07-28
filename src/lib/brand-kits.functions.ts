import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { StyleSpecSchema, normalizeStyleSpec, type StyleSpec } from "./style-spec";
import { BadgeDocSchema, type BadgeDoc } from "./badge-doc/schema";

export type BrandKitDTO = {
  id: string;
  name: string;
  styleSpec: StyleSpec;
  badgeDoc: BadgeDoc | null;
  logos: string[];
  isDefault: boolean;
};

function mapKit(row: {
  id: string;
  name: string;
  style_spec: unknown;
  badge_doc: unknown;
  logos: unknown;
  is_default: boolean;
}): BrandKitDTO {
  const style = StyleSpecSchema.safeParse(row.style_spec);
  const doc = BadgeDocSchema.safeParse(row.badge_doc);
  return {
    id: row.id,
    name: row.name,
    styleSpec: normalizeStyleSpec(style.success ? style.data : {}),
    badgeDoc: doc.success ? doc.data : null,
    logos: Array.isArray(row.logos)
      ? row.logos.filter((logo): logo is string => typeof logo === "string").slice(0, 4)
      : [],
    isDefault: row.is_default,
  };
}

export const listBrandKits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BrandKitDTO[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("brand_kits" as never)
      .select("id,name,style_spec,badge_doc,logos,is_default")
      .eq("user_id", context.userId)
      .order("is_default", { ascending: false })
      .order("name");
    if (error) {
      if (/schema cache|does not exist/i.test(error.message)) return [];
      throw new Error(error.message);
    }
    return ((data as Array<Parameters<typeof mapKit>[0]> | null) ?? []).map(mapKit);
  });

export const saveBrandKit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(80),
        styleSpec: StyleSpecSchema,
        badgeDoc: BadgeDocSchema.nullable().optional(),
        logos: z.array(z.string().url()).max(4).default([]),
        isDefault: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<BrandKitDTO> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.isDefault) {
      await supabaseAdmin
        .from("brand_kits" as never)
        .update({ is_default: false } as never)
        .eq("user_id", context.userId);
    }
    const values = {
      user_id: context.userId,
      name: data.name,
      style_spec: normalizeStyleSpec(data.styleSpec),
      badge_doc: data.badgeDoc ?? null,
      logos: data.logos,
      is_default: data.isDefault,
      updated_at: new Date().toISOString(),
    };
    const query = data.id
      ? supabaseAdmin
          .from("brand_kits" as never)
          .update(values as never)
          .eq("id", data.id)
          .eq("user_id", context.userId)
      : supabaseAdmin.from("brand_kits" as never).insert(values as never);
    const { data: row, error } = await query
      .select("id,name,style_spec,badge_doc,logos,is_default")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Brand kit could not be saved");
    return mapKit(row as unknown as Parameters<typeof mapKit>[0]);
  });

export const assignCalendarBrandKit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ calendarId: z.string().uuid(), brandKitId: z.string().uuid().nullable() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.brandKitId) {
      const { count } = await supabaseAdmin
        .from("brand_kits" as never)
        .select("id", { count: "exact", head: true })
        .eq("id", data.brandKitId)
        .eq("user_id", context.userId);
      if (!count) throw new Error("Brand kit does not belong to this account");
    }
    const { error } = await supabaseAdmin
      .from("user_luma_calendars" as never)
      .update({ brand_kit_id: data.brandKitId } as never)
      .eq("id", data.calendarId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getEventBrandKit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ eventId: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }): Promise<BrandKitDTO | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: scraped } = await supabaseAdmin
      .from("scraped_events" as never)
      .select("calendar_id")
      .eq("user_id", context.userId)
      .eq("event_key", data.eventId)
      .maybeSingle();
    let calendarRowId = (scraped as { calendar_id?: string } | null)?.calendar_id ?? null;
    if (!calendarRowId) {
      const { data: source } = await supabaseAdmin
        .from("event_sources" as never)
        .select("calendar_row_id")
        .eq("user_id", context.userId)
        .eq("external_event_id", data.eventId)
        .limit(1)
        .maybeSingle();
      calendarRowId = (source as { calendar_row_id?: string } | null)?.calendar_row_id ?? null;
    }
    let brandKitId: string | null = null;
    let owned = false;
    if (calendarRowId) {
      const { data: calendar } = await supabaseAdmin
        .from("user_luma_calendars" as never)
        .select("brand_kit_id,ownership")
        .eq("id", calendarRowId)
        .eq("user_id", context.userId)
        .maybeSingle();
      brandKitId = (calendar as { brand_kit_id?: string | null } | null)?.brand_kit_id ?? null;
      owned = (calendar as { ownership?: string } | null)?.ownership === "connected";
    }
    if (!owned) return null;
    let query = supabaseAdmin
      .from("brand_kits" as never)
      .select("id,name,style_spec,badge_doc,logos,is_default")
      .eq("user_id", context.userId);
    query = brandKitId ? query.eq("id", brandKitId) : query.eq("is_default", true);
    const { data: row, error } = await query.limit(1).maybeSingle();
    if (error) {
      if (/schema cache|does not exist/i.test(error.message)) return null;
      throw new Error(error.message);
    }
    return row ? mapKit(row as unknown as Parameters<typeof mapKit>[0]) : null;
  });
