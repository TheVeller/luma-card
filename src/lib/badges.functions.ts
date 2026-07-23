// Server functions for reading + deleting badges.
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

const InputSchema = z.object({
  eventId: z.string().min(1).max(100),
  limit: z.number().int().min(1).max(60).optional().default(30),
});

export type BadgeEntry = {
  id: string;
  firstName: string;
  role: string | null;
  publicUrl: string;
  imagePath: string;
  ownerId: string | null;
  createdAt: string;
};

export type UserBadgeEntry = BadgeEntry & { eventId: string };

function isNewKey(v: string) {
  return v.startsWith("sb_publishable_") || v.startsWith("sb_secret_");
}

function serverPublicClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (isNewKey(key) && h.get("Authorization") === `Bearer ${key}`) {
          h.delete("Authorization");
        }
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

function publicUrlFor(path: string): string {
  const supabase = serverPublicClient();
  const { data } = supabase.storage.from("badges").getPublicUrl(path);
  return data.publicUrl;
}

export const listBadgesForEvent = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }): Promise<BadgeEntry[]> => {
    const supabase = serverPublicClient();
    const { data: rows, error } = await (supabase as ReturnType<typeof serverPublicClient>)
      .from("badges" as never)
      .select("id, first_name, role, image_path, user_id, created_at")
      .eq("event_id", data.eventId)
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (error) throw new Error(error.message);
    if (!rows) return [];

    return (rows as Array<{
      id: string;
      first_name: string;
      role: string | null;
      image_path: string;
      user_id: string | null;
      created_at: string;
    }>).map((r) => ({
      id: r.id,
      firstName: r.first_name,
      role: r.role,
      publicUrl: publicUrlFor(r.image_path),
      imagePath: r.image_path,
      ownerId: r.user_id,
      createdAt: r.created_at,
    }));
  });

export const listAllBadgesForUser = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UserBadgeEntry[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("badges" as never)
      .select("id, event_id, first_name, role, image_path, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    if (!rows) return [];
    return (rows as Array<{
      id: string;
      event_id: string;
      first_name: string;
      role: string | null;
      image_path: string;
      created_at: string;
    }>).map((r) => ({
      id: r.id,
      eventId: r.event_id,
      firstName: r.first_name,
      role: r.role,
      publicUrl: publicUrlFor(r.image_path),
      imagePath: r.image_path,
      ownerId: context.userId,
      createdAt: r.created_at,
    }));
  });

const DeleteInput = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });

export const deleteMyBadges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => DeleteInput.parse(d))
  .handler(async ({ context, data }): Promise<{ deleted: number }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Fetch rows owned by the caller
    const { data: rows, error } = await supabaseAdmin
      .from("badges" as never)
      .select("id, image_path, user_id")
      .in("id", data.ids);
    if (error) throw new Error(error.message);
    const owned = ((rows ?? []) as Array<{ id: string; image_path: string; user_id: string }>)
      .filter((r) => r.user_id === context.userId);
    if (owned.length === 0) return { deleted: 0 };

    const paths = owned.map((r) => r.image_path);
    const ids = owned.map((r) => r.id);
    // Remove storage first (idempotent), then rows
    await supabaseAdmin.storage.from("badges").remove(paths);
    const { error: delErr } = await supabaseAdmin
      .from("badges" as never)
      .delete()
      .in("id", ids);
    if (delErr) throw new Error(delErr.message);
    return { deleted: ids.length };
  });

export const wipeMyBadges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ deleted: number }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("badges" as never)
      .select("id, image_path")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as Array<{ id: string; image_path: string }>;
    if (list.length === 0) return { deleted: 0 };
    await supabaseAdmin.storage.from("badges").remove(list.map((r) => r.image_path));
    const { error: delErr } = await supabaseAdmin
      .from("badges" as never)
      .delete()
      .eq("user_id", context.userId);
    if (delErr) throw new Error(delErr.message);
    return { deleted: list.length };
  });
