// Admin seed util: uploads the CANONICAL pre-rendered historical badges from
// crafter-station/event-badge-history (code-brew-bog eras) as placeholder
// badges for Ignacio Velásquez. No local rendering — just fetch → upload.
import { supabase } from "@/integrations/supabase/client";
import type { EventDTO } from "@/lib/luma.functions";

import era1 from "@/assets/history/era1-code-brew.png";
import era2 from "@/assets/history/era2-v0-zero-to-agents.png";
import era3 from "@/assets/history/era3-gtm-hackathon.png";
import era4 from "@/assets/history/era4-cursor-meetup.png";
import era5 from "@/assets/history/era5-cursor-buildathon-sv.png";
import era6 from "@/assets/history/era6-codebrew-sv.png";

export type HistoricEra = {
  id: string;
  canonical: string;
  aliases: string[];
  asset: string;
};

export const HISTORIC_ERAS: HistoricEra[] = [
  { id: "era1", canonical: "Code Brew (original)", aliases: ["Code Brew", "Code Brew Bogotá", "Code Brew Bogota"], asset: era1 },
  { id: "era2", canonical: "v0 / Zero to Agent", aliases: ["v0 Zero-to-Agent", "Zero to Agent", "v0 Zero to Agent"], asset: era2 },
  { id: "era3", canonical: "The GTM Hackathon", aliases: ["GTM Hackathon"], asset: era3 },
  { id: "era4", canonical: "Cursor Meetup", aliases: ["Cursor Meetup Bogotá", "Cursor Meetup Bogota", "Cursor Bogotá"], asset: era4 },
  { id: "era5", canonical: "Cursor Buildathon El Salvador 2026", aliases: ["Cursor Buildathon", "Buildathon SV", "Cursor Buildathon SV", "Cursor Buildathon El Salvador"], asset: era5 },
  { id: "era6", canonical: "Code Brew El Salvador", aliases: ["Code Brew SV", "Code Brew San Salvador"], asset: era6 },
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

function scoreOne(target: string, candidate: string): number {
  const tN = normalize(target);
  const cN = normalize(candidate);
  if (!tN || !cN) return 0;
  if (cN === tN) return 1;
  if (cN.includes(tN) || tN.includes(cN)) return 0.95;
  const t = new Set(tokens(target));
  const c = new Set(tokens(candidate));
  if (t.size === 0 || c.size === 0) return 0;
  let inter = 0;
  t.forEach((tok) => {
    if (c.has(tok)) inter++;
  });
  // Jaccard-ish; favor coverage of the shorter set (usually target).
  return inter / Math.min(t.size, c.size);
}

function scoreEra(era: HistoricEra, candidate: string): number {
  let best = scoreOne(era.canonical, candidate);
  for (const alias of era.aliases) {
    const s = scoreOne(alias, candidate);
    if (s > best) best = s;
  }
  return best;
}

export function matchHistoricEvents(events: EventDTO[]): Array<{
  era: HistoricEra;
  event: EventDTO;
  score: number;
}> {
  const matches: Array<{ era: HistoricEra; event: EventDTO; score: number }> = [];
  const usedIds = new Set<string>();
  const THRESHOLD = 0.6;
  for (const era of HISTORIC_ERAS) {
    let best: { event: EventDTO; score: number } | null = null;
    for (const ev of events) {
      if (usedIds.has(ev.id)) continue;
      const s = scoreEra(era, ev.name);
      if (s >= THRESHOLD && (!best || s > best.score)) best = { event: ev, score: s };
    }
    if (best) {
      usedIds.add(best.event.id);
      matches.push({ era, event: best.event, score: best.score });
    }
  }
  return matches;
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
  _unusedAnalyze: unknown,
  onProgress: (p: SeedProgress) => void,
): Promise<void> {
  const matches = matchHistoricEvents(events);
  onProgress({ phase: "matching", matched: matches.length, total: HISTORIC_ERAS.length });

  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id ?? null;
  if (!userId) {
    onProgress({ phase: "error", eventName: "auth", message: "Not signed in" });
    return;
  }

  let created = 0;
  let skipped = 0;

  for (let i = 0; i < matches.length; i++) {
    const { era, event } = matches[i];
    onProgress({ phase: "rendering", index: i + 1, total: matches.length, eventName: event.name });

    try {
      // Idempotency: skip if the same user already seeded a badge for this event.
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

      // Fetch the canonical historical PNG bundled with the app.
      const res = await fetch(era.asset);
      if (!res.ok) throw new Error(`asset fetch ${res.status}`);
      const blob = await res.blob();

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
