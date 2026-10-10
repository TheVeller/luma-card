import { auth, defineMcp } from "@lovable.dev/mcp-js";
import getEvent from "./tools/get-event";
import listCalendars from "./tools/list-calendars";
import listEvents from "./tools/list-events";
import whoami from "./tools/whoami";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "event-aggregator-mcp",
  title: "Event Aggregator",
  version: "0.4.0",
  instructions:
    "Tools for Event Aggregator. Read the signed-in user's connected calendars and consolidated events across Luma, Eventbrite, and Meetup. Use list_calendars, then list_events (filters: mine, calendar_id, status, q, from/to; paginate with cursor), and get_event for full details and sources. Use whoami to verify connectivity.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoami, listCalendars, listEvents, getEvent],
});
