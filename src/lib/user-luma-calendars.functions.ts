// Multi-calendar Luma key management. Each user can save N calendars,
// with one flagged as default. All reads/writes go through the service
// role client but always scope by the authenticated userId.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type UserCalendarDTO = {
  id: string; // uuid PK of the row
  calendarId: string;
  canonicalCalendarId: string | null;
  name: string;
  slug: string | null;
  avatarUrl: string | null;
  url: string | null;
  isDefault: boolean;
  source: "api" | "scrape";
  sourceKind: "api" | "calendar" | "profile" | "event";
  aliases: string[];
  coverUrl: string | null;
  description: string | null;
  color: string | null;
  eventCount: number;
  upcomingCount: number;
  pastCount: number;
  unknownCount: number;
  syncStatus: string;
  syncError: string | null;
  lastSyncedAt: string | null;
  lastSyncAttemptedAt: string | null;
  historicalSyncCompletedAt: string | null;
  lastSyncScope: "full" | "maintenance" | null;
  hasApiConnection: boolean;
  hasPublicLink: boolean;
  apiConnectionStatus: "connected" | "needs_attention" | null;
  groupId: string | null;
  groupName: string | null;
  groupOrder: number | null;
  order: number;
  suggestedGroupName: string | null;
  suggestedGroupReason: string | null;
  nextEventAt: string | null;
  organizationManual: boolean;
  provider: "luma" | "eventbrite" | "meetup";
  ownership: "connected" | "external";
  providerSourceId: string | null;
  brandKitId: string | null;
  syncAllEvents: boolean;
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
  last_sync_attempted_at?: string | null;
  historical_sync_completed_at?: string | null;
  last_sync_scope?: "full" | "maintenance" | null;
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
  luma_calendar_id?: string | null;
  merged_into_id?: string | null;
  provider?: "luma" | "eventbrite" | "meetup" | null;
  provider_source_id?: string | null;
  provider_connection_id?: string | null;
  ownership?: "connected" | "external" | null;
  sync_all_events?: boolean | null;
  brand_kit_id?: string | null;
};

export type CalendarGroupRow = {
  id: string;
  user_id: string;
  name: string;
  sort_order: number;
};

function toDTO(
  r: Row,
  groups = new Map<string, CalendarGroupRow>(),
  aliases: string[] = [],
  eventStats?: { total: number; upcoming: number; past: number; unknown: number },
): UserCalendarDTO {
  const group = r.group_id ? groups.get(r.group_id) : null;
  return {
    id: r.id,
    calendarId: r.calendar_id,
    canonicalCalendarId: r.luma_calendar_id ?? null,
    name: r.calendar_name ?? "Your calendar",
    slug: r.calendar_slug,
    avatarUrl: r.calendar_avatar_url,
    url: r.calendar_url,
    isDefault: r.is_default,
    source: (r.source ?? "api") as "api" | "scrape",
    sourceKind: r.source_kind ?? (r.source === "api" ? "api" : "calendar"),
    aliases,
    coverUrl: r.calendar_cover_url ?? null,
    description: r.calendar_description ?? null,
    color: r.calendar_tint_color ?? null,
    eventCount: eventStats?.total ?? r.imported_count ?? 0,
    upcomingCount: eventStats?.upcoming ?? 0,
    pastCount: eventStats?.past ?? 0,
    unknownCount: eventStats?.unknown ?? 0,
    syncStatus: r.sync_status ?? "idle",
    syncError: r.sync_error ?? null,
    lastSyncedAt: r.last_synced_at ?? null,
    lastSyncAttemptedAt: r.last_sync_attempted_at ?? null,
    historicalSyncCompletedAt: r.historical_sync_completed_at ?? null,
    lastSyncScope: r.last_sync_scope ?? null,
    hasApiConnection:
      (r.provider ?? "luma") === "luma"
        ? Boolean(r.api_key_ciphertext)
        : Boolean(r.provider_connection_id),
    hasPublicLink: Boolean(r.calendar_url),
    apiConnectionStatus:
      (r.provider ?? "luma") === "luma" && r.api_key_ciphertext
        ? r.source_metadata?.apiAuthStatus === "needs_attention"
          ? "needs_attention"
          : "connected"
        : r.provider_connection_id
          ? "connected"
          : null,
    groupId: r.group_id ?? null,
    groupName: group?.name ?? null,
    groupOrder: group?.sort_order ?? null,
    order: r.sort_order ?? 0,
    suggestedGroupName: r.suggested_group_name ?? null,
    suggestedGroupReason: r.suggested_group_reason ?? null,
    nextEventAt:
      typeof r.source_metadata?.nextEventAt === "string" ? r.source_metadata.nextEventAt : null,
    organizationManual: r.organization_manual ?? false,
    provider: r.provider ?? "luma",
    ownership: r.ownership ?? (r.source === "api" ? "connected" : "external"),
    providerSourceId: r.provider_source_id ?? null,
    brandKitId: r.brand_kit_id ?? null,
    syncAllEvents: r.sync_all_events ?? false,
  };
}

