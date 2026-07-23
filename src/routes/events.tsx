import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listEvents } from "@/lib/luma.functions";

export const Route = createFileRoute("/events")({
  head: () => ({
    meta: [
      { title: "Your Luma events — Badge Studio" },
      { name: "description", content: "Pick a Luma event to generate personalized shareable badges." },
      { property: "og:title", content: "Your Luma events" },
      { property: "og:description", content: "Personalized badges for every event on your Luma calendar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EventsPage,
});

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function proxied(url: string | null): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("lumacdn.com") || u.hostname === "cdn.lu.ma") {
      return `/api/public/image?url=${encodeURIComponent(url)}`;
    }
  } catch {}
  return url;
}

function EventsPage() {
  const fetchEvents = useServerFn(listEvents);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["luma-events"],
    queryFn: () => fetchEvents(),
  });

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#e9e5d8", color: "#17150f" }}>
      <header className="border-b" style={{ borderColor: "rgba(23,21,15,0.16)" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="font-mono text-sm tracking-[0.24em]">
            · LUMA BADGE STUDIO
          </Link>
          <button
            onClick={() => refetch()}
            className="rounded-md border-2 border-[#17150f] px-3 py-1.5 text-xs font-semibold hover:bg-[#17150f] hover:text-[#f2efe6]"
          >
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-12">
        <h1 className="text-4xl font-black">Your events</h1>
        <p className="mt-2" style={{ color: "rgba(23,21,15,0.7)" }}>
          Pick an event to generate a personalized badge for it.
        </p>

        {isLoading && <p className="mt-8 font-mono text-sm">LOADING…</p>}
        {error && (
          <div className="mt-8 rounded-md border-2 border-red-600 bg-red-50 p-4 text-sm text-red-800">
            <b>Failed to load events.</b>
            <div className="mt-1 font-mono text-xs">{String((error as Error).message)}</div>
          </div>
        )}

        {data && data.length === 0 && (
          <p className="mt-8 font-mono text-sm">No events on this calendar yet.</p>
        )}

        {data && data.length > 0 && (
          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {data.map((ev) => (
              <Link
                key={ev.id}
                to="/e/$eventId"
                params={{ eventId: ev.id }}
                className="group overflow-hidden rounded-lg border-2 bg-[#f2efe6] transition hover:-translate-y-0.5 hover:shadow-lg"
                style={{ borderColor: "rgba(23,21,15,0.16)" }}
              >
                <div className="aspect-[16/10] w-full overflow-hidden bg-[#e9e5d8]">
                  {ev.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={proxied(ev.coverUrl)}
                      alt={ev.name}
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center font-mono text-xs opacity-40">
                      NO COVER
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <div className="font-mono text-[10px] tracking-[0.24em]" style={{ color: "rgba(23,21,15,0.55)" }}>
                    {formatDate(ev.startAt)}
                    {ev.city ? ` · ${ev.city}` : ""}
                  </div>
                  <h3 className="mt-2 line-clamp-2 text-lg font-black leading-tight">{ev.name}</h3>
                  <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold" style={{ color: "#2970ef" }}>
                    Generate badge →
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
