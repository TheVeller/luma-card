// Per-user Luma API key management.
//
// The primary storage is `user_luma_calendars` (multi-row, one per calendar).
// The legacy `user_luma_keys` (single row) is still read as a fallback for
// backwards compatibility; the multi-calendar migration backfilled all rows.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveKeyForCalendar, readUserCalendars } from "./user-luma-calendars.functions";

export type LumaCalendarDTO = {
  id: string;
  name: string;
  slug: string | null;
  avatarUrl: string | null;
  url: string | null;
};

export type LumaConfigDTO = {
  configured: boolean;
  calendar: LumaCalendarDTO | null;
};

const SEED_EMAIL = "ivelasquezfr@gmail.com";

async function getUserEmail(userId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  return data.user?.email ?? null;
}

async function ensureSeedForOwner(userId: string): Promise<void> {
  // Migrate the LUMA_API_KEY env into user_luma_calendars for the seed owner
  // if they still have no calendar row.
  const envKey = process.env.LUMA_API_KEY;
  if (!envKey) return;
  const email = await getUserEmail(userId);
  if (email?.toLowerCase() !== SEED_EMAIL) return;
  const existing = await readUserCalendars(userId);
  if (existing.length > 0) return;

  const { encryptString } = await import("./crypto.server");
  const { fetchCalendar } = await import("./luma.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  try {
    const cal = await fetchCalendar(envKey);
    await supabaseAdmin.from("user_luma_calendars" as never).insert({
      user_id: userId,
      calendar_id: cal.id,
      calendar_name: cal.name,
      calendar_slug: cal.slug,
      calendar_avatar_url: cal.avatar_url,
      calendar_url: cal.url,
      api_key_ciphertext: encryptString(envKey),
      is_default: true,
    } as never);
  } catch (e) {
    console.error("seed calendar fetch failed", e);
  }
}

/** Resolves a Luma API key for a given user, optionally for a specific calendar. */
export async function resolveUserLumaKey(
  userId: string,
  calendarId?: string | null,
): Promise<string | null> {
  await ensureSeedForOwner(userId);
  const res = await resolveKeyForCalendar(userId, calendarId);
  return res?.key ?? null;
}

export const getLumaConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LumaConfigDTO> => {
    await ensureSeedForOwner(context.userId);
    const rows = await readUserCalendars(context.userId);
    if (rows.length === 0) return { configured: false, calendar: null };
    const def = rows.find((r) => r.is_default) ?? rows[0];
    return {
      configured: true,
      calendar: {
        id: def.calendar_id,
        name: def.calendar_name ?? "Your calendar",
        slug: def.calendar_slug,
        avatarUrl: def.calendar_avatar_url,
        url: def.calendar_url,
      },
    };
  });
