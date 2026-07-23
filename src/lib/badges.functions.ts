// Authenticated server functions to read badges. Scoped by the caller's userId.
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
      .select("id, first_name, role, image_path, created_at")
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
      created_at: string;
    }>).map((r) => ({
      id: r.id,
      firstName: r.first_name,
      role: r.role,
      publicUrl: publicUrlFor(r.image_path),
      createdAt: r.created_at,
    }));
  });

/** Every badge the authenticated user has created, across all events. */
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
      createdAt: r.created_at,
    }));
  });
