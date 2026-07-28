// Multi-calendar Luma key management. Each user can save N calendars,
// with one flagged as default. All reads/writes go through the service
// role client but always scope by the authenticated userId.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type UserCalendarDTO = {
  id: string; // uuid PK of the row
  calendarId: string;
  name: string;
  slug: string | null;
  avatarUrl: string | null;
  url: string | null;
  isDefault: boolean;
  source: "api" | "scrape";
  coverUrl: string | null;
  description: string | null;
  color: string | null;
  eventCount: number;
  syncStatus: string;
  groupId: string | null;
  groupName: string | null;
  groupOrder: number | null;
  order: number;
  suggestedGroupName: string | null;
  suggestedGroupReason: string | null;
  nextEventAt: string | null;
  organizationManual: boolean;
};

export type Row = {
  id: string;
  user_id: string;
  calendar_id: string;
  calendar_name: string | null;
  calendar_slug: string | null;
  calendar_avatar_url: string | null;
  calendar_url: string | null;
  api_key_ciphertext: string | null;
  is_default: boolean;
  source?: "api" | "scrape" | null;
  source_kind?: "api" | "calendar" | "profile" | "event" | null;
  curated_name?: string | null;
  remote_name?: string | null;
  sync_status?: string | null;
  sync_error?: string | null;
  discovered_count?: number | null;
  imported_count?: number | null;
  last_synced_at?: string | null;
  next_sync_at?: string | null;
  calendar_cover_url?: string | null;
  calendar_description?: string | null;
  calendar_tint_color?: string | null;
  metadata_version?: number | null;
  group_id?: string | null;
  sort_order?: number | null;
  suggested_group_name?: string | null;
  suggested_group_reason?: string | null;
  source_metadata?: Record<string, unknown> | null;
  organization_manual?: boolean | null;
};

export type CalendarGroupRow = {
  id: string;
  user_id: string;
  name: string;
  sort_order: number;
};

function toDTO(r: Row, groups = new Map<string, CalendarGroupRow>()): UserCalendarDTO {
  const group = r.group_id ? groups.get(r.group_id) : null;
  return {
    id: r.id,
    calendarId: r.calendar_id,
    name: r.calendar_name ?? "Your calendar",
    slug: r.calendar_slug,
    avatarUrl: r.calendar_avatar_url,
    url: r.calendar_url,
    isDefault: r.is_default,
    source: (r.source ?? "api") as "api" | "scrape",
    coverUrl: r.calendar_cover_url ?? null,
    description: r.calendar_description ?? null,
    color: r.calendar_tint_color ?? null,
    eventCount: r.imported_count ?? 0,
    syncStatus: r.sync_status ?? "idle",
    groupId: r.group_id ?? null,
    groupName: group?.name ?? null,
    groupOrder: group?.sort_order ?? null,
    order: r.sort_order ?? 0,
    suggestedGroupName: r.suggested_group_name ?? null,
    suggestedGroupReason: r.suggested_group_reason ?? null,
    nextEventAt:
      typeof r.source_metadata?.nextEventAt === "string" ? r.source_metadata.nextEventAt : null,
    organizationManual: r.organization_manual ?? false,
  };
}

