import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GroupName = z.string().trim().min(1).max(60);

export const listCalendarGroups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { readCalendarGroups } = await import("./user-luma-calendars.functions");
    return readCalendarGroups(context.userId);
  });

export const createCalendarGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ name: GroupName }).parse(value))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("calendar_groups" as never)
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId);
    const { data: group, error } = await supabaseAdmin
      .from("calendar_groups" as never)
      .upsert({ user_id: context.userId, name: data.name, sort_order: count ?? 0 } as never, {
        onConflict: "user_id,name",
      })
      .select("id,name,sort_order")
      .single();
    if (error) throw new Error(error.message);
    return group as { id: string; name: string; sort_order: number };
  });

export const deleteCalendarGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ id: z.string().uuid() }).parse(value))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("calendar_groups" as never)
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const OrganizationInput = z.object({
  groupIds: z.array(z.string().uuid()).max(100),
  calendars: z
    .array(
      z.object({
        id: z.string().uuid(),
        groupId: z.string().uuid().nullable(),
        order: z.number().int().min(0).max(10_000),
      }),
    )
    .max(500),
});

export const saveCalendarOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => OrganizationInput.parse(value))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ownedGroups } = await supabaseAdmin
      .from("calendar_groups" as never)
      .select("id")
      .eq("user_id", context.userId);
    const owned = new Set(
      ((ownedGroups as Array<{ id: string }> | null) ?? []).map((group) => group.id),
    );
    if (
      data.groupIds.some((id) => !owned.has(id)) ||
      data.calendars.some((calendar) => calendar.groupId && !owned.has(calendar.groupId))
    ) {
      throw new Error("Calendar group does not belong to this account");
    }
    for (const [sortOrder, id] of data.groupIds.entries()) {
      const { error } = await supabaseAdmin
        .from("calendar_groups" as never)
        .update({ sort_order: sortOrder } as never)
        .eq("id", id)
        .eq("user_id", context.userId);
      if (error) throw new Error(error.message);
    }
    for (const calendar of data.calendars) {
      const { error } = await supabaseAdmin
        .from("user_luma_calendars" as never)
        .update({
          group_id: calendar.groupId,
          sort_order: calendar.order,
          organization_manual: true,
        } as never)
        .eq("id", calendar.id)
        .eq("user_id", context.userId);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const acceptCalendarGroupSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ calendarId: z.string().uuid() }).parse(value))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: calendar, error: calendarError } = await supabaseAdmin
      .from("user_luma_calendars" as never)
      .select("suggested_group_name")
      .eq("id", data.calendarId)
      .eq("user_id", context.userId)
      .single();
    if (calendarError) throw new Error(calendarError.message);
    const name = (calendar as { suggested_group_name: string | null }).suggested_group_name;
    if (!name) return { ok: true, skipped: true as const };
    const { data: existingGroup } = await supabaseAdmin
      .from("calendar_groups" as never)
      .select("id")
      .eq("user_id", context.userId)
      .eq("name", name)
      .maybeSingle();
    const { data: groups } = await supabaseAdmin
      .from("calendar_groups" as never)
      .select("id,sort_order")
      .eq("user_id", context.userId)
      .order("sort_order", { ascending: false })
      .limit(1);
    let groupId = (existingGroup as { id: string } | null)?.id;
    if (!groupId) {
      const { data: created, error: groupError } = await supabaseAdmin
        .from("calendar_groups" as never)
        .insert({
          user_id: context.userId,
          name,
          sort_order:
            (((groups as Array<{ sort_order: number }> | null) ?? [])[0]?.sort_order ?? -1) + 1,
        } as never)
        .select("id")
        .single();
      if (groupError) throw new Error(groupError.message);
      groupId = (created as { id: string }).id;
    }
    const { error } = await supabaseAdmin
      .from("user_luma_calendars" as never)
      .update({
        group_id: groupId,
        suggested_group_name: null,
        suggested_group_reason: null,
      } as never)
      .eq("id", data.calendarId)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