export async function readUserCalendars(userId: string): Promise<Row[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_luma_calendars" as never)
    .select(
      "id, user_id, calendar_id, calendar_name, calendar_slug, calendar_avatar_url, calendar_url, api_key_ciphertext, is_default, source, source_kind, curated_name, remote_name, sync_status, sync_error, discovered_count, imported_count, last_synced_at, last_sync_attempted_at, historical_sync_completed_at, last_sync_scope, next_sync_at, calendar_cover_url, calendar_description, calendar_tint_color, metadata_version, group_id, sort_order, suggested_group_name, suggested_group_reason, source_metadata, organization_manual, luma_calendar_id, merged_into_id, provider, provider_source_id, provider_connection_id, ownership, sync_all_events, brand_kit_id",
    )
    .eq("user_id", userId)
    .is("merged_into_id", null)
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
  const { resolveCanonicalCalendarRowId } = await import("./calendar-identity.server");
  const resolvedRowId = calendarId ? await resolveCanonicalCalendarRowId(userId, calendarId) : null;
  const picked =
    (resolvedRowId && rows.find((r) => r.id === resolvedRowId)) ||
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
      const { readCalendarAliases } = await import("./calendar-identity.server");
      const { readEventLibraryStats } = await import("./event-library-stats.functions");
      const eventStats = await readEventLibraryStats(context.userId, context.supabase);
      const eventStatsByCalendar = new Map(
        eventStats.calendars.map((stats) => [stats.calendarRowId, stats]),
      );
      const aliases = await readCalendarAliases(
        context.userId,
        rows.map((row) => row.id),
      );
      const groupMap = new Map(groups.map((group) => [group.id, group]));
      return rows
        .map((row) =>
          toDTO(row, groupMap, aliases.get(row.id) ?? [], eventStatsByCalendar.get(row.id)),
        )
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
    const { resolveCanonicalCalendarRowId, registerLumaCalendarIdentity, addCalendarAliases } =
      await import("./calendar-identity.server");

    // First calendar becomes default automatically.
    const existing = await readUserCalendars(context.userId);
    const isFirst = existing.length === 0;

    const canonicalRowId = await resolveCanonicalCalendarRowId(context.userId, cal.id);
    const existingCanonical = canonicalRowId
      ? existing.find((calendar) => calendar.id === canonicalRowId)
      : null;
    const values = {
      user_id: context.userId,
      ...(canonicalRowId
        ? {}
        : { calendar_id: cal.id, luma_calendar_id: cal.id, is_default: isFirst }),
      calendar_name: cal.name,
      remote_name: cal.name,
      calendar_slug: cal.slug,
      calendar_avatar_url: cal.avatar_url,
      calendar_url: cal.url,
      api_key_ciphertext: encryptString(data.apiKey),
      source: "api",
      source_kind: "api",
      provider: "luma",
      provider_source_id: cal.id,
      ownership: "connected",
      sync_error: null,
      source_metadata: {
        ...(existingCanonical?.source_metadata ?? {}),
        apiAuthStatus: "connected",
        apiError: null,
      },
      updated_at: new Date().toISOString(),
    };
    const query = canonicalRowId
      ? supabaseAdmin
          .from("user_luma_calendars" as never)
          .update(values as never)
          .eq("id", canonicalRowId)
          .eq("user_id", context.userId)
      : supabaseAdmin
          .from("user_luma_calendars" as never)
          .upsert(values as never, { onConflict: "user_id,calendar_id" });
    const { data: row, error } = await query
      .select(
        "id, user_id, calendar_id, calendar_name, calendar_slug, calendar_avatar_url, calendar_url, api_key_ciphertext, is_default, source, source_kind, luma_calendar_id, merged_into_id",
      )
      .single();
    if (error) throw new Error(error.message);
    const winnerId = await registerLumaCalendarIdentity(context.userId, (row as Row).id, cal.id);
    await addCalendarAliases(context.userId, winnerId, [
      { value: (row as Row).calendar_id, kind: "legacy_id" },
      { value: cal.id, kind: "luma_id" },
      { value: cal.url, kind: "url" },
      { value: cal.slug, kind: "slug" },
    ]);
    const { enqueueSource } = await import("./calendar-sync.server");
    await enqueueSource(context.userId, winnerId, "manual");
    const winner = (await readUserCalendars(context.userId)).find(
      (calendar) => calendar.id === winnerId,
    );
    if (!winner) throw new Error("Canonical calendar was not found after registration");
    const { readCalendarAliases } = await import("./calendar-identity.server");
    const aliases = await readCalendarAliases(context.userId, [winnerId]);
    return toDTO(winner, new Map(), aliases.get(winnerId) ?? []);
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
    const { invalidateEventLibraryStatsCache } = await import("./event-library-stats.functions");
    invalidateEventLibraryStatsCache(context.userId);
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
