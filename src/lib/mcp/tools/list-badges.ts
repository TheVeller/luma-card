import { defineTool } from "@lovable.dev/mcp-js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

function userClient(token: string) {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_my_badges",
  title: "List my generated badges",
  description:
    "List badges the signed-in user has generated, most recent first. Optionally filter by event_id.",
  inputSchema: {
    event_id: z.string().optional().describe("Filter to a specific Luma event id."),
    limit: z.number().int().min(1).max(100).optional().describe("Max rows (default 25)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ event_id, limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const sb = userClient(ctx.getToken() ?? "");
    let q = sb
      .from("badges")
      .select("id, event_id, first_name, role, image_path, created_at")
      .eq("user_id", ctx.getUserId() ?? "")
      .order("created_at", { ascending: false })
      .limit(limit ?? 25);
    if (event_id) q = q.eq("event_id", event_id);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { badges: data ?? [] },
    };
  },
});
