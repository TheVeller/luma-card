import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/events" });
  },
  head: () => ({
    meta: [
      { title: "Luma Badge Studio — Personalized event cards" },
      {
        name: "description",
        content:
          "Turn any Luma event into a branded, shareable badge. Bring your own Luma API key — every event gets its own AI-crafted design.",
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
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: "#e9e5d8", color: "#17150f" }}>
      <div className="mx-auto max-w-3xl px-6 py-24">
        <div
          className="mb-4 inline-block border-2 px-3 py-1 text-xs tracking-[0.34em]"
          style={{ borderColor: "#2970ef", color: "#2970ef" }}
        >
          · LUMA BADGE STUDIO
        </div>
        <h1 className="text-5xl font-black leading-tight sm:text-6xl">
          Bring your Luma calendar.
          <br />
          Ship AI-crafted<br />
          <span style={{ color: "#2970ef" }}>event badges.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg" style={{ color: "rgba(23,21,15,0.7)" }}>
          Cada usuario trae su propia Luma API key. Detectamos tu calendario y auto-brandamos
          un badge estampilla por evento — foto del asistente, colores, tipografía y QR.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            to="/auth"
            className="inline-flex items-center rounded-md bg-[#17150f] px-5 py-3 text-sm font-semibold text-[#f2efe6] hover:opacity-90"
          >
            Sign in with Google →
          </Link>
          <Link
            to="/phase-2"
            className="inline-flex items-center rounded-md border-2 border-[#17150f] px-5 py-3 text-sm font-semibold hover:bg-[#17150f] hover:text-[#f2efe6]"
          >
            Phase 2 roadmap
          </Link>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-6 text-sm sm:grid-cols-3">
          {[
            { n: "01", t: "PULL", d: "Pega tu Luma API key. Detectamos calendario y eventos." },
            { n: "02", t: "THEME", d: "IA extrae paleta y tipografía del arte de cada evento." },
            { n: "03", t: "SHARE", d: "Foto + QR + botones para X/LinkedIn. Loop social." },
          ].map((s) => (
            <div key={s.n} className="border-l-2 pl-4" style={{ borderColor: "#2970ef" }}>
              <div
                className="font-mono text-xs tracking-[0.24em]"
                style={{ color: "rgba(23,21,15,0.55)" }}
              >
                {s.n}
              </div>
              <div className="mt-1 text-lg font-black">{s.t}</div>
              <p className="mt-1" style={{ color: "rgba(23,21,15,0.7)" }}>
                {s.d}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
