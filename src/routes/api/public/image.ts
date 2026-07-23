// Proxy remote images so canvas rendering isn't tainted by CORS.
// Only proxies known Luma CDN hosts.
import { createFileRoute } from "@tanstack/react-router";

const ALLOWED_HOSTS = new Set([
  "images.lumacdn.com",
  "cdn.lu.ma",
  "social-images.lumacdn.com",
]);

export const Route = createFileRoute("/api/public/image")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url).searchParams.get("url");
        if (!url) return new Response("missing url", { status: 400 });
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          return new Response("bad url", { status: 400 });
        }
        if (!ALLOWED_HOSTS.has(parsed.hostname)) {
          return new Response("host not allowed", { status: 400 });
        }
        const upstream = await fetch(parsed.toString());
        if (!upstream.ok) {
          return new Response("upstream error", { status: upstream.status });
        }
        const buf = await upstream.arrayBuffer();
        return new Response(buf, {
          status: 200,
          headers: {
            "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
            "cache-control": "public, max-age=86400",
            "access-control-allow-origin": "*",
          },
        });
      },
    },
  },
});
