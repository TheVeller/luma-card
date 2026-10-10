import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, Clock3, ExternalLink, MapPin } from "lucide-react";
import { getEvent } from "@/lib/luma.functions";

export const Route = createFileRoute("/_authenticated/e/$eventId")({
  head: ({ params }) => ({
    meta: [
      { title: `Event ${params.eventId} — Event Aggregator` },
      {
        name: "description",
        content: "View event details from your consolidated Event Aggregator library.",
      },
      { property: "og:title", content: "Event details — Event Aggregator" },
      {
        property: "og:description",
        content: "View event details from your consolidated event library.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EventDetailPage,
});

function formatDate(iso: string, timezone?: string | null) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone || undefined,
    timeZoneName: "short",
  });
}

function proxied(url: string | null): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith("lumacdn.com") || parsed.hostname === "cdn.lu.ma") {
      return `/api/public/image?url=${encodeURIComponent(url)}`;
    }
  } catch {
    return url;
  }
  return url;
}

function EventDetailPage() {
  const { eventId } = Route.useParams();
  const fetchEvent = useServerFn(getEvent);
  const { data: event, isLoading, error } = useQuery({
    queryKey: ["event-detail", eventId],
    queryFn: () => fetchEvent({ data: { id: eventId } }),
  });

  if (isLoading) {
    return (
      <main className="grid min-h-[55vh] place-items-center px-6 text-sm text-muted-foreground">
        Loading event…
      </main>
    );
  }

  if (error || !event) {
    return (
      <main className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="font-display text-2xl font-semibold">Event not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This event may have been removed, or its source may need to be synced again.
        </p>
        <Link
          to="/events"
          search={{ q: "", provider: "all", labels: [] }}
          className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Back to events
        </Link>
      </main>
    );
  }

  const cover = proxied(event.coverUrl);
  const enrichment = event.enrichment;
  const location = enrichment?.venueName ?? enrichment?.venueAddress ?? event.city ?? null;

  return (
    <main className="pb-20">
      <div className="border-b border-hairline">
        <div className="mx-auto max-w-6xl px-6 py-4">
          <Link
            to="/events"
            search={{ q: "", provider: "all", labels: [] }}
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
          >
            ← Events
          </Link>
        </div>
      </div>

      <article className="mx-auto max-w-6xl px-6 py-8 sm:py-12">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)] lg:items-start">
          <div>
            <div className="aspect-square overflow-hidden rounded-lg border border-hairline bg-surface-2">
              {cover ? (
                <img src={cover} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full place-items-center text-sm text-muted-foreground">
                  No event image
                </div>
              )}
            </div>
          </div>

          <div className="lg:sticky lg:top-24">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
              Event details
            </div>
            <h1 className="mt-3 font-display text-4xl font-semibold leading-tight sm:text-5xl">
              {event.name}
            </h1>

            <dl className="mt-8 space-y-4 border-y border-hairline py-5 text-sm">
              <div className="flex gap-3">
                <CalendarDays className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div>
                  <dt className="sr-only">Starts</dt>
                  <dd>{formatDate(event.startAt, event.timezone)}</dd>
                </div>
              </div>
              {event.endAt && (
                <div className="flex gap-3">
                  <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div>
                    <dt className="sr-only">Ends</dt>
                    <dd className="text-muted-foreground">
                      Ends {formatDate(event.endAt, event.timezone)}
                    </dd>
                  </div>
                </div>
              )}
              {location && (
                <div className="flex gap-3">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div>
                    <dt className="sr-only">Location</dt>
                    <dd>{location}</dd>
                  </div>
                </div>
              )}
            </dl>

            {event.url && (
              <a
                href={event.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 sm:w-auto"
              >
                Open original event
                <ExternalLink className="size-4" />
              </a>
            )}
          </div>
        </div>

        {event.description && (
          <section className="mt-12 max-w-3xl border-t border-hairline pt-8">
            <h2 className="font-display text-2xl font-semibold">About this event</h2>
            <p className="mt-4 whitespace-pre-line text-sm leading-7 text-muted-foreground">
              {event.description}
            </p>
          </section>
        )}
      </article>
    </main>
  );
}