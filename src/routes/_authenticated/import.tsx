// Import a Luma calendar or event by public URL (no API key needed).
// Uses Firecrawl on the server to scrape and cache into `scraped_events`.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { EventSourceImporter } from "@/components/EventSourceImporter";

export const Route = createFileRoute("/_authenticated/import")({
  head: () => ({
    meta: [
      { title: "Import from a link — Badge Studio" },
      {
        name: "description",
        content: "Import a Luma calendar or a single event by URL — no API key required.",
      },
      { property: "og:title", content: "Import from a link" },
      {
        property: "og:description",
        content: "Turn any Luma calendar or event URL into personalized badges.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ImportPage,
});

function ImportPage() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
        · Import
      </div>
      <h1 className="mt-1 font-display text-4xl font-semibold tracking-tight">
        Import from a link
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Paste a Luma, Eventbrite, or Meetup calendar, organizer, group, or event URL. Public links
        are imported without a provider token.
      </p>

      <div className="mt-8 rounded-2xl border border-hairline bg-surface/60 p-5">
        <EventSourceImporter
          onImported={(result) => {
            if (result.kind === "event" && result.eventIds[0]) {
              navigate({ to: "/e/$eventId", params: { eventId: result.eventIds[0] } });
            } else {
              navigate({ to: "/events" });
            }
          }}
        />
        <div className="mt-5">
          <Link
            to="/events"
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Link>
        </div>
      </div>

      <p className="mt-6 font-mono text-[11px] leading-relaxed text-muted-foreground">
        Public sources stay in the unified calendar switcher. Connect an organizer account in
        Settings for authoritative Eventbrite or Meetup sync and owned-event branding.
      </p>
    </div>
  );
}
