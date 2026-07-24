// User-facing management of external API tokens (create / list / revoke).
// The raw token is returned ONCE from createApiToken and never stored or
// re-derivable; only its SHA-256 hash lives in the DB. All reads/writes go
// through the service-role client but always scope by the authenticated userId.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type ApiTokenDTO = {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type Row = {
  id: string;
  name: string;
  token_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

function toDTO(r: Row): ApiTokenDTO {
  return {
    id: r.id,
    name: r.name,
    prefix: r.token_prefix,
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at,
    createdAt: r.created_at,
  };
}

const SELECT = "id, name, token_prefix, last_used_at, revoked_at, created_at";

export const listApiTokens = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ApiTokenDTO[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("api_tokens" as never)
      .select(SELECT)
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    return ((data as Row[] | null) ?? []).map(toDTO);
  });

export const createApiToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ name: z.string().trim().min(1).max(80) }).parse(d))
  .handler(async ({ data, context }): Promise<ApiTokenDTO & { token: string }> => {
    const { generateToken } = await import("./api-tokens.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { raw, prefix, hash } = generateToken();
    const { data: row, error } = await supabaseAdmin
      .from("api_tokens" as never)
      .insert({
        user_id: context.userId,
        name: data.name,
        token_prefix: prefix,
        token_hash: hash,
      } as never)
      .select(SELECT)
      .single();
    if (error) throw new Error(error.message);
    return { ...toDTO(row as Row), token: raw };
  });

export const revokeApiToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("api_tokens" as never)
      .update({ revoked_at: new Date().toISOString() } as never)
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
