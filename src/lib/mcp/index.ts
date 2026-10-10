import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listCalendars from "./tools/list-events";
import listEvents from "./tools/list-canonical-events";
import whoami from "./tools/whoami";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "event-aggregator-mcp",
  title: "Event Aggregator",
  version: "0.3.0",
  instructions:
    "Tools for Event Aggregator. Read the signed-in user's connected calendars and consolidated events across Luma, Eventbrite, and Meetup. Calendars and events can be filtered with `mine` to only include sources the user marked as their own. Use `whoami` to verify connectivity.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoami, listCalendars, listEvents],
});
