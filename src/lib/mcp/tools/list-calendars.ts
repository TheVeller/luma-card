import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, loadCalendars, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_calendars",
  title: "List my calendars",
  description:
    "List the signed-in user's connected calendars (Luma, Eventbrite, Meetup, or link-imported). Use mine=true for calendars marked as the user's own.",
  inputSchema: {
    mine: z.boolean().optional().describe("Filter to calendars marked as the user's own (true) or not (false)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ mine }, ctx) => {
    if (!ctx.isAuthenticated()) return fail("Not authenticated");
    const result = await loadCalendars(supabaseForUser(ctx));
    if (!result.ok) return fail("Could not load calendars");
    const calendars = result.rows
      .filter((r) => mine === undefined || r.is_mine === mine)
      .map(({ id: _rowId, ...rest }) => rest);
    return {
      content: [{ type: "text", text: JSON.stringify(calendars, null, 2) }],
      structuredContent: { calendars },
    };
  },
});
