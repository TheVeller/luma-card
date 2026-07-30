// Auth gate for the whole authenticated app.
import { createFileRoute, Outlet, redirect, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CalendarSwitcher } from "@/components/CalendarSwitcher";
import { ThemeToggle } from "@/components/ThemeProvider";

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
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="glass sticky top-0 z-30 border-b border-hairline">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <CalendarSwitcher />

          <div className="flex items-center gap-2">
            <Link
              to="/events"
              search={{ q: "", provider: "all", labels: [] }}
              className="hidden rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface hover:text-foreground sm:inline-flex"
            >
              Events
            </Link>
            <Link
              to="/gallery"
              className="rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface hover:text-foreground"
            >
              Gallery
            </Link>
            <Link
              to="/templates"
              className="rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface hover:text-foreground"
            >
              Templates
            </Link>
            <Link
              to="/settings"
              className="rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-surface hover:text-foreground"
            >
              Settings
            </Link>
            <ThemeToggle className="ml-1" />
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
      </header>

      <Outlet />
    </div>
  );
}
