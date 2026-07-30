import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";

function safeNext(next: unknown): string | null {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

export const Route = createFileRoute("/auth")({
  ssr: false,
  // `next` must stay optional, otherwise every `to: "/auth"` link/redirect is
  // forced to pass a `search` object.
  validateSearch: (s: Record<string, unknown>): { next?: string } =>
    typeof s.next === "string" ? { next: s.next } : {},
  beforeLoad: async ({ search }) => {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      const next = safeNext(search.next);
      if (next) throw redirect({ href: next });
      throw redirect({ to: "/events", search: { q: "", provider: "all", labels: [] } });
    }
  },
  head: () => ({
    meta: [
      { title: "Sign in — Luma Badge Studio" },
      {
        name: "description",
        content: "Sign in to Luma Badge Studio to generate personalized event badges.",
      },
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
  const { next } = Route.useSearch();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        const target = safeNext(next);
        if (target) {
          window.location.href = target;
        } else {
          navigate({ to: "/events", search: { q: "", provider: "all", labels: [] } });
        }
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate, next]);

  async function signInGoogle() {
    setBusy(true);
    setError(null);
    try {
      const target = safeNext(next);
      const redirectUri = target
        ? `${window.location.origin}/auth?next=${encodeURIComponent(target)}`
        : window.location.origin;
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: redirectUri,
      });
      if (result?.error) {
        setError(result.error instanceof Error ? result.error.message : String(result.error));
        setBusy(false);
        return;
      }
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background px-6 py-16 text-foreground">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="h-6 w-6 rounded-md bg-accent" />
          <span className="font-display text-sm font-semibold tracking-tight">
            Luma Badge Studio
          </span>
        </div>
        <div className="rounded-2xl border border-hairline bg-surface/80 p-8 backdrop-blur">
          <h1 className="text-center font-display text-2xl font-semibold tracking-tight">
            Sign in to your studio
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-center text-sm text-muted-foreground">
            Continuamos con Google para guardar tu Luma API key de forma segura.
          </p>

          <button
            onClick={signInGoogle}
            disabled={busy}
            className="mt-8 flex w-full items-center justify-center gap-3 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path
                fill="#FFC107"
                d="M43.6 20.5H42V20H24v8h11.3C33.9 32.4 29.4 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.7 6.4 29.1 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5c10.8 0 19.5-8.7 19.5-19.5 0-1.2-.1-2.3-.4-3.5z"
              />
              <path
                fill="#FF3D00"
                d="M6.3 14.7l6.6 4.8C14.8 15.5 19 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.7 6.4 29.1 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z"
              />
              <path
                fill="#4CAF50"
                d="M24 43.5c5.1 0 9.7-1.9 13.2-5l-6.1-5c-1.9 1.4-4.4 2.3-7.1 2.3-5.4 0-10-3.5-11.5-8.4l-6.6 5.1C9.6 39 16.2 43.5 24 43.5z"
              />
              <path
                fill="#1976D2"
                d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.1 5c-.4.4 6.3-4.6 6.3-14.7 0-1.2-.1-2.3-.4-3.5z"
              />
            </svg>
            {busy ? "Redirecting…" : "Continue with Google"}
          </button>
          {error && <p className="mt-3 text-center text-xs text-destructive">{error}</p>}
          <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            Your Luma API key stays encrypted
          </p>
        </div>
      </div>
    </div>
  );
}
