import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { getEvent } from "@/lib/luma.functions";
import { analyzeEventArt } from "@/lib/style-analyze.functions";
import { generateHeroArt } from "@/lib/hero-generate.functions";
import { renderBadge, type EventTheme } from "@/lib/badge-render";
import { DEFAULT_STYLE_SPEC, type StyleSpec } from "@/lib/style-spec";
import { loadGoogleFontPair } from "@/lib/google-fonts";
import { BadgeChat } from "@/components/BadgeChat";
import { CameraCapture } from "@/components/CameraCapture";
import { EventBadgeGallery } from "@/components/EventBadgeGallery";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/e/$eventId")({
  head: ({ params }) => ({
    meta: [
      { title: `Generate your badge — event ${params.eventId}` },
      { name: "description", content: "Compose a personalized, shareable badge for this Luma event." },
      { property: "og:title", content: "Generate your event badge" },
      { property: "og:description", content: "Compose a personalized, shareable badge for this Luma event." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EventBadgePage,
});

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

function EventBadgePage() {
  const { eventId } = Route.useParams();
  const fetchEvent = useServerFn(getEvent);
  const analyze = useServerFn(analyzeEventArt);
  const genHero = useServerFn(generateHeroArt);

  const { data: event, isLoading, error } = useQuery({
    queryKey: ["luma-event", eventId],
    queryFn: () => fetchEvent({ data: { id: eventId } }),
  });

  const [firstName, setFirstName] = useState("");
  const [role, setRole] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [spec, setSpec] = useState<StyleSpec>(DEFAULT_STYLE_SPEC);
  const [heroDataUrl, setHeroDataUrl] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [heroBusy, setHeroBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [badgeUrl, setBadgeUrl] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [galleryKey, setGalleryKey] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const coverProxy = proxied(event?.coverUrl ?? null);

  // Kick off AI style analysis on load.
  useEffect(() => {
    if (!event) return;
    let cancelled = false;
    setAnalyzing(true);
    setAiError(null);
    analyze({ data: { coverUrl: event.coverUrl, name: event.name, description: event.description } })
      .then((s) => {
        if (!cancelled) setSpec(s);
      })
      .catch((e: Error) => {
        if (!cancelled) setAiError(`Style analysis failed: ${e.message}`);
      })
      .finally(() => {
        if (!cancelled) setAnalyzing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [event, analyze]);

  // Load Google Fonts whenever spec.fonts changes.
  useEffect(() => {
    loadGoogleFontPair(spec.fonts.heading, spec.fonts.body);
  }, [spec.fonts.heading, spec.fonts.body]);

  async function makeHero() {
    if (!event) return;
    setHeroBusy(true);
    setAiError(null);
    try {
      const { dataUrl } = await genHero({
        data: { spec, eventName: event.name, coverUrl: event.coverUrl ?? undefined },
      });
      setHeroDataUrl(dataUrl);
      setBadgeUrl(null);
    } catch (e) {
      setAiError(`Hero generation failed: ${(e as Error).message}`);
    } finally {
      setHeroBusy(false);
    }
  }

  const theme: EventTheme | null = useMemo(() => {
    if (!event) return null;
    return {
      eventId: event.id,
      name: event.name,
      subtitle: event.city ?? "LU.MA",
      url: event.url,
      coverUrl: coverProxy,
      dateLine: formatDateLine(event.startAt),
    };
  }, [event, coverProxy]);

  function onPickPhoto(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      setPhotoDataUrl(reader.result as string);
      setBadgeUrl(null);
    };
    reader.readAsDataURL(file);
  }

  async function generate() {
    if (!theme || !photoDataUrl || !firstName.trim()) return;
    setBusy(true);
    setBadgeUrl(null);
    try {
      await loadGoogleFontPair(spec.fonts.heading, spec.fonts.body);
      const canvas = await renderBadge({
        theme,
        spec,
        heroDataUrl,
        photoDataUrl,
        firstName: firstName.trim(),
        role: role.trim() || "CREATOR",
      });
      canvasRef.current = canvas;
      setBadgeUrl(canvas.toDataURL("image/png"));
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!badgeUrl) return;
    const a = document.createElement("a");
    a.href = badgeUrl;
    a.download = `${(event?.name ?? "badge").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
    a.click();
  }

  async function share() {
    if (!canvasRef.current || !event) return;
    canvasRef.current.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], "badge.png", { type: "image/png" });
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
        share?: (data: ShareData) => Promise<void>;
      };
      if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
        try {
          await nav.share({
            files: [file],
            title: event.name,
            text: `I'm going to ${event.name} — join me on Luma`,
            url: event.url,
          });
          return;
        } catch {}
      }
      download();
    }, "image/png");
  }

  if (isLoading) {
    return <div className="grid min-h-screen place-items-center bg-[#e9e5d8] font-mono text-sm">LOADING…</div>;
  }
  if (error || !event) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#e9e5d8] p-6 text-center">
        <div>
          <p className="font-mono text-sm">Event not found or Luma error.</p>
          <p className="mt-2 max-w-md text-xs text-red-700">{error ? String((error as Error).message) : ""}</p>
          <Link to="/events" className="mt-4 inline-block underline">
            Back to events
          </Link>
        </div>
      </div>
    );
  }

  const canGenerate = Boolean(photoDataUrl && firstName.trim());
  const accent = spec.palette.accent;

  return (
    <div className="min-h-screen" style={{ backgroundColor: spec.palette.bg, color: spec.palette.text }}>
      <header className="border-b" style={{ borderColor: "rgba(23,21,15,0.16)" }}>
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link to="/events" className="font-mono text-xs tracking-[0.24em]">
            ← ALL EVENTS
          </Link>
          <div className="font-mono text-[10px] tracking-[0.24em]" style={{ color: "rgba(23,21,15,0.55)" }}>
            EVENT · {event.id}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-10 lg:grid-cols-[360px_1fr_380px]">
        {/* LEFT: inputs */}
        <div>
          <div
            className="mb-4 inline-block border-2 px-2 py-0.5 text-[10px] tracking-[0.34em]"
            style={{ borderColor: accent, color: accent }}
          >
            · WHAT'S BREWING?
          </div>
          <h1
            className="text-3xl font-black leading-tight"
            style={{ fontFamily: `"${spec.fonts.heading}", ui-sans-serif, system-ui, sans-serif` }}
          >
            {event.name}
          </h1>
          <div className="mt-2 font-mono text-xs tracking-[0.2em]" style={{ color: "rgba(23,21,15,0.55)" }}>
            {formatDateLine(event.startAt)}
            {event.city ? ` · ${event.city.toUpperCase()}` : ""}
          </div>

          <div className="mt-6 space-y-4">
            <div>
              <label className="font-mono text-xs tracking-[0.2em]">FIRST NAME</label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value.slice(0, 24))}
                maxLength={24}
                placeholder="MARTINA"
                className="mt-1 w-full rounded-md border-2 bg-[#f2efe6] px-4 py-3 text-lg font-bold uppercase tracking-wide focus:outline-none"
                style={{ borderColor: "rgba(23,21,15,0.24)" }}
              />
            </div>
            <div>
              <label className="font-mono text-xs tracking-[0.2em]">ROLE / VIBE</label>
              <input
                value={role}
                onChange={(e) => setRole(e.target.value.slice(0, 32))}
                maxLength={32}
                placeholder="CREATOR"
                className="mt-1 w-full rounded-md border-2 bg-[#f2efe6] px-4 py-3 font-mono uppercase tracking-wide focus:outline-none"
                style={{ borderColor: "rgba(23,21,15,0.24)" }}
              />
            </div>
            <div>
              <label className="font-mono text-xs tracking-[0.2em]">YOUR PHOTO</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => e.target.files?.[0] && onPickPhoto(e.target.files[0])}
                className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#17150f] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-[#f2efe6] hover:file:opacity-90"
              />
              {photoDataUrl && (
                <p className="mt-1 font-mono text-[10px]" style={{ color: "rgba(23,21,15,0.55)" }}>
                  ✓ photo selected
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                onClick={generate}
                disabled={!canGenerate || busy}
                className="inline-flex items-center rounded-md bg-[#17150f] px-4 py-2 text-sm font-semibold text-[#f2efe6] disabled:opacity-40"
              >
                {busy ? "Composing…" : badgeUrl ? "Re-render" : "Render badge →"}
              </button>
              <button
                onClick={makeHero}
                disabled={heroBusy || analyzing}
                className="rounded-md border-2 px-4 py-2 text-sm font-semibold disabled:opacity-40"
                style={{ borderColor: accent, color: accent }}
              >
                {heroBusy ? "Generating hero…" : heroDataUrl ? "Regenerate hero" : "Generate AI hero"}
              </button>
              {badgeUrl && (
                <>
                  <button onClick={download} className="rounded-md border-2 border-[#17150f] px-4 py-2 text-sm font-semibold">
                    PNG
                  </button>
                  <button
                    onClick={share}
                    className="rounded-md px-4 py-2 text-sm font-semibold text-[#f2efe6]"
                    style={{ backgroundColor: accent }}
                  >
                    Share ↗
                  </button>
                </>
              )}
            </div>

            <div className="rounded-md border-2 border-dashed p-3 text-xs font-mono" style={{ borderColor: "rgba(23,21,15,0.24)", color: "rgba(23,21,15,0.7)" }}>
              <div className="mb-2 tracking-[0.2em]">
                {analyzing ? "AI ANALYZING ART…" : "AI STYLE"}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {(["bg", "surface", "accent", "text"] as const).map((k) => (
                  <span
                    key={k}
                    title={`${k}: ${spec.palette[k]}`}
                    className="inline-block h-5 w-5 rounded border"
                    style={{ backgroundColor: spec.palette[k], borderColor: "rgba(23,21,15,0.24)" }}
                  />
                ))}
              </div>
              <div className="mt-2 space-y-0.5">
                <div>heading: <b>{spec.fonts.heading}</b></div>
                <div>body: <b>{spec.fonts.body}</b></div>
                <div>mood: {spec.mood}</div>
              </div>
              {aiError && <div className="mt-2 text-red-700">{aiError}</div>}
            </div>
          </div>
        </div>

        {/* CENTER: preview */}
        <div className="flex flex-col">
          <div className="font-mono text-xs tracking-[0.24em]" style={{ color: "rgba(23,21,15,0.55)" }}>
            · PREVIEW ·
          </div>
          <div
            className="mt-3 flex justify-center rounded-lg border-2 p-6"
            style={{ borderColor: "rgba(23,21,15,0.16)", backgroundColor: spec.palette.surface }}
          >
            {badgeUrl ? (
              <img src={badgeUrl} alt="Your generated badge" className="w-full max-w-md rounded-md shadow-md" />
            ) : (
              <div
                className="flex aspect-[27/40] w-full max-w-md items-center justify-center border-2 border-dashed text-center font-mono text-xs"
                style={{ borderColor: "rgba(23,21,15,0.3)" }}
              >
                <div>
                  <div className="text-2xl">↴</div>
                  <div className="mt-2 tracking-[0.24em]">FILL IN, THEN RENDER</div>
                </div>
              </div>
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {event.coverUrl && (
              <div>
                <div className="font-mono text-[10px] tracking-[0.24em]" style={{ color: "rgba(23,21,15,0.55)" }}>
                  EVENT ART
                </div>
                <img src={coverProxy!} alt="" className="mt-1 w-full rounded-md border-2" style={{ borderColor: "rgba(23,21,15,0.16)" }} />
              </div>
            )}
            {heroDataUrl && (
              <div>
                <div className="font-mono text-[10px] tracking-[0.24em]" style={{ color: "rgba(23,21,15,0.55)" }}>
                  AI HERO
                </div>
                <img src={heroDataUrl} alt="" className="mt-1 w-full rounded-md border-2" style={{ borderColor: accent }} />
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: AI chat */}
        <div className="h-[600px]">
          <BadgeChat spec={spec} eventName={event.name} onSpecChange={setSpec} />
        </div>
      </div>
    </div>
  );
}
