// Server functions for the reusable badge templates library.
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { StyleSpecSchema, normalizeStyleSpec, type StyleSpec } from "./style-spec";

export type TemplateDTO = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  styleSpec: StyleSpec;
  previewPath: string | null;
  sourceUrl: string | null;
  isSystem: boolean;
  createdBy: string | null;
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

type Row = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  style_spec: unknown;
  preview_path: string | null;
  source_url: string | null;
  is_system: boolean;
  created_by: string | null;
  created_at: string;
};

function mapRow(r: Row): TemplateDTO {
  const spec = StyleSpecSchema.safeParse(r.style_spec);
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    styleSpec: spec.success ? normalizeStyleSpec(spec.data) : normalizeStyleSpec({}),
    previewPath: r.preview_path,
    sourceUrl: r.source_url,
    isSystem: r.is_system,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

export const listTemplates = createServerFn({ method: "GET" }).handler(async (): Promise<TemplateDTO[]> => {
  const supabase = serverPublicClient();
  const { data: rows, error } = await (supabase as ReturnType<typeof serverPublicClient>)
    .from("templates" as never)
    .select("*")
    .order("is_system", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);
  return ((rows ?? []) as unknown as Row[]).map(mapRow);
});

const CreateInput = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(240).optional(),
  styleSpec: StyleSpecSchema,
  sourceUrl: z.string().url().optional(),
});

export const createTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateInput.parse(d))
  .handler(async ({ context, data }): Promise<TemplateDTO> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const slug = `user-${context.userId.slice(0, 8)}-${Date.now().toString(36)}`;
    const { data: row, error } = await supabaseAdmin
      .from("templates" as never)
      .insert({
        slug,
        name: data.name,
        description: data.description ?? null,
        style_spec: data.styleSpec,
        source_url: data.sourceUrl ?? null,
        is_system: false,
        created_by: context.userId,
      } as never)
      .select("*")
      .single();
    if (error || !row) throw new Error(error?.message ?? "insert failed");
    return mapRow(row as unknown as Row);
  });

const DeleteInput = z.object({ id: z.string().uuid() });

export const deleteTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => DeleteInput.parse(d))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("templates" as never)
      .delete()
      .eq("id", data.id)
      .eq("created_by", context.userId)
      .eq("is_system", false);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
