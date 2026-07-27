import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Typed wrapper for the beta supabase.auth.oauth namespace.
type AuthOAuth = {
  getAuthorizationDetails: (id: string) => Promise<{
    data: {
      client?: { name?: string; client_name?: string; redirect_uri?: string };
      redirect_url?: string;
      redirect_to?: string;
      scope?: string;
    } | null;
    error: { message: string } | null;
  }>;
  approveAuthorization: (id: string) => Promise<{
    data: { redirect_url?: string; redirect_to?: string } | null;
    error: { message: string } | null;
  }>;
  denyAuthorization: (id: string) => Promise<{
    data: { redirect_url?: string; redirect_to?: string } | null;
    error: { message: string } | null;
  }>;
};
function oauthApi(): AuthOAuth {
  return (supabase.auth as unknown as { oauth: AuthOAuth }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    const next = location.pathname + location.searchStr;
    if (!data.session) throw redirect({ to: "/auth", search: { next } });
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauthApi().getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="grid min-h-screen place-items-center bg-background p-8 text-foreground">
      <div className="max-w-md rounded-2xl border border-hairline bg-surface/80 p-8 text-center">
        <h1 className="font-display text-xl font-semibold">Authorization error</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {String((error as Error)?.message ?? error)}
        </p>
      </div>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientName = details?.client?.name ?? details?.client?.client_name ?? "an app";

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const api = oauthApi();
    const { data, error } = approve
      ? await api.approveAuthorization(authorization_id)
      : await api.denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 py-16 text-foreground">
      <div className="w-full max-w-[460px] rounded-2xl border border-hairline bg-surface/80 p-8 backdrop-blur">
        <h1 className="text-center font-display text-2xl font-semibold tracking-tight">
          Connect {clientName} to Luma Badge Studio
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-center text-sm text-muted-foreground">
          {clientName} will be able to use this app as you — reading your connected Luma calendars,
          generated badges, and saved style presets. This does not bypass the app's permissions.
        </p>
        {error && (
          <p role="alert" className="mt-4 text-center text-sm text-red-500">
            {error}
          </p>
        )}
        <div className="mt-8 flex flex-col gap-2">
          <button
            disabled={busy}
            onClick={() => decide(true)}
            className="w-full rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            Approve
          </button>
          <button
            disabled={busy}
            onClick={() => decide(false)}
            className="w-full rounded-full border border-hairline px-5 py-3 text-sm font-semibold text-foreground disabled:opacity-40"
          >
            Deny
          </button>
        </div>
      </div>
    </main>
  );
}
