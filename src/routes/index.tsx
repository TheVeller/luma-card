import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

const description =
  "Aggregate events from Luma, Meetup, and Eventbrite into one organized, searchable, deduplicated calendar library.";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session)
      throw redirect({ to: "/events", search: { q: "", provider: "all", labels: [] } });
  },
  head: () => ({
    meta: [
      { title: "Event Aggregator — One library for every event" },
      { name: "description", content: description },
      { property: "og:title", content: "Event Aggregator — One library for every event" },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="glass sticky top-0 z-20 border-b border-hairline">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-accent" />
            <span className="font-display text-sm font-semibold">Event Aggregator</span>
          </div>
          <Link
            to="/auth"
            className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-4xl px-6 pb-16 pt-24 text-center sm:pt-28">
          <div className="mb-6 font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
            Luma · Meetup · Eventbrite
          </div>
          <h1 className="font-display text-5xl font-bold leading-[1.05] sm:text-7xl">
            Every event source,
            <br />
            one clean library.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
            Connect calendars or import public links. Event Aggregator normalizes, deduplicates,
            and organizes every event for people, APIs, and agents.
          </p>
          <Link
            to="/auth"
            className="mt-9 inline-flex rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Open your event library →
          </Link>
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-24">
          <div className="grid border-y border-hairline sm:grid-cols-3">
            {[
              ["01", "Connect", "Add provider accounts, calendars, groups, or individual event links."],
              ["02", "Consolidate", "Normalize and deduplicate events without losing source history."],
              ["03", "Route", "Browse the library or connect it to apps and agents through REST and MCP."],
            ].map(([number, title, copy], index) => (
              <div
                key={number}
                className={`py-7 sm:px-7 ${index > 0 ? "border-t border-hairline sm:border-l sm:border-t-0" : ""}`}
              >
                <div className="font-mono text-[10px] text-muted-foreground">{number}</div>
                <h2 className="mt-2 font-display text-xl font-semibold">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-xs text-muted-foreground">
          <span>Event Aggregator</span>
          <span className="font-mono uppercase tracking-[0.18em]">One canonical library</span>
        </div>
      </footer>
    </div>
  );
}