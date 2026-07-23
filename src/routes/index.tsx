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
      { property: "og:title", content: "Luma Badge Studio — Personalized event cards" },
      { property: "og:description", content: "Turn any Luma event into a branded, shareable badge. Bring your own Luma API key — every event gets its own AI-crafted design." },
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
            <span className="font-display text-sm font-semibold tracking-tight">Luma Badge Studio</span>
          </div>
          <Link
            to="/auth"
            className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            Sign in
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 pt-24 pb-16 text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-hairline bg-surface/60 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Bring your own Luma calendar
        </div>
        <h1 className="font-display text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
          Turn every event into a<br />
          <span className="text-accent">badge worth sharing.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
          Cada usuario trae su propia Luma API key. Detectamos el arte del evento y
          auto-brandamos un badge estampilla — foto, colores, tipografía y QR.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/auth"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Continue with Google
            <span aria-hidden>→</span>
          </Link>
          <Link
            to="/phase-2"
            className="inline-flex items-center rounded-full border border-hairline px-6 py-3 text-sm font-semibold text-foreground hover:bg-surface"
          >
            Phase 2 roadmap
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            { n: "01", t: "Pull", d: "Pega tu Luma API key. Detectamos calendario y eventos." },
            { n: "02", t: "Theme", d: "IA extrae paleta y tipografía del arte de cada evento." },
            { n: "03", t: "Share", d: "Foto + QR + botones para X/LinkedIn. Loop social." },
          ].map((s) => (
            <div
              key={s.n}
              className="rounded-2xl border border-hairline bg-surface/70 p-5 backdrop-blur"
            >
              <div className="font-mono text-[10px] tracking-[0.24em] text-muted-foreground">
                {s.n}
              </div>
              <div className="mt-2 font-display text-xl font-semibold">{s.t}</div>
              <p className="mt-1 text-sm text-muted-foreground">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-xs text-muted-foreground">
          <span>Luma Badge Studio</span>
          <span className="font-mono tracking-[0.24em]">· BREW · SHIP · SHARE ·</span>
        </div>
      </footer>
    </div>
  );
}
