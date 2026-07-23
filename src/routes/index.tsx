import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { hasApiKey } from "@/lib/luma.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Luma Badge Studio — Personalized event cards" },
      {
        name: "description",
        content:
          "Turn any Luma event into a branded, shareable badge. Powered by the Luma API + a philatelic badge generator.",
      },
      { property: "og:title", content: "Luma Badge Studio" },
      {
        property: "og:description",
        content: "Turn any Luma event into a branded, shareable badge.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function Home() {
  const check = useServerFn(hasApiKey);
  const { data, isLoading } = useQuery({
    queryKey: ["luma-config"],
    queryFn: () => check(),
  });
  const router = useRouter();

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#e9e5d8", color: "#17150f" }}>
      <div className="mx-auto max-w-3xl px-6 py-24">
        <div className="mb-4 inline-block border-2 px-3 py-1 text-xs tracking-[0.34em]" style={{ borderColor: "#2970ef", color: "#2970ef" }}>
          · LUMA BADGE STUDIO
        </div>
        <h1 className="text-5xl font-black leading-tight sm:text-6xl">
          One API key.<br />
          Every event.<br />
          <span style={{ color: "#2970ef" }}>Personalized badges.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg" style={{ color: "rgba(23,21,15,0.7)" }}>
          Pega tu Luma Calendar API key y genera tarjetas estilo estampilla para cada evento. Cada
          badge se auto-brandea con el arte, colores y link de tu evento.
        </p>

        <div className="mt-10 rounded-lg border-2 bg-[#f2efe6] p-6" style={{ borderColor: "rgba(23,21,15,0.16)" }}>
          <h2 className="font-mono text-sm tracking-[0.24em]">STATUS</h2>
          {isLoading ? (
            <p className="mt-3 text-sm">Checking configuration…</p>
          ) : data?.configured ? (
            <>
              <p className="mt-3 text-sm">
                <span className="inline-block h-2 w-2 rounded-full bg-green-600 align-middle" />{" "}
                <b>LUMA_API_KEY</b> configured. Ready to pull your calendar.
              </p>
              <div className="mt-6 flex gap-3">
                <Link
                  to="/events"
                  className="inline-flex items-center rounded-md bg-[#17150f] px-5 py-2.5 text-sm font-semibold text-[#f2efe6] hover:opacity-90"
                >
                  Browse events →
                </Link>
                <Link
                  to="/phase-2"
                  className="inline-flex items-center rounded-md border-2 border-[#17150f] px-5 py-2.5 text-sm font-semibold hover:bg-[#17150f] hover:text-[#f2efe6]"
                >
                  Phase 2 roadmap
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm">
                <span className="inline-block h-2 w-2 rounded-full bg-amber-500 align-middle" />{" "}
                Luma API key not detected. Save it as{" "}
                <code className="rounded bg-[#e9e5d8] px-1.5 py-0.5">LUMA_API_KEY</code> in project
                secrets, then reload.
              </p>
              <button
                onClick={() => router.invalidate()}
                className="mt-4 inline-flex items-center rounded-md border-2 border-[#17150f] px-4 py-2 text-sm font-semibold hover:bg-[#17150f] hover:text-[#f2efe6]"
              >
                Recheck
              </button>
            </>
          )}
        </div>

        <div className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-3 text-sm">
          {[
            { n: "01", t: "PULL", d: "Fetch events from your Luma calendar." },
            { n: "02", t: "THEME", d: "Accent color, cover art, QR — all from the event." },
            { n: "03", t: "SHARE", d: "Attendees compose personalized badges." },
          ].map((s) => (
            <div key={s.n} className="border-l-2 pl-4" style={{ borderColor: "#2970ef" }}>
              <div className="font-mono text-xs tracking-[0.24em]" style={{ color: "rgba(23,21,15,0.55)" }}>
                {s.n}
              </div>
              <div className="mt-1 text-lg font-black">{s.t}</div>
              <p className="mt-1" style={{ color: "rgba(23,21,15,0.7)" }}>{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
