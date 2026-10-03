// Admin mode: requires the `admin` role AND an unlocked admin session
// (password checked server-side against ADMIN_PASSWORD).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type AdminSession = { unlockedFor?: string; at?: number };
const MAX_AGE = 60 * 60 * 8; // 8h

async function adminSession() {
  const { useSession } = await import("@tanstack/react-start/server");
  const { createHash } = await import("node:crypto");
  const raw = process.env["APP_ENCRYPTION_KEY"];
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not set");
  const password = createHash("sha256").update(`admin-session:${raw}`).digest("hex");
  return useSession<AdminSession>({
    password,
    name: "ea-admin",
    maxAge: MAX_AGE,
    cookie: { httpOnly: true, secure: true, sameSite: "lax", path: "/" },
  });
}

async function isAdmin(ctx: { supabase: any; userId: string }) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  return data === true;
}

async function isUnlocked(userId: string) {
  const s = await adminSession();
  return s.data.unlockedFor === userId && !!s.data.at && Date.now() - s.data.at < MAX_AGE * 1000;
}

export const getAdminStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await isAdmin(context);
    return { isAdmin: admin, unlocked: admin ? await isUnlocked(context.userId) : false };
  });

export const unlockAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { password: string }) => ({ password: String(d?.password ?? "").slice(0, 200) }))
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context))) return { ok: false as const };
    const expected = process.env["ADMIN_PASSWORD"];
    if (!expected) throw new Error("Admin password is not configured");
    const { createHash, timingSafeEqual } = await import("node:crypto");
    const a = createHash("sha256").update(data.password).digest();
    const b = createHash("sha256").update(expected).digest();
    if (!timingSafeEqual(a, b)) return { ok: false as const };
    const s = await adminSession();
    await s.update({ unlockedFor: context.userId, at: Date.now() });
    return { ok: true as const };
  });

export const lockAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const s = await adminSession();
    await s.clear();
    return { ok: true };
  });

export type AdminCalendar = {
  key: string;
  name: string;
  url: string | null;
  provider: string;
  avatarUrl: string | null;
  followers: string[];
  followedByMe: boolean;
  importedCount: number;
};
export type AdminEvent = {
  key: string;
  name: string;
  url: string;
  startAt: string | null;
  city: string | null;
  countryCode: string | null;
  region: string | null;
  languageCode: string | null;
  isOnline: boolean | null;
  audience: string[];
  contributors: string[];
};

export const getAdminCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await isAdmin(context)) || !(await isUnlocked(context.userId))) {
      throw new Error("Forbidden");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const emails = new Map<string, string>();
    for (let page = 1; page < 50; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new Error(error.message);
      for (const u of data.users) emails.set(u.id, u.email ?? u.id);
      if (data.users.length < 1000) break;
    }
    const email = (id: string) => emails.get(id) ?? id;

    // Calendars across all users, deduped by canonical identity.
    const calRows: any[] = [];
    for (let off = 0; ; off += 1000) {
      const { data, error } = await supabaseAdmin
        .from("user_luma_calendars")
        .select(
          "user_id,calendar_id,calendar_name,curated_name,calendar_url,calendar_avatar_url,provider,luma_calendar_id,imported_count,merged_into_id",
        )
        .is("merged_into_id", null)
        .range(off, off + 999);
      if (error) throw new Error(error.message);
      calRows.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
    const cals = new Map<string, AdminCalendar & { _f: Set<string> }>();
    for (const r of calRows) {
      const key = `${r.provider}:${(r.luma_calendar_id ?? r.calendar_url ?? r.calendar_id ?? "").toLowerCase()}`;
      const cur =
        cals.get(key) ??
        ({
          key,
          name: r.curated_name ?? r.calendar_name ?? r.calendar_id,
          url: r.calendar_url,
          provider: r.provider ?? "luma",
          avatarUrl: r.calendar_avatar_url,
          followers: [],
          followedByMe: false,
          importedCount: 0,
          _f: new Set<string>(),
        } as AdminCalendar & { _f: Set<string> });
      cur._f.add(r.user_id);
      if (r.user_id === context.userId) cur.followedByMe = true;
      cur.importedCount = Math.max(cur.importedCount, r.imported_count ?? 0);
      cals.set(key, cur);
    }
    const calendars: AdminCalendar[] = [...cals.values()]
      .map(({ _f, ...c }) => ({ ...c, followers: [..._f].map(email) }))
      .sort((a, b) => Number(a.followedByMe) - Number(b.followedByMe) || b.followers.length - a.followers.length);

    // Upcoming + recent events across all users, deduped.
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const evRows: any[] = [];
    for (let off = 0; off < 20000; off += 1000) {
      const { data, error } = await supabaseAdmin
        .from("canonical_events")
        .select(
          "user_id,luma_event_id,canonical_key,name,url,start_at,city,country_code,region,language_code,is_online,audience",
        )
        .gte("start_at", since)
        .order("start_at", { ascending: true })
        .range(off, off + 999);
      if (error) throw new Error(error.message);
      evRows.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
    const evs = new Map<string, AdminEvent & { _c: Set<string> }>();
    for (const r of evRows) {
      const key = (r.luma_event_id ?? r.url ?? r.canonical_key).toLowerCase();
      const cur =
        evs.get(key) ??
        ({
          key,
          name: r.name,
          url: r.url,
          startAt: r.start_at,
          city: r.city,
          countryCode: r.country_code,
          region: r.region,
          languageCode: r.language_code,
          isOnline: r.is_online,
          audience: r.audience ?? [],
          contributors: [],
          _c: new Set<string>(),
        } as AdminEvent & { _c: Set<string> });
      cur._c.add(r.user_id);
      cur.languageCode ??= r.language_code;
      cur.countryCode ??= r.country_code;
      cur.region ??= r.region;
      evs.set(key, cur);
    }
    const events: AdminEvent[] = [...evs.values()].map(({ _c, ...e }) => ({
      ...e,
      contributors: [..._c].map(email),
    }));

    return { users: emails.size, calendars, events };
  });