export async function readUserCalendars(userId: string): Promise<Row[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_luma_calendars" as never)
    .select(
      "id, user_id, calendar_id, calendar_name, calendar_slug, calendar_avatar_url, calendar_url, api_key_ciphertext, is_default, source, source_kind, curated_name, remote_name, sync_status, sync_error, discovered_count, imported_count, last_synced_at, next_sync_at, calendar_cover_url, calendar_description, calendar_tint_color, metadata_version, group_id, sort_order, suggested_group_name, suggested_group_reason, source_metadata, organization_manual",
    )
    .eq("user_id", userId)
    .order("is_default", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return (data as Row[] | null) ?? [];
}

export async function readCalendarGroups(userId: string): Promise<CalendarGroupRow[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("calendar_groups" as never)
    .select("id,user_id,name,sort_order")
    .eq("user_id", userId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as CalendarGroupRow[] | null) ?? [];
}

async function resolveKeyFromRow(row: Row): Promise<string | null> {
  if (!row.api_key_ciphertext) return null;
  const { decryptString } = await import("./crypto.server");
  try {
    return decryptString(row.api_key_ciphertext);
  } catch {
    return null;
  }
}

/** Returns decrypted API key for a specific calendarId, or the default. */
export async function resolveKeyForCalendar(
  userId: string,
  calendarId?: string | null,
): Promise<{ key: string; row: Row } | null> {
  const rows = await readUserCalendars(userId);
  if (rows.length === 0) return null;
  const picked =
    (calendarId && rows.find((r) => r.calendar_id === calendarId)) ||
    rows.find((r) => r.is_default) ||
    rows[0];
  const key = await resolveKeyFromRow(picked);
  if (!key) return null;
  return { key, row: picked };
}

/** Returns [{key, row}, ...] for every calendar the user has. */
export async function resolveAllKeys(userId: string): Promise<Array<{ key: string; row: Row }>> {
  const rows = await readUserCalendars(userId);
  const out: Array<{ key: string; row: Row }> = [];
  for (const r of rows) {
    const k = await resolveKeyFromRow(r);
    if (k) out.push({ key: k, row: r });
  }
  return out;
}

export const listCalendars = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UserCalendarDTO[]> => {
    try {
      const { ensureOwnerCuratedCatalog } = await import("./calendar-sync.server");
      await ensureOwnerCuratedCatalog(context.userId);
      const rows = await readUserCalendars(context.userId);
      const groups = await readCalendarGroups(context.userId);
      const groupMap = new Map(groups.map((group) => [group.id, group]));
      return rows
        .map((row) => toDTO(row, groupMap))
        .sort(
          (a, b) =>
            (a.groupOrder ?? Number.MAX_SAFE_INTEGER) - (b.groupOrder ?? Number.MAX_SAFE_INTEGER) ||
            (a.organizationManual || b.organizationManual
              ? a.order - b.order
              : Number(b.eventCount > 0) - Number(a.eventCount > 0) ||
                (a.nextEventAt ? Date.parse(a.nextEventAt) : Number.MAX_SAFE_INTEGER) -
                  (b.nextEventAt ? Date.parse(b.nextEventAt) : Number.MAX_SAFE_INTEGER)) ||
            a.name.localeCompare(b.name),
        );
    } catch (e) {
      // The calendar switcher sits in the header of every authenticated page,
      // so an environment with no server credentials must not take the whole
      // app down with it. Degrade to "no calendars"; the events page is where
      // the misconfiguration gets explained.
      const { isSupabaseNotConfigured } = await import("@/integrations/supabase/client.server");
      if (isSupabaseNotConfigured(e)) return [];
      throw e;
    }
  });

export const addCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ apiKey: z.string().trim().min(8).max(200) }).parse(d))
  .handler(async ({ data, context }): Promise<UserCalendarDTO> => {
    const { fetchCalendar } = await import("./luma.server");
    const cal = await fetchCalendar(data.apiKey);
    const { encryptString } = await import("./crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // First calendar becomes default automatically.
    const existing = await readUserCalendars(context.userId);
    const isFirst = existing.length === 0;

    const { data: row, error } = await supabaseAdmin
      .from("user_luma_calendars" as never)
      .upsert(
        {
          user_id: context.userId,
          calendar_id: cal.id,
          calendar_name: cal.name,
          calendar_slug: cal.slug,
          calendar_avatar_url: cal.avatar_url,
          calendar_url: cal.url,
          api_key_ciphertext: encryptString(data.apiKey),
          source_kind: "api",
          is_default: isFirst,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "user_id,calendar_id" },
      )
      .select(
        "id, user_id, calendar_id, calendar_name, calendar_slug, calendar_avatar_url, calendar_url, api_key_ciphertext, is_default",
      )
      .single();
    if (error) throw new Error(error.message);
    return toDTO(row as Row);
  });

export const removeCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Find the row we're deleting to know if it was default.
    const { data: target } = await supabaseAdmin
      .from("user_luma_calendars" as never)
      .select("id, is_default")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    const wasDefault = (target as { is_default?: boolean } | null)?.is_default ?? false;

    const { error } = await supabaseAdmin
      .from("user_luma_calendars" as never)
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);

    // If we removed the default, promote another to default.
    if (wasDefault) {
      const rest = await readUserCalendars(context.userId);
      if (rest.length > 0) {
        await supabaseAdmin
          .from("user_luma_calendars" as never)
          .update({ is_default: true } as never)
          .eq("id", rest[0].id);
      }
    }
    return { ok: true };
  });

export const setDefaultCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Clear all, then set the one row.
    await supabaseAdmin
      .from("user_luma_calendars" as never)
      .update({ is_default: false } as never)
      .eq("user_id", context.userId);
    const { error } = await supabaseAdmin
      .from("user_luma_calendars" as never)
      .update({ is_default: true } as never)
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
