import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listCalendars from "./tools/list-events";
import listEvents from "./tools/list-canonical-events";
import listBadges from "./tools/list-badges";
import listPresets from "./tools/list-presets";
import whoami from "./tools/whoami";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "event-aggregator-mcp",
  title: "Event Aggregator",
  version: "0.2.0",
  instructions:
    "Tools for Event Aggregator. Read the signed-in user's connected calendars (Luma, Eventbrite, Meetup), their consolidated events, generated badges, and saved AI style presets. Calendars and events can be filtered with `mine` to only the calendars the user marked as their own. Use `whoami` to verify connectivity.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoami, listCalendars, listEvents, listBadges, listPresets],
});
