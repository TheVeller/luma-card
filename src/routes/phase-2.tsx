import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/phase-2")({
  head: () => ({
    meta: [
      { title: "Phase 2 — Luma without the API" },
      {
        name: "description",
        content:
          "Design doc: replace the Luma API dependency with Firecrawl / Playwright scraping, keeping the same badge generator.",
      },
      { property: "og:title", content: "Phase 2 — Luma without the API" },
      {
        property: "og:description",
        content: "Scraping-based ingestion so users can paste any Luma event or calendar URL.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Phase2Doc,
});

function Phase2Doc() {
  return (
    <div className="min-h-screen bg-[#e9e5d8] text-[#17150f]">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <Link to="/" className="font-mono text-xs tracking-[0.24em]">
          ← HOME
        </Link>
        <h1 className="mt-6 text-4xl font-black leading-tight sm:text-5xl">
          Phase 2 · Drop the API,<br />
          just paste a Luma URL.
        </h1>
        <p className="mt-4 text-lg" style={{ color: "rgba(23,21,15,0.7)" }}>
          Goal: user pastes any <code>lu.ma/&lt;calendar&gt;</code> or{" "}
          <code>lu.ma/&lt;event&gt;</code> URL — no API key — and gets the same personalized
          badge experience. This is a <b>design doc only</b>; nothing here is built yet.
        </p>

        <Section title="1 · Contract">
          <p>
            The ingestion layer must return the same <code>EventDTO</code> shape used by the
            current Luma API path so the badge generator does not change:
          </p>
          <Code>{`type EventDTO = {
  id: string;         // stable slug from the URL
  name: string;
  coverUrl: string | null;
  url: string;        // canonical lu.ma URL
  startAt: string;    // ISO
  city?: string;
  description?: string;
};`}</Code>
        </Section>

        <Section title="2 · Firecrawl (default)">
          <p>
            Firecrawl is edge-friendly (pure HTTP) and handles JS rendering server-side. Add it
            as a Lovable connector or via a <code>FIRECRAWL_API_KEY</code> secret.
          </p>
          <p className="mt-2">Two endpoints cover both cases:</p>
          <ul className="mt-2 list-disc pl-6">
            <li>
              <b>Single event</b> — <code>POST /v1/scrape</code> with{" "}
              <code>{`formats: ["json"]`}</code> and a JSON schema that extracts{" "}
              <code>name</code>, <code>cover_url</code>, <code>start_at</code>,{" "}
              <code>location</code>, <code>description</code>, <code>host</code>.
            </li>
            <li>
              <b>Calendar</b> — <code>POST /v1/crawl</code> over{" "}
              <code>lu.ma/&lt;calendar&gt;</code> with{" "}
              <code>{`includePaths: ["/e/**"]`}</code>, then for each event page run the same
              scrape schema.
            </li>
          </ul>
          <p className="mt-2">
            Server route: <code>POST /api/public/ingest-luma</code>. Body: <code>{`{ url }`}</code>.
            Response: <code>EventDTO[]</code>. Cache results in Lovable Cloud
            (<code>events_cache</code> table, keyed by canonical URL, TTL 15min).
          </p>
        </Section>

        <Section title="3 · Playwright fallback">
          <p>
            Only for events that require login/cookies (private hosts). Playwright is not
            Cloudflare-Worker-safe, so this runs on a separate service — e.g. a Fly.io / Render
            sidecar — invoked over HTTP from the same server route with the same DTO contract.
            Never link it as a hard dependency of the app; prefer graceful fallback (surface{" "}
            "This event is private, try the API key path.").
          </p>
        </Section>

        <Section title="4 · JSON-LD shortcut">
          <p>
            Luma embeds an <code>{`<script type="application/ld+json">`}</code> Event object on
            every event page. Before falling back to Firecrawl, a plain{" "}
            <code>fetch()</code> + regex can extract most fields for free. The scraper path
            should try this first (cheapest) and only escalate to Firecrawl when JSON-LD is
            missing.
          </p>
        </Section>

        <Section title="5 · Risks">
          <ul className="list-disc pl-6">
            <li>Luma ToS — check before shipping publicly.</li>
            <li>Cover URLs from <code>lumacdn.com</code> may rotate; re-fetch on badge render.</li>
            <li>Rate limits — Firecrawl + Redis-cached results keep this manageable.</li>
            <li>Private events behind auth are out of scope for the scraping path.</li>
          </ul>
        </Section>

        <Section title="6 · Migration">
          <p>
            Add a UI toggle: <b>API key</b> vs <b>Paste a URL</b>. Both flows produce{" "}
            <code>EventDTO</code>, so <code>/e/$eventId</code> keeps working. Phase-1 users lose
            nothing.
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xs font-mono tracking-[0.24em]" style={{ color: "#2970ef" }}>
        {title}
      </h2>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-md border-2 bg-[#f2efe6] p-4 text-xs" style={{ borderColor: "rgba(23,21,15,0.16)" }}>
      <code>{children}</code>
    </pre>
  );
}
