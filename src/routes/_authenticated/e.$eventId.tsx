import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { getEvent } from "@/lib/luma.functions";
import { analyzeEventArt } from "@/lib/style-analyze.functions";
import { listTemplates, type TemplateDTO } from "@/lib/templates.functions";
import {
  listEventPresets,
  saveEventPreset,
  deleteEventPreset,
  type EventStylePresetDTO,
} from "@/lib/event-style-presets.functions";
import { extractPixelEvidence } from "@/lib/pixel-evidence";

import { renderBadge, type EventTheme } from "@/lib/badge-render";
import { DEFAULT_STYLE_SPEC, type StyleSpec } from "@/lib/style-spec";
import { loadGoogleFontPair } from "@/lib/google-fonts";
import { BadgeChat } from "@/components/BadgeChat";
import { CameraCapture } from "@/components/CameraCapture";
import { EventBadgeGallery } from "@/components/EventBadgeGallery";
import { supabase } from "@/integrations/supabase/client";
import { copyToClipboard, prettyUrl } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/e/$eventId")({
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
  const fetchTemplates = useServerFn(listTemplates);
  const fetchPresets = useServerFn(listEventPresets);
  const savePreset = useServerFn(saveEventPreset);
  const removePreset = useServerFn(deleteEventPreset);
  const qc = useQueryClient();

  const { data: event, isLoading, error } = useQuery({
    queryKey: ["luma-event", eventId],
    queryFn: () => fetchEvent({ data: { id: eventId } }),
  });

  const { data: templates } = useQuery({
    queryKey: ["templates"],
    queryFn: () => fetchTemplates(),
  });

  const { data: presets } = useQuery({
    queryKey: ["event-presets", eventId],
    queryFn: () => fetchPresets({ data: { eventId } }),
  });

  const [firstName, setFirstName] = useState("");
  const [role, setRole] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [spec, setSpec] = useState<StyleSpec>(DEFAULT_STYLE_SPEC);
  const [analyzing, setAnalyzing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [badgeUrl, setBadgeUrl] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [galleryKey, setGalleryKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const savePresetMut = useMutation({
    mutationFn: (input: { styleSpec: StyleSpec; label?: string | null }) =>
      savePreset({ data: { eventId, ...input } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["event-presets", eventId] }),
  });
  const deletePresetMut = useMutation({
    mutationFn: (id: string) => removePreset({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["event-presets", eventId] }),
  });

  const coverProxy = proxied(event?.coverUrl ?? null);

  const runAnalyze = useMemo(
    () => async () => {
      if (!event) return;
      setAnalyzing(true);
      setAiError(null);
      try {
        const evidence = coverProxy ? await extractPixelEvidence(coverProxy) : null;
        const s = await analyze({
          data: {
            coverUrl: event.coverUrl,
            name: event.name,
            description: event.description,
            eventUrl: event.url,
            pixelEvidence: evidence,
          },
        });
        setSpec(s);
      } catch (e) {
        setAiError(`Style analysis failed: ${(e as Error).message}`);
      } finally {
        setAnalyzing(false);
      }
    },
    [event, analyze, coverProxy],
  );

  useEffect(() => {
    if (!event) return;
    runAnalyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id]);

  useEffect(() => {
    loadGoogleFontPair(spec.fonts.heading, spec.fonts.body);
  }, [spec.fonts.heading, spec.fonts.body]);


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

  async function persistBadge(canvas: HTMLCanvasElement) {
    const blob: Blob | null = await new Promise((res) =>
      canvas.toBlob((b) => res(b), "image/png"),
    );
    if (!blob) return;
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id ?? null;
    const id = crypto.randomUUID();
    const path = `${eventId}/${id}.png`;
    const { error: upErr } = await supabase.storage
      .from("badges")
      .upload(path, blob, { contentType: "image/png", upsert: false });
    if (upErr) {
      console.error("upload failed", upErr);
      return;
    }
    const { error: dbErr } = await supabase.from("badges" as never).insert({
      event_id: eventId,
      first_name: firstName.trim(),
      role: role.trim() || null,
      image_path: path,
      user_id: userId,
    } as never);
    if (dbErr) {
      console.error("db insert failed", dbErr);
      return;
    }
    setGalleryKey((k) => k + 1);
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
        photoDataUrl,
        firstName: firstName.trim(),
        role: role.trim() || "CREATOR",
      });
      canvasRef.current = canvas;
      setBadgeUrl(canvas.toDataURL("image/png"));
      persistBadge(canvas).catch((e) => console.error(e));
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

  function shareMessage(): string {
    if (!event) return "";
    return `Voy a asistir a ${event.name} 🎟️ ¡Nos vemos ahí!`;
  }

  function shareOnX() {
    if (!event) return;
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
      shareMessage(),
    )}&url=${encodeURIComponent(event.url)}`;
    window.open(url, "_blank", "noopener,noreferrer,width=600,height=600");
  }

  function shareOnLinkedIn() {
    if (!event) return;
    const url = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(event.url)}`;
    window.open(url, "_blank", "noopener,noreferrer,width=600,height=600");
  }

  async function nativeShare() {
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
            text: shareMessage(),
            url: event.url,
          });
          return;
        } catch {}
      }
      download();
    }, "image/png");
  }

  if (isLoading) {
    return (
      <div className="grid min-h-[50vh] place-items-center font-mono text-sm text-muted-foreground">
        LOADING…
      </div>
    );
  }
  if (error || !event) {
    const msg = error ? String((error as Error).message) : "";
    const isMissingKey = msg.includes("NO_LUMA_KEY");
    return (
      <div className="grid min-h-[50vh] place-items-center p-6 text-center">
        <div>
          {isMissingKey ? (
            <>
              <p className="text-sm">Add your Luma API key to load this event.</p>
              <Link
                to="/settings"
                className="mt-4 inline-block rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
              >
                Go to Settings →
              </Link>
            </>
          ) : (
            <>
              <p className="text-sm">Event not found or Luma error.</p>
              <p className="mt-2 max-w-md text-xs text-destructive">{msg}</p>
              <Link to="/events" className="mt-4 inline-block text-accent underline">
                Back to events
              </Link>
            </>
          )}
        </div>
      </div>
    );
  }

  const canGenerate = Boolean(photoDataUrl && firstName.trim());
  const accent = spec.palette.accent;

  return (
    <>
      <div className="mx-auto max-w-7xl px-6 pt-6">
        <Link
          to="/events"
          className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground hover:text-foreground"
        >
          ← All events
        </Link>
      </div>

      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-8 lg:grid-cols-[360px_1fr_380px]">
        {/* LEFT: inputs */}
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-hairline bg-surface/60 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            What's brewing
          </div>
          <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight">
            {event.name}
          </h1>
          <div className="mt-2 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {formatDateLine(event.startAt)}
            {event.city ? ` · ${event.city.toUpperCase()}` : ""}
          </div>

          <div className="mt-6 space-y-4">
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                First name
              </label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value.slice(0, 24))}
                maxLength={24}
                placeholder="Martina"
                className="mt-1 w-full rounded-xl border border-hairline bg-surface/70 px-4 py-3 text-lg font-semibold text-foreground placeholder:text-muted-foreground focus:border-white/30 focus:outline-none"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                Role / Company
              </label>
              <input
                value={role}
                onChange={(e) => setRole(e.target.value.slice(0, 60))}
                maxLength={60}
                placeholder="e.g. Designer, Acme Inc"
                className="mt-1 w-full rounded-xl border border-hairline bg-surface/70 px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-white/30 focus:outline-none"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                Your photo
              </label>
              <div className="mt-1 flex gap-2">
                <label className="flex-1 cursor-pointer rounded-full bg-primary px-4 py-2 text-center text-sm font-semibold text-primary-foreground hover:opacity-90">
                  Upload
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => e.target.files?.[0] && onPickPhoto(e.target.files[0])}
                    className="hidden"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  className="flex-1 rounded-full border border-hairline px-4 py-2 text-sm font-semibold hover:bg-surface"
                >
                  📷 Take photo
                </button>
              </div>
              {photoDataUrl && (
                <div className="mt-2 flex items-center gap-3">
                  <img
                    src={photoDataUrl}
                    alt="Your photo"
                    className="h-16 w-16 rounded-xl border border-hairline object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setPhotoDataUrl(null);
                      setBadgeUrl(null);
                    }}
                    className="font-mono text-[10px] text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    remove
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                onClick={generate}
                disabled={!canGenerate || busy}
                className="inline-flex items-center rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
              >
                {busy ? "Composing…" : badgeUrl ? "Re-render" : "Render badge →"}
              </button>
              {badgeUrl && (
                <>
                  <button
                    onClick={download}
                    className="rounded-full border border-hairline px-4 py-2 text-sm font-semibold hover:bg-surface"
                  >
                    ↓ PNG
                  </button>
                  <button
                    onClick={shareOnX}
                    className="rounded-full bg-black px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                    title="Share on X"
                  >
                    Share on 𝕏
                  </button>
                  <button
                    onClick={shareOnLinkedIn}
                    className="rounded-full px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                    style={{ backgroundColor: "#0A66C2" }}
                    title="Share on LinkedIn"
                  >
                    in — LinkedIn
                  </button>
                  <button
                    onClick={nativeShare}
                    className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"
                  >
                    Share ↗
                  </button>
                </>
              )}
            </div>

            <div className="rounded-2xl border border-hairline bg-surface/60 p-4 text-xs text-muted-foreground">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.24em]">
                  {analyzing ? "AI analyzing art…" : "AI style"}
                </div>
                <button
                  type="button"
                  onClick={runAnalyze}
                  disabled={analyzing}
                  className="rounded-full border border-hairline px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] hover:bg-surface-2 disabled:opacity-40"
                  title="Re-detect style from cover art"
                >
                  {analyzing ? "…" : "↻ Re-detect"}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {(["bg", "surface", "accent", "text"] as const).map((k) => (
                  <span
                    key={k}
                    title={`${k}: ${spec.palette[k]}`}
                    className="inline-block h-5 w-5 rounded border border-hairline"
                    style={{ backgroundColor: spec.palette[k] }}
                  />
                ))}
              </div>
              <div className="mt-2 space-y-0.5 text-foreground">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">style: {spec.style}</div>
                <div>heading: <b>{spec.fonts.heading}</b></div>
                <div>body: <b>{spec.fonts.body}</b></div>
                <div className="text-muted-foreground">mood: {spec.mood}</div>
              </div>
              {aiError && <div className="mt-2 text-destructive">{aiError}</div>}
            </div>

            {templates && templates.length > 0 && (
              <div className="rounded-2xl border border-hairline bg-surface/60 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                    · Templates
                  </div>
                  <Link
                    to="/templates"
                    className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground"
                  >
                    all →
                  </Link>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {templates.slice(0, 6).map((t: TemplateDTO) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSpec(t.styleSpec)}
                      title={`Apply "${t.name}"`}
                      className="group rounded-lg border border-hairline p-1.5 text-left hover:border-accent/60"
                    >
                      <div
                        className="mb-1 h-10 w-full rounded"
                        style={{
                          background: `linear-gradient(135deg, ${t.styleSpec.palette.bg} 0%, ${t.styleSpec.palette.bg} 45%, ${t.styleSpec.palette.accent} 45%, ${t.styleSpec.palette.accent} 60%, ${t.styleSpec.palette.surface} 60%)`,
                        }}
                      />
                      <div className="truncate text-[10px] font-semibold">{t.name}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* CENTER: preview */}
        <div className="flex flex-col">
          <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            · Preview
          </div>
          <div className="mt-3 flex justify-center rounded-2xl border border-hairline bg-surface/50 p-6">
            {badgeUrl ? (
              <img src={badgeUrl} alt="Your generated badge" className="w-full max-w-md rounded-xl shadow-2xl" />
            ) : (
              <div className="flex aspect-[27/40] w-full max-w-md items-center justify-center rounded-xl border border-dashed border-hairline text-center font-mono text-xs text-muted-foreground">
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
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                  Event art
                </div>
                <img
                  src={coverProxy!}
                  alt=""
                  className="mt-1 w-full rounded-xl border border-hairline"
                />
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: AI chat */}
        <div className="h-[620px]">
          <BadgeChat
            spec={spec}
            eventContext={{
              name: event.name,
              city: event.city ?? null,
              dateLine: formatDateLine(event.startAt),
              description: event.description ?? null,
              coverUrl: event.coverUrl,
            }}
            onSpecChange={setSpec}
          />
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 pb-16">
        <EventBadgeGallery
          eventId={eventId}
          accent={accent}
          textColor={spec.palette.text}
          refreshKey={galleryKey}
        />
      </div>

      {cameraOpen && (
        <CameraCapture
          onCapture={(dataUrl) => {
            setPhotoDataUrl(dataUrl);
            setBadgeUrl(null);
            setCameraOpen(false);
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </>
  );
}
