import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/health")({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { CORS } = await import("@/lib/api-v1.server");
        return new Response(null, { status: 204, headers: CORS });
      },
      GET: async () => {
        const { healthResponse } = await import("@/lib/api-v1.server");
        return healthResponse();
      },
    },
  },
});
