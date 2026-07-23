// Per-user Luma API key management. All server-only work runs behind
// `requireSupabaseAuth` so RLS scopes reads/writes to the calling user.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

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

async function ensureSeedForOwner(userId: string): Promise<boolean> {
  // If the LUMA_API_KEY env var still exists AND the caller is the owner email
  // AND they have no row yet, migrate the shared env key into their encrypted row.
  const envKey = process.env.LUMA_API_KEY;
  if (!envKey) return false;
  const email = await getUserEmail(userId);
  if (email?.toLowerCase() !== SEED_EMAIL) return false;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: existing } = await supabaseAdmin
    .from("user_luma_keys" as never)
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing) return false;

  const { encryptString } = await import("./crypto.server");
  const { fetchCalendar } = await import("./luma.server");
  try {
    const cal = await fetchCalendar(envKey);
    const { error } = await supabaseAdmin.from("user_luma_keys" as never).insert({
      user_id: userId,
      api_key_ciphertext: encryptString(envKey),
      calendar_id: cal.id,
      calendar_name: cal.name,
      calendar_slug: cal.slug,
      calendar_avatar_url: cal.avatar_url,
      calendar_url: cal.url,
    } as never);
    if (error) console.error("seed insert failed", error);
    return !error;
  } catch (e) {
    console.error("seed calendar fetch failed", e);
    return false;
  }
}

// Reads the user's key row (bypassing RLS via service role — we still scope by userId).
export async function readUserLumaRow(userId: string): Promise<{
  api_key_ciphertext: string;
  calendar_id: string | null;
  calendar_name: string | null;
  calendar_slug: string | null;
  calendar_avatar_url: string | null;
  calendar_url: string | null;
} | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_luma_keys" as never)
    .select("api_key_ciphertext, calendar_id, calendar_name, calendar_slug, calendar_avatar_url, calendar_url")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as never) ?? null;
}

export async function resolveUserLumaKey(userId: string): Promise<string | null> {
  await ensureSeedForOwner(userId);
  const row = await readUserLumaRow(userId);
  if (!row) return null;
  const { decryptString } = await import("./crypto.server");
  try {
    return decryptString(row.api_key_ciphertext);
  } catch {
    return null;
  }
}

export const getLumaConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LumaConfigDTO> => {
    await ensureSeedForOwner(context.userId);
    const row = await readUserLumaRow(context.userId);
    if (!row) return { configured: false, calendar: null };
    return {
      configured: true,
      calendar: {
        id: row.calendar_id ?? "",
        name: row.calendar_name ?? "Your calendar",
        slug: row.calendar_slug,
        avatarUrl: row.calendar_avatar_url,
        url: row.calendar_url,
      },
    };
  });

export const saveLumaKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ apiKey: z.string().trim().min(8).max(200) }).parse(d))
  .handler(async ({ data, context }): Promise<LumaConfigDTO> => {
    const { fetchCalendar } = await import("./luma.server");
    const cal = await fetchCalendar(data.apiKey);
    const { encryptString } = await import("./crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("user_luma_keys" as never).upsert(
      {
        user_id: context.userId,
        api_key_ciphertext: encryptString(data.apiKey),
        calendar_id: cal.id,
        calendar_name: cal.name,
        calendar_slug: cal.slug,
        calendar_avatar_url: cal.avatar_url,
        calendar_url: cal.url,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return {
      configured: true,
      calendar: {
        id: cal.id,
        name: cal.name,
        slug: cal.slug,
        avatarUrl: cal.avatar_url,
        url: cal.url,
      },
    };
  });

export const deleteLumaKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_luma_keys" as never)
      .delete()
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
