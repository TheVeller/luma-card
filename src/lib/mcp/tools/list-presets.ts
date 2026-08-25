import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_event_style_presets",
  title: "List style presets for an event",
  description:
    "List saved AI style presets (palette, fonts, mood) for a given Luma event id owned by the signed-in user.",
  inputSchema: {
    event_id: z.string().describe("Luma event id, e.g. evt-abc123 or scr-xyz."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ event_id }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const sb = supabaseForUser(ctx);
    const { data, error } = await sb
      .from("event_style_presets")
      .select("id, label, style_spec, created_at")
      .eq("event_id", event_id)
      .eq("user_id", ctx.getUserId() ?? "")
      .order("created_at", { ascending: false });
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { presets: data ?? [] },
    };
  },
});
