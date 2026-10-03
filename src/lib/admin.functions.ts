// Admin mode: requires the `admin` role AND an unlocked admin session
// (password checked server-side against ADMIN_PASSWORD).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Unlock = short-lived HMAC token bound to the user id (kept in the browser's
// sessionStorage). Cookies are unreliable inside the embedded preview.
const MAX_AGE_MS = 8 * 60 * 60 * 1000;

async function sign(userId: string, exp: number) {
  const { createHmac } = await import("node:crypto");
  const raw = process.env["APP_ENCRYPTION_KEY"];
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is not set");
  return createHmac("sha256", `admin-token:${raw}`).update(`${userId}.${exp}`).digest("hex");
}

async function isAdmin(ctx: { supabase: any; userId: string }) {
  const { data } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  return data === true;
}

async function isUnlocked(userId: string, token: string | undefined) {
  if (!token) return false;
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!exp || !sig || exp < Date.now()) return false;
  const { timingSafeEqual } = await import("node:crypto");
  const expected = Buffer.from(await sign(userId, exp));
  const got = Buffer.from(sig);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

const tokenInput = (d: { token?: string } | undefined) => ({
  token: typeof d?.token === "string" ? d.token.slice(0, 200) : undefined,
});

export const getAdminStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(tokenInput)
  .handler(async ({ data, context }) => {
    const admin = await isAdmin(context);
    return { isAdmin: admin, unlocked: admin ? await isUnlocked(context.userId, data.token) : false };
  });

export const unlockAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { password: string }) => ({ password: String(d?.password ?? "").slice(0, 200) }))
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context))) return { ok: false as const, token: null };
    const expected = process.env["ADMIN_PASSWORD"];
    if (!expected) throw new Error("Admin password is not configured");
    const { createHash, timingSafeEqual } = await import("node:crypto");
    const a = createHash("sha256").update(data.password.trim()).digest();
    const b = createHash("sha256").update(expected.trim()).digest();
    if (!timingSafeEqual(a, b)) return { ok: false as const, token: null };
    const exp = Date.now() + MAX_AGE_MS;
    return { ok: true as const, token: `${exp}.${await sign(context.userId, exp)}` };
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

export const getAdminCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(tokenInput)
  .handler(async ({ data: input, context }) => {
    if (!(await isAdmin(context)) || !(await isUnlocked(context.userId, input.token))) {
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
