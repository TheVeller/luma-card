import { normalizeCalendarAlias } from "./calendar-identity";

export async function resolveCanonicalCalendarRowId(
  userId: string,
  identifier: string | null | undefined,
): Promise<string | null> {
  if (!identifier || identifier === "all" || identifier === "__all__") return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc(
    "resolve_user_calendar_row_id" as never,
    { p_user_id: userId, p_identifier: identifier } as never,
  );
  if (error) {
    // During rolling deploys, retain direct-ID behavior until the migration lands.
    if (/schema cache|does not exist/i.test(error.message)) {
      const { data: direct } = await supabaseAdmin
        .from("user_luma_calendars" as never)
        .select("id")
        .eq("user_id", userId)
        .eq("calendar_id", identifier)
        .maybeSingle();
      return (direct as { id?: string } | null)?.id ?? null;
    }
    throw new Error(error.message);
  }
  return typeof data === "string" ? data : null;
}

export async function registerLumaCalendarIdentity(
  userId: string,
  calendarRowId: string,
  lumaCalendarId: string,
): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc(
    "register_luma_calendar_identity" as never,
    {
      p_user_id: userId,
      p_calendar_row_id: calendarRowId,
      p_luma_calendar_id: lumaCalendarId,
    } as never,
  );
  if (error) throw new Error(error.message);
  if (typeof data !== "string") throw new Error("Canonical calendar registration failed");
  return data;
}

export async function addCalendarAliases(
  userId: string,
  calendarRowId: string,
  aliases: Array<{ value: string | null | undefined; kind: string }>,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  for (const alias of aliases) {
    if (!alias.value) continue;
    const { error } = await supabaseAdmin.rpc(
      "add_calendar_alias" as never,
      {
        p_user_id: userId,
        p_calendar_id: calendarRowId,
        p_alias: alias.value,
        p_alias_kind: alias.kind,
      } as never,
    );
    if (error) throw new Error(error.message);
  }
}

export async function readCalendarAliases(
  userId: string,
  calendarIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (calendarIds.length === 0) return result;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_calendar_aliases" as never)
    .select("calendar_id,alias")
    .eq("user_id", userId)
    .in("calendar_id", calendarIds)
    .order("created_at", { ascending: true });
  if (error) {
    if (/schema cache|does not exist/i.test(error.message)) return result;
    throw new Error(error.message);
  }
  for (const row of (data as Array<{ calendar_id: string; alias: string }> | null) ?? []) {
    const values = result.get(row.calendar_id) ?? [];
    if (!values.includes(row.alias)) values.push(row.alias);
    result.set(row.calendar_id, values);
  }
  return result;
}

export function aliasCandidates(values: {
  calendarId?: string | null;
  lumaCalendarId?: string | null;
  url?: string | null;
  slug?: string | null;
}): Array<{ value: string; kind: string }> {
  const candidates = [
    values.calendarId && { value: values.calendarId, kind: "legacy_id" },
    values.lumaCalendarId && { value: values.lumaCalendarId, kind: "luma_id" },
    values.url && { value: normalizeCalendarAlias(values.url), kind: "url" },
    values.slug && { value: values.slug, kind: "slug" },
  ].filter((item): item is { value: string; kind: string } => Boolean(item));
  return [...new Map(candidates.map((candidate) => [candidate.value, candidate])).values()];
}
