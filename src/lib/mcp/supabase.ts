// Shared Supabase client factory for MCP tools. Import-safe: no env reads at
// module top level — everything resolves lazily inside the handlers.
import { createClient } from "@supabase/supabase-js";
import type { ToolContext } from "@lovable.dev/mcp-js";
import type { Database } from "@/integrations/supabase/types";

type RuntimeGlobals = typeof globalThis & {
  Deno?: { env?: { get?: (name: string) => string | undefined } };
  process?: { env?: Record<string, string | undefined> };
};

function runtimeEnv(name: string): string | undefined {
  const runtime = globalThis as RuntimeGlobals;
  return runtime.Deno?.env?.get?.(name) ?? runtime.process?.env?.[name];
}

function configuredEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = runtimeEnv(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

function supabaseProjectUrl(): string {
  const url = configuredEnv(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  if (!url) throw new Error("SUPABASE_URL (or VITE_SUPABASE_URL) is required");
  return url;
}

function supabasePublishableKey(): string {
  const direct = configuredEnv(["SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"]);
  if (direct) return direct;
  const legacy = configuredEnv(["SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]);
  if (legacy) return legacy;
  throw new Error("SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY is required");
}

// Forwards the verified bearer token so RLS runs as the signed-in user.
export function supabaseForUser(ctx: ToolContext) {
  const token = ctx.getToken();
  if (!token) throw new Error("supabaseForUser requires a verified OAuth token");
  return createClient<Database>(supabaseProjectUrl(), supabasePublishableKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function fail(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

export async function loadCalendars(sb: ReturnType<typeof supabaseForUser>) {
  const { data, error } = await sb
    .from("user_luma_calendars")
    .select("id, calendar_id, calendar_name, calendar_slug, calendar_url, source, provider, ownership, is_mine, is_default")
    .is("merged_into_id", null)
    .order("is_default", { ascending: false })
    .limit(1000);
  if (error) {
    console.error("loadCalendars", error);
    return { ok: false as const };
  }
  const rows = (data ?? []).map((r) => ({ ...r, is_mine: r.is_mine ?? r.ownership === "connected" }));
  return { ok: true as const, rows };
}
