import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_calendars",
  title: "List my Luma calendars",
  description:
    "List the signed-in user's connected calendars (Luma API-linked, Eventbrite, Meetup, or scraped). Use mine=true to only get calendars marked as the user's own.",
  inputSchema: {
    mine: z
      .boolean()
      .optional()
      .describe("Filter to calendars marked as the user's own (true) or not (false)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ mine }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const sb = supabaseForUser(ctx);
    const { data, error } = await sb
      .from("user_luma_calendars")
      .select(
        "calendar_id, calendar_name, calendar_slug, calendar_url, source, provider, ownership, is_mine, is_default",
      )
      .is("merged_into_id", null)
      .order("is_default", { ascending: false });
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const rows = (data ?? []).map((r) => ({
      ...r,
      is_mine: r.is_mine ?? r.ownership === "connected",
    }));
    const calendars =
      mine === undefined ? rows : rows.filter((r) => (mine ? r.is_mine : !r.is_mine));
    return {
      content: [{ type: "text", text: JSON.stringify(calendars, null, 2) }],
      structuredContent: { calendars },
    };
  },
});
