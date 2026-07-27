import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listCalendars from "./tools/list-events";
import listBadges from "./tools/list-badges";
import listPresets from "./tools/list-presets";
import whoami from "./tools/whoami";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "luma-badge-studio-mcp",
  title: "Luma Badge Studio",
  version: "0.1.0",
  instructions:
    "Tools for Luma Badge Studio. Read the signed-in user's connected Luma calendars, generated event badges, and saved AI style presets. Use `whoami` to verify connectivity.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoami, listCalendars, listBadges, listPresets],
});
