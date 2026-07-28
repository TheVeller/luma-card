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

import { type EventTheme } from "@/lib/badge-render";
import { renderBadgeDoc, renderToCanvas } from "@/lib/badge-doc/render";
import type { RenderOp } from "@/lib/badge-doc/layout/engine";
import { BadgePreview } from "@/components/BadgePreview";
import { BadgeLibrary } from "@/components/BadgeLibrary";
import { MAX_LOGOS } from "@/lib/badge-doc/presets/build";
import { CLASSIC_BADGE_DOC } from "@/lib/badge-doc/presets/classic";
import type { BadgeDoc } from "@/lib/badge-doc/schema";
import { BadgeControls } from "@/components/BadgeControls";
import { DEFAULT_STYLE_SPEC, type StyleSpec } from "@/lib/style-spec";
import { loadGoogleFontPair } from "@/lib/google-fonts";
import { BadgeChat } from "@/components/BadgeChat";
import { CameraCapture } from "@/components/CameraCapture";
import { EventBadgeGallery } from "@/components/EventBadgeGallery";
import { supabase } from "@/integrations/supabase/client";
import { copyToClipboard, prettyUrl } from "@/lib/utils";
import { getEventBrandKit } from "@/lib/brand-kits.functions";

export const Route = createFileRoute("/_authenticated/e/$eventId")({
  head: ({ params }) => ({
    meta: [
      { title: `Generate your badge — event ${params.eventId}` },
      {
        name: "description",
        content: "Compose a personalized, shareable badge for this Luma event.",
      },
      { property: "og:title", content: "Generate your event badge" },
      {
        property: "og:description",
        content: "Compose a personalized, shareable badge for this Luma event.",
      },
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
  } catch {
    // not a parseable URL — use it as-is
  }
  return url;
}

function formatDateLine(iso: string): string {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString(undefined, { month: "long", day: "numeric" }).toUpperCase();
    const time = d
      .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
      .toUpperCase();
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
  const fetchBrandKit = useServerFn(getEventBrandKit);
  const qc = useQueryClient();

  const {
    data: event,
    isLoading,
    error,
  } = useQuery({
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
  const { data: brandKit } = useQuery({
    queryKey: ["event-brand-kit", eventId],
    queryFn: () => fetchBrandKit({ data: { eventId } }),
  });

  const [firstName, setFirstName] = useState("");
  const [role, setRole] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  // Sponsor logos and, optionally, a community logo that takes the seal's place.
  const [logos, setLogos] = useState<string[]>([]);
  const [sealLogo, setSealLogo] = useState<string | null>(null);
  const [spec, setSpec] = useState<StyleSpec>(DEFAULT_STYLE_SPEC);
  // The layout itself is now editable state, with a shallow undo stack so a
  // change from the AI or a control can always be walked back.
  const [doc, setDoc] = useState<BadgeDoc>(CLASSIC_BADGE_DOC);
  const [docHistory, setDocHistory] = useState<{ doc: BadgeDoc; intent: string }[]>([]);

  function applyDoc(next: BadgeDoc, intent: string) {
    setDocHistory((h) => [...h.slice(-19), { doc, intent }]);
    setDoc(next);
  }

  function undoDoc() {
    setDocHistory((h) => {
      const last = h[h.length - 1];
      if (last) setDoc(last.doc);
      return h.slice(0, -1);
    });
  }
  const [analyzing, setAnalyzing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [badgeUrl, setBadgeUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [ops, setOps] = useState<RenderOp[]>([]);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [panel, setPanel] = useState<"design" | "chat">("design");
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
  // Newest saved style for this event — drives the cache-vs-generate UI below.
  const savedStyle = presets?.[0] ?? null;

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
        // Persist immediately. Analysis costs credits (Firecrawl branding scrape +
        // a Gemini vision call), so the result must survive even if the user never
        // renders a badge. The upsert dedupes by spec_hash.
        savePresetMut.mutate({ styleSpec: s, label: "auto" });
      } catch (e) {
        setAiError(`Style analysis failed: ${(e as Error).message}`);
      } finally {
        setAnalyzing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [event, analyze, coverProxy],
  );

  // Hydrate from the saved style instead of re-running the AI on every mount.
  // Runs once per event id, and only before the user has touched the style.
  const hydratedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!presets || brandKit === undefined || hydratedForRef.current === eventId) return;
    hydratedForRef.current = eventId;
    if (presets.length > 0) {
      setSpec(presets[0].styleSpec);
      return;
    }
    if (brandKit) {
      setSpec(brandKit.styleSpec);
      if (brandKit.badgeDoc) setDoc(brandKit.badgeDoc);
      setLogos(brandKit.logos);
    }
  }, [presets, brandKit, eventId]);

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

  function onPickLogos(files: FileList | null) {
    if (!files) return;
    // Read them all, then append in the order they were chosen.
    Promise.all(
      Array.from(files)
        .slice(0, MAX_LOGOS)
        .map(
          (file) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(file);
            }),
        ),
    )
      .then((urls) => setLogos((current) => [...current, ...urls].slice(0, MAX_LOGOS)))
      .catch((e) => console.error("logo read failed", e));
  }

  function onPickPhoto(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      setPhotoDataUrl(reader.result as string);
      setBadgeUrl(null);
    };
    reader.readAsDataURL(file);
  }

  async function persistBadge(canvas: HTMLCanvasElement) {
    const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), "image/png"));
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

  // Live preview: re-renders on every change at half scale, which is a quarter
  // of the pixels. The badge used to appear only after pressing Render, so a
  // colour or layout tweak was invisible until you asked for it again.
  useEffect(() => {
    if (!theme || !photoDataUrl || !firstName.trim()) {
      setPreviewUrl(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const rendered = await renderBadgeDoc({
          doc,
          spec,
          event: {
            name: theme.name,
            subtitle: theme.subtitle,
            dateLine: theme.dateLine,
            url: theme.url,
            coverUrl: theme.coverUrl,
          },
          user: {
            firstName: firstName.trim(),
            role: role.trim() || "CREATOR",
            photo: photoDataUrl,
          },
          scale: 0.5,
        });
        // Image and geometry land together, so the highlight can never point at
        // where a piece used to be.
        if (!cancelled) {
          setPreviewUrl(rendered.canvas.toDataURL("image/png"));
          setOps(rendered.ops);
        }
      } catch (e) {
        console.error("preview failed", e);
      }
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [doc, spec, theme, photoDataUrl, firstName, role, logos, sealLogo]);

  async function generate() {
    if (!theme || !photoDataUrl || !firstName.trim()) return;
    setBusy(true);
    setBadgeUrl(null);
    try {
      await loadGoogleFontPair(spec.fonts.heading, spec.fonts.body);
      const canvas = await renderToCanvas({
        doc,
        spec,
        event: {
          name: theme.name,
          subtitle: theme.subtitle,
          dateLine: theme.dateLine,
          url: theme.url,
          coverUrl: theme.coverUrl,
        },
        user: {
          firstName: firstName.trim(),
          role: role.trim() || "CREATOR",
          photo: photoDataUrl,
          logos,
          sealLogo,
        },
      });
      canvasRef.current = canvas;
      setBadgeUrl(canvas.toDataURL("image/png"));
      savePresetMut.mutate({ styleSpec: spec });
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
        } catch {
          // share sheet dismissed or unsupported — fall through to download
        }
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
      {/* Slim context bar: the event is context, not the task. */}
      <div className="sticky top-0 z-20 border-b border-hairline bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3">
          <Link
            to="/events"
            className="shrink-0 font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground transition-colors hover:text-foreground"
          >
            ←
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-base font-semibold leading-tight tracking-tight">
              {event.name}
            </h1>
            <div className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {formatDateLine(event.startAt)}
              {event.city ? ` · ${event.city.toUpperCase()}` : ""}
            </div>
          </div>
          {event.url && (
            <div className="hidden shrink-0 items-center gap-2 sm:flex">
              <a
                href={event.url}
                target="_blank"
                rel="noopener noreferrer"
                className="max-w-[220px] truncate font-mono text-[11px] text-accent underline underline-offset-4 hover:text-foreground"
                title={event.url}
              >
                {prettyUrl(event.url)}
              </a>
              <button
                type="button"
                onClick={async () => {
                  const ok = await copyToClipboard(event.url);
                  if (ok) {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1400);
                  }
                }}
                title="Copy event link"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-hairline text-[10px] text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
              >
                {copied ? "✓" : "⧉"}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-8 lg:grid-cols-[320px_1fr_380px]">
        {/* The badge leads on small screens — it is what the page is about. */}
        <div className="lg:order-2">
          <div className="lg:sticky lg:top-24">
            <BadgePreview
              src={badgeUrl ?? previewUrl}
              ops={ops}
              canvasWidth={doc.canvas.width}
              canvasHeight={doc.canvas.height}
              highlightId={hoveredNodeId}
              saved={Boolean(badgeUrl)}
              busy={busy}
              missing={
                !firstName.trim() ? "Add your first name" : !photoDataUrl ? "Add your photo" : null
              }
              onUndo={docHistory.length > 0 ? undoDoc : undefined}
              undoLabel={docHistory[docHistory.length - 1]?.intent ?? null}
            />
          </div>
        </div>

        {/* LEFT: who you are */}
        <div className="space-y-5 lg:order-1">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            · You
          </h2>

          <div>
            <label
              htmlFor="first-name"
              className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground"
            >
              First name
            </label>
            <input
              id="first-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value.slice(0, 24))}
              maxLength={24}
              placeholder="Martina"
              className="mt-1 w-full rounded-xl border border-hairline bg-surface/70 px-4 py-3 text-lg font-semibold text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="role"
              className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground"
            >
              Role / Company
            </label>
            <input
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value.slice(0, 60))}
              maxLength={60}
              placeholder="e.g. Designer, Acme Inc"
              className="mt-1 w-full rounded-xl border border-hairline bg-surface/70 px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              Your photo
            </span>
            {photoDataUrl ? (
              <div className="mt-1 flex items-center gap-3 rounded-xl border border-hairline bg-surface/70 p-2">
                <img
                  src={photoDataUrl}
                  alt="Your photo"
                  className="h-14 w-14 rounded-lg border border-hairline object-cover"
                />
                <div className="flex flex-1 flex-col items-start gap-1">
                  <label className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground underline underline-offset-4 hover:text-foreground">
                    replace
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => e.target.files?.[0] && onPickPhoto(e.target.files[0])}
                      className="hidden"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setPhotoDataUrl(null);
                      setBadgeUrl(null);
                    }}
                    className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  >
                    remove
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-1 flex gap-2">
                <label className="flex-1 cursor-pointer rounded-full bg-primary px-4 py-2 text-center text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90">
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
                  className="flex-1 rounded-full border border-hairline px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface"
                >
                  📷 Take photo
                </button>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                Logos
              </span>
              <span className="font-mono text-[9px] text-muted-foreground">
                {logos.length}/{MAX_LOGOS}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              Sponsors or community marks. They fill the badge&apos;s logo row in order.
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {logos.map((logo, i) => (
                <div key={`${logo.slice(-16)}-${i}`} className="group relative">
                  <img
                    src={logo}
                    alt={`Logo ${i + 1}`}
                    className="h-10 w-16 rounded-md border border-hairline bg-surface object-contain p-1"
                  />
                  <button
                    type="button"
                    onClick={() => setLogos((l) => l.filter((_, j) => j !== i))}
                    className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-black/70 text-[9px] text-white opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label={`Remove logo ${i + 1}`}
                  >
                    ×
                  </button>
                </div>
              ))}
              {logos.length < MAX_LOGOS && (
                <label className="grid h-10 w-16 cursor-pointer place-items-center rounded-md border border-dashed border-hairline text-sm text-muted-foreground transition-colors hover:border-accent/60 hover:text-foreground">
                  +
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => onPickLogos(e.target.files)}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={sealLogo !== null}
                disabled={logos.length === 0}
                onChange={(e) => setSealLogo(e.target.checked ? (logos[0] ?? null) : null)}
                className="accent-accent"
              />
              Use the first logo in the seal instead of the event cover
            </label>
          </div>

          {/* Actions live at the end of the column, where the task ends. */}
          <div className="space-y-2 border-t border-hairline pt-5">
            <button
              onClick={generate}
              disabled={!canGenerate || busy}
              className="w-full rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              title={
                canGenerate ? "Save this badge to your gallery" : "Add a name and a photo first"
              }
            >
              {busy ? "Saving…" : badgeUrl ? "Save again" : "Save badge"}
            </button>
            <p className="text-center text-[11px] leading-snug text-muted-foreground">
              {badgeUrl
                ? "Saved to your gallery below."
                : "The preview updates as you edit; saving adds it to your gallery."}
            </p>

            {badgeUrl && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={download}
                  className="rounded-full border border-hairline px-3 py-2 text-xs font-semibold transition-colors hover:bg-surface"
                >
                  ↓ PNG
                </button>
                <button
                  onClick={nativeShare}
                  className="rounded-full bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground transition-opacity hover:opacity-90"
                >
                  Share ↗
                </button>
                <button
                  onClick={shareOnX}
                  className="rounded-full bg-black px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                  title="Share on X"
                >
                  𝕏
                </button>
                <button
                  onClick={shareOnLinkedIn}
                  className="rounded-full px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ backgroundColor: "#0A66C2" }}
                  title="Share on LinkedIn"
                >
                  in
                </button>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: how it looks */}
        <div className="lg:order-3">
          <div className="mb-3 flex rounded-full border border-hairline p-0.5">
            {[
              { key: "design" as const, label: "Design" },
              { key: "chat" as const, label: "AI chat" },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setPanel(t.key)}
                className={`flex-1 rounded-full px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors ${
                  panel === t.key
                    ? "bg-surface-2 text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {panel === "design" ? (
            <div className="space-y-6 rounded-2xl border border-hairline bg-surface/60 p-4">
              <section>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                    {analyzing ? "Analyzing art…" : "AI style"}
                  </h3>
                  {savedStyle && (
                    <button
                      type="button"
                      onClick={runAnalyze}
                      disabled={analyzing}
                      className="rounded-full border border-hairline px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-40"
                      title="Run the AI again — consumes credits"
                    >
                      {analyzing ? "…" : "↻"}
                    </button>
                  )}
                </div>
                {savedStyle ? (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    <span className="text-foreground">{spec.style}</span> · {spec.mood} · saved{" "}
                    {new Date(savedStyle.createdAt).toLocaleDateString()}
                  </p>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={runAnalyze}
                      disabled={analyzing || !event}
                      className="w-full rounded-full bg-accent px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                    >
                      {analyzing ? "Analyzing…" : "✨ Generate AI style"}
                    </button>
                    <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                      Reads the cover art to pick palette and fonts. Consumes AI credits — the
                      result is saved and reused on your next visit.
                    </p>
                  </>
                )}
                {aiError && <p className="mt-2 text-[11px] text-destructive">{aiError}</p>}
              </section>

              <BadgeControls
                spec={spec}
                doc={doc}
                onSpecChange={setSpec}
                onDocChange={applyDoc}
                onHoverNode={setHoveredNodeId}
              />

              <BadgeLibrary
                presets={presets ?? []}
                templates={templates ?? []}
                activeStyle={spec}
                onApply={setSpec}
                onDeletePreset={(id) => deletePresetMut.mutate(id)}
                activeLayoutName={doc.meta.name}
                onApplyLayout={applyDoc}
              />
            </div>
          ) : (
            <div className="h-[620px]">
              <BadgeChat
                doc={doc}
                onDocChange={applyDoc}
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
          )}
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
