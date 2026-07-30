import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/events/$canonicalId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { apiError, authFromRequest, checkRateLimit, rateLimitHeaders, requireScope, json } =
          await import("@/lib/api-v1.server");
        const authHeader = request.headers.get("authorization");
        if (!authHeader) return apiError(401, "missing_token", "Authorization header is required");
        const auth = await authFromRequest(request);
        if (!auth) return apiError(401, "invalid_token", "Token is invalid, revoked, or expired");
        const rateLimited = checkRateLimit(auth.tokenId);
        if (rateLimited) return rateLimited;
        const scopeError = requireScope(auth, "events:read");
        if (scopeError) return scopeError;
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin
            .from("canonical_events" as never)
            .select("*")
            .eq("user_id", auth.userId)
            .eq("id", params.canonicalId)
            .maybeSingle();
          if (error) throw new Error(error.message);
          if (!data) return apiError(404, "not_found", "Canonical event not found");
          const event = data as Record<string, unknown>;
          return json(
            200,
            {
              canonicalId: event.id,
              name: event.name ?? null,
              url: event.url ?? null,
              coverUrl: event.cover_url ?? null,
              startAt: event.start_at ?? null,
              endAt: event.end_at ?? null,
              city: event.city ?? null,
              description: event.description ?? null,
              hostName: event.host_name ?? null,
              timezone: event.timezone ?? null,
              enrichment: event.enrichment ?? {},
              externalIds: event.external_ids ?? {},
              updatedAt: event.updated_at ?? null,
            },
            rateLimitHeaders(auth.tokenId),
          );
        } catch (error) {
          console.error("[/api/v1/events/:canonicalId] failed", error);
          return apiError(500, "server_error", "Unable to read event");
        }
      },
    },
  },
});
