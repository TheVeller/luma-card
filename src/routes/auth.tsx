import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/events" });
  },
  head: () => ({
    meta: [
      { title: "Sign in — Luma Badge Studio" },
      { name: "description", content: "Sign in to Luma Badge Studio to generate personalized event badges." },
      { property: "og:title", content: "Sign in — Luma Badge Studio" },
      { property: "og:description", content: "Personalized badges for every Luma event." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) navigate({ to: "/events" });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  async function signInGoogle() {
    setBusy(true);
    setError(null);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result?.error) {
        setError(result.error instanceof Error ? result.error.message : String(result.error));
        setBusy(false);
        return;
      }
      // On success, either a redirect happens or session is already set;
      // the auth state listener above handles navigation.
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#e9e5d8", color: "#17150f" }}>
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 py-16">
        <div className="mb-4 inline-block border-2 px-3 py-1 text-xs tracking-[0.34em]" style={{ borderColor: "#2970ef", color: "#2970ef" }}>
          · LUMA BADGE STUDIO
        </div>
        <h1 className="text-center text-4xl font-black leading-tight">
          Sign in to generate<br />your event badges.
        </h1>
        <p className="mt-4 max-w-md text-center text-sm" style={{ color: "rgba(23,21,15,0.7)" }}>
          Cada usuario trae su propia Luma API key. Continuamos con Google — así podemos guardar tu configuración de forma segura.
        </p>

        <div className="mt-10 w-full rounded-lg border-2 bg-[#f2efe6] p-6" style={{ borderColor: "rgba(23,21,15,0.16)" }}>
          <button
            onClick={signInGoogle}
            disabled={busy}
            className="flex w-full items-center justify-center gap-3 rounded-md bg-[#17150f] px-5 py-3 text-sm font-semibold text-[#f2efe6] transition hover:opacity-90 disabled:opacity-40"
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.9 32.4 29.4 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.7 6.4 29.1 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5c10.8 0 19.5-8.7 19.5-19.5 0-1.2-.1-2.3-.4-3.5z"/>
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.8 15.5 19 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.7 6.4 29.1 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z"/>
              <path fill="#4CAF50" d="M24 43.5c5.1 0 9.7-1.9 13.2-5l-6.1-5c-1.9 1.4-4.4 2.3-7.1 2.3-5.4 0-10-3.5-11.5-8.4l-6.6 5.1C9.6 39 16.2 43.5 24 43.5z"/>
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.1 5c-.4.4 6.3-4.6 6.3-14.7 0-1.2-.1-2.3-.4-3.5z"/>
            </svg>
            {busy ? "Redirecting…" : "Continue with Google"}
          </button>
          {error && (
            <p className="mt-3 text-center text-xs text-red-700">{error}</p>
          )}
          <p className="mt-4 text-center font-mono text-[10px] tracking-[0.24em]" style={{ color: "rgba(23,21,15,0.55)" }}>
            YOUR LUMA API KEY STAYS ENCRYPTED, TIED TO YOUR ACCOUNT
          </p>
        </div>
      </div>
    </div>
  );
}
