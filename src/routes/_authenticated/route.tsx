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
  const { user } = Route.useRouteContext() as { user: { email?: string; user_metadata?: { avatar_url?: string; full_name?: string } } };
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
    <div className="min-h-screen" style={{ backgroundColor: "#e9e5d8", color: "#17150f" }}>
      <header className="border-b" style={{ borderColor: "rgba(23,21,15,0.16)" }}>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <Link to="/events" className="flex items-center gap-3">
            {cal?.avatarUrl ? (
              <img
                src={cal.avatarUrl}
                alt=""
                className="h-8 w-8 rounded-md border object-cover"
                style={{ borderColor: "rgba(23,21,15,0.16)" }}
              />
            ) : (
              <div className="h-8 w-8 rounded-md border-2" style={{ borderColor: "#2970ef", backgroundColor: "#f2efe6" }} />
            )}
            <div className="leading-tight">
              <div className="font-mono text-[10px] tracking-[0.24em]" style={{ color: "rgba(23,21,15,0.55)" }}>
                · LUMA BADGE STUDIO
              </div>
              <div className="text-sm font-black uppercase tracking-wide">
                {displayName}
              </div>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <Link
              to="/settings"
              className="rounded-md border-2 border-[#17150f] px-3 py-1.5 text-xs font-semibold hover:bg-[#17150f] hover:text-[#f2efe6]"
            >
              Settings
            </Link>
            <div className="hidden text-right sm:block">
              <div className="font-mono text-[10px] tracking-[0.2em]" style={{ color: "rgba(23,21,15,0.55)" }}>
                SIGNED IN AS
              </div>
              <div className="text-xs font-semibold">{user.email}</div>
            </div>
            {user.user_metadata?.avatar_url ? (
              <img
                src={user.user_metadata.avatar_url}
                alt={user.email ?? "avatar"}
                className="h-8 w-8 rounded-full border-2 object-cover"
                style={{ borderColor: "rgba(23,21,15,0.16)" }}
              />
            ) : (
              <div className="grid h-8 w-8 place-items-center rounded-full border-2 font-mono text-xs" style={{ borderColor: "rgba(23,21,15,0.24)" }}>
                {user.email?.[0]?.toUpperCase() ?? "?"}
              </div>
            )}
            <button
              onClick={signOut}
              className="rounded-md px-3 py-1.5 text-xs font-semibold underline"
              style={{ color: "rgba(23,21,15,0.7)" }}
            >
              Sign out
            </button>
          </div>
        </div>

        {config && !config.configured && (
          <div className="border-t" style={{ borderColor: "rgba(23,21,15,0.16)", backgroundColor: "#fff8dc" }}>
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-6 py-2 text-xs">
              <span>
                <b>Falta configurar tu Luma API key.</b> Sin ella no podemos leer tus eventos.
              </span>
              <Link to="/settings" className="rounded-md bg-[#17150f] px-3 py-1 font-semibold text-[#f2efe6]">
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
