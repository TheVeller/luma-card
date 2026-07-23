// Auth gate for the whole authenticated app.
// ssr:false because Supabase stores the session in localStorage — server can't
// read it. The registered functionMiddleware then attaches the bearer token
// to every server function call automatically.
import { createFileRoute, Outlet, redirect, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getLumaConfig } from "@/lib/user-luma-key.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedShell,
});

function AuthedShell() {
  const { user } = Route.useRouteContext() as {
    user: { email?: string; user_metadata?: { avatar_url?: string; full_name?: string } };
  };
  const fetchConfig = useServerFn(getLumaConfig);
  const { data: config } = useQuery({
    queryKey: ["luma-config"],
    queryFn: () => fetchConfig(),
  });
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const cal = config?.calendar;
  const displayName = cal?.name ?? (config?.configured ? "Your calendar" : "Setup required");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="glass sticky top-0 z-30 border-b border-hairline">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <Link to="/events" className="flex items-center gap-3">
            {cal?.avatarUrl ? (
              <img
                src={cal.avatarUrl}
                alt=""
                className="h-9 w-9 rounded-lg border border-hairline object-cover"
              />
            ) : (
              <div className="h-9 w-9 rounded-lg bg-accent" />
            )}
            <div className="leading-tight">
              <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                Luma Badge Studio
              </div>
              <div className="font-display text-sm font-semibold tracking-tight">
                {displayName}
              </div>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <Link
              to="/events"
              className="hidden rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface hover:text-foreground sm:inline-flex"
            >
              Events
            </Link>
            <Link
              to="/settings"
              className="rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface hover:text-foreground"
            >
              Settings
            </Link>
            <div className="ml-2 flex items-center gap-2 rounded-full border border-hairline bg-surface/70 py-1 pl-1 pr-3">
              {user.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url}
                  alt={user.email ?? "avatar"}
                  className="h-7 w-7 rounded-full object-cover"
                />
              ) : (
                <div className="grid h-7 w-7 place-items-center rounded-full bg-surface-2 text-xs font-semibold">
                  {user.email?.[0]?.toUpperCase() ?? "?"}
                </div>
              )}
              <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
                {user.email}
              </span>
              <button
                onClick={signOut}
                className="text-xs font-medium text-muted-foreground hover:text-foreground"
                title="Sign out"
              >
                ↗
              </button>
            </div>
          </div>
        </div>

        {config && !config.configured && (
          <div className="border-t border-hairline bg-accent/10">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-2 text-xs">
              <span className="text-foreground">
                <b>Add your Luma API key</b> · sin ella no podemos leer tus eventos.
              </span>
              <Link
                to="/settings"
                className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground"
              >
                Configure →
              </Link>
            </div>
          </div>
        )}
      </header>

      <Outlet />
    </div>
  );
}
