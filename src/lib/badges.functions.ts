import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
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
    }>).map((r) => {
      const { data: pub } = supabase.storage.from("badges").getPublicUrl(r.image_path);
      return {
        id: r.id,
        firstName: r.first_name,
        role: r.role,
        publicUrl: pub.publicUrl,
        createdAt: r.created_at,
      };
    });
  });
