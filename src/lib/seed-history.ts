// Client-side seed util: renders placeholder badges for a fixed set of
// historical event names using Ignacio Velásquez as the placeholder attendee.
// Idempotent — skips events that already have an Ignacio badge for this user.
import { renderBadge, type EventTheme } from "@/lib/badge-render";
import { DEFAULT_STYLE_SPEC, normalizeStyleSpec, type StyleSpec } from "@/lib/style-spec";
import { loadGoogleFontPair } from "@/lib/google-fonts";
import { supabase } from "@/integrations/supabase/client";
import ignacioAsset from "@/assets/ignacio.jpeg.asset.json";
import type { EventDTO } from "@/lib/luma.functions";

export const HISTORIC_EVENT_NAMES = [
  "Code Brew",
  "v0 Zero-to-Agent",
  "GTM Hackathon",
  "Cursor Meetup",
  "Cursor Buildathon SV",
  "Code Brew SV",
  "Vibe Code Fest",
];

export const IGNACIO = {
  firstName: "Ignacio Velásquez",
  role: "Founder, GPT Chain",
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normalize(s).split(" ").filter((t) => t.length > 1);
}

function scoreMatch(target: string, candidate: string): number {
  const tN = normalize(target);
  const cN = normalize(candidate);
  if (cN.includes(tN) || tN.includes(cN)) return 1;
  const t = new Set(tokens(target));
  const c = new Set(tokens(candidate));
  if (t.size === 0 || c.size === 0) return 0;
  let inter = 0;
  t.forEach((tok) => {
    if (c.has(tok)) inter++;
  });
  return inter / Math.max(t.size, 1);
}

export function matchHistoricEvents(events: EventDTO[]): Array<{
  target: string;
  event: EventDTO;
  score: number;
}> {
  const matches: Array<{ target: string; event: EventDTO; score: number }> = [];
  const usedIds = new Set<string>();
  for (const target of HISTORIC_EVENT_NAMES) {
    let best: { event: EventDTO; score: number } | null = null;
    for (const ev of events) {
      if (usedIds.has(ev.id)) continue;
      const score = scoreMatch(target, ev.name);
      if (score >= 0.5 && (!best || score > best.score)) {
        best = { event: ev, score };
      }
    }
    if (best) {
      usedIds.add(best.event.id);
      matches.push({ target, event: best.event, score: best.score });
    }
  }
  return matches;
}

async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function proxied(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.endsWith("lumacdn.com") || u.hostname === "cdn.lu.ma") {
      return `/api/public/image?url=${encodeURIComponent(url)}`;
    }
  } catch {}
  return url;
}

function formatDateLine(iso: string): string {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString(undefined, { month: "long", day: "numeric" }).toUpperCase();
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).toUpperCase();
    return `${date} — ${time}`;
  } catch {
    return iso;
  }
}

export type SeedProgress =
  | { phase: "matching"; matched: number; total: number }
  | { phase: "rendering"; index: number; total: number; eventName: string }
  | { phase: "skipped"; eventName: string; reason: string }
  | { phase: "uploaded"; eventName: string }
  | { phase: "error"; eventName: string; message: string }
  | { phase: "done"; created: number; skipped: number };

export async function seedHistoricalBadges(
  events: EventDTO[],
  analyze: (args: { data: { coverUrl: string | null; name: string; description?: string } }) => Promise<Partial<StyleSpec>>,
  onProgress: (p: SeedProgress) => void,
): Promise<void> {
  const matches = matchHistoricEvents(events);
  onProgress({ phase: "matching", matched: matches.length, total: HISTORIC_EVENT_NAMES.length });

  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id ?? null;
  if (!userId) {
    onProgress({ phase: "error", eventName: "auth", message: "Not signed in" });
    return;
  }

  // Load Ignacio photo as data URL
  const photoDataUrl = await fetchAsDataUrl(ignacioAsset.url);

  let created = 0;
  let skipped = 0;

  for (let i = 0; i < matches.length; i++) {
    const { event } = matches[i];
    onProgress({ phase: "rendering", index: i + 1, total: matches.length, eventName: event.name });

    try {
      // Idempotency check
      const { data: existing } = await supabase
        .from("badges" as never)
        .select("id")
        .eq("event_id", event.id)
        .eq("first_name", IGNACIO.firstName)
        .eq("user_id", userId)
        .limit(1);
      if (existing && (existing as unknown[]).length > 0) {
        skipped++;
        onProgress({ phase: "skipped", eventName: event.name, reason: "already exists" });
        continue;
      }

      // Style analysis (best-effort — fall back to default)
      let spec: StyleSpec = DEFAULT_STYLE_SPEC;
      try {
        const s = await analyze({
          data: { coverUrl: event.coverUrl, name: event.name, description: event.description },
        });
        spec = normalizeStyleSpec(s as Partial<StyleSpec>);
      } catch {
        // keep default
      }

      await loadGoogleFontPair(spec.fonts.heading, spec.fonts.body);

      const theme: EventTheme = {
        eventId: event.id,
        name: event.name,
        subtitle: event.city ?? "LU.MA",
        url: event.url,
        coverUrl: proxied(event.coverUrl),
        dateLine: formatDateLine(event.startAt),
      };

      const canvas = await renderBadge({
        theme,
        spec,
        heroDataUrl: null,
        photoDataUrl,
        firstName: IGNACIO.firstName,
        role: IGNACIO.role,
      });

      const blob: Blob | null = await new Promise((res) =>
        canvas.toBlob((b) => res(b), "image/png"),
      );
      if (!blob) throw new Error("canvas produced no blob");

      const id = crypto.randomUUID();
      const path = `${event.id}/${id}.png`;
      const { error: upErr } = await supabase.storage
        .from("badges")
        .upload(path, blob, { contentType: "image/png", upsert: false });
      if (upErr) throw upErr;

      const { error: dbErr } = await supabase.from("badges" as never).insert({
        event_id: event.id,
        first_name: IGNACIO.firstName,
        role: IGNACIO.role,
        image_path: path,
        user_id: userId,
      } as never);
      if (dbErr) throw dbErr;

      created++;
      onProgress({ phase: "uploaded", eventName: event.name });
    } catch (e) {
      onProgress({ phase: "error", eventName: event.name, message: (e as Error).message });
    }
  }

  onProgress({ phase: "done", created, skipped });
}
