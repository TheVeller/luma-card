// TEMPORARY dev-only page — deleted at the end of the BadgeDoc migration.
// Renders every system template through the legacy renderer and through the
// text-reset renderer so the one-time visual change can be reviewed, and
// reports how far the advance-width table drifts from ctx.measureText.

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { renderBadge, type EventTheme } from "@/lib/badge-render";
import { renderBadgeReset } from "@/lib/badge-render-reset";
import { normalizeStyleSpec, type StyleSpec } from "@/lib/style-spec";
import { loadGoogleFontPair, validateFontPair } from "@/lib/google-fonts";
import { TableMeasurer } from "@/lib/badge-doc/layout/measure";

export const Route = createFileRoute("/dev/parity")({ ssr: false, component: ParityPage });

/** The six seeded system templates (migration 20260723174644). */
const TEMPLATES: { slug: string; spec: StyleSpec }[] = [
  {
    slug: "era1-code-brew",
    spec: normalizeStyleSpec({
      style: "warm-paper",
      palette: {
        bg: "#efeadd",
        surface: "#e6dfcc",
        accent: "#e33d3d",
        text: "#141311",
        textMuted: "#7a7264",
      },
      fonts: { heading: "Space Grotesk", body: "IBM Plex Mono" },
      mood: "cream paper editorial",
    }),
  },
  {
    slug: "era2-v0-zero-to-agents",
    spec: normalizeStyleSpec({
      style: "dark-mode-tech",
      palette: {
        bg: "#0a0a0a",
        surface: "#141414",
        accent: "#4ec7ff",
        text: "#f5f5f0",
        textMuted: "#8a8a86",
      },
      fonts: { heading: "Sora", body: "JetBrains Mono" },
      mood: "dark tech neon",
    }),
  },
  {
    slug: "era3-gtm-hackathon",
    spec: normalizeStyleSpec({
      style: "bold-punk",
      palette: {
        bg: "#f2ecdd",
        surface: "#e8dfc8",
        accent: "#f03d44",
        text: "#111111",
        textMuted: "#6f6857",
      },
      fonts: { heading: "Archivo Black", body: "Space Mono" },
      mood: "bold punk hackathon",
    }),
  },
  {
    slug: "era4-cursor-meetup",
    spec: normalizeStyleSpec({
      style: "industrial-mono",
      palette: {
        bg: "#e9e6de",
        surface: "#dedbd1",
        accent: "#151515",
        text: "#111111",
        textMuted: "#6a6660",
      },
      fonts: { heading: "IBM Plex Mono", body: "IBM Plex Mono" },
      mood: "industrial mono meetup",
    }),
  },
  {
    slug: "era5-cursor-buildathon-sv",
    spec: normalizeStyleSpec({
      style: "mono-terminal",
      palette: {
        bg: "#f5f1e4",
        surface: "#ebe6d5",
        accent: "#111111",
        text: "#111111",
        textMuted: "#5d5a55",
      },
      fonts: { heading: "Space Mono", body: "IBM Plex Mono" },
      mood: "terminal mono buildathon",
    }),
  },
  {
    slug: "era6-codebrew-sv",
    spec: normalizeStyleSpec({
      style: "editorial-serif",
      palette: {
        bg: "#f1ecdd",
        surface: "#e6dfcb",
        accent: "#a5522f",
        text: "#141210",
        textMuted: "#736c5b",
      },
      fonts: { heading: "Instrument Serif", body: "Inter" },
      mood: "editorial serif warm",
    }),
  },
];

const THEME: EventTheme = {
  eventId: "dev-parity",
  name: "Code Brew Bogotá — Builders Night",
  subtitle: "BOGOTÁ",
  url: "https://luma.com/ai-first-founders",
  coverUrl: null,
  dateLine: "SEPTEMBER 12 — 7:00 PM",
};

/** A deterministic stand-in for the user photo, so runs are comparable. */
function makePhoto(): string {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 512, 512);
  g.addColorStop(0, "#8a8f98");
  g.addColorStop(1, "#3b3f46");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = '700 48px "Inter", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText("PHOTO", 256, 272);
  return c.toDataURL("image/png");
}

type Drift = { font: string; sample: string; table: number; canvas: number; delta: number };

/** How far the table is from what the browser actually paints, kerning off. */
async function measureDrift(): Promise<Drift[]> {
  const samples = [
    "CODE BREW BOGOTÁ",
    "BUILDERS NIGHT",
    "AVATAR To Wave",
    "· WHAT'S BREWING?",
    "REGISTER FOR THIS EVENT",
    "luma.com/ai-first-founders",
  ];
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  ctx.fontKerning = "none";
  ctx.letterSpacing = "0px";

  const out: Drift[] = [];
  for (const { spec } of TEMPLATES) {
    const { heading, body } = validateFontPair(spec.fonts.heading, spec.fonts.body);
    await loadGoogleFontPair(heading, body);
    const m = await TableMeasurer.forFamilies([heading, body]);
    for (const [family, weight, size] of [
      [heading, 900, 88],
      [body, 700, 22],
      [body, 400, 18],
    ] as const) {
      const w = m.resolveWeight(family, weight);
      for (const sample of samples) {
        ctx.font = `${w} ${size}px "${family}"`;
        const canvasW = ctx.measureText(sample).width;
        const tableW = m.width(sample, { family, weight: w, size });
        out.push({
          font: `${family} ${w} ${size}px`,
          sample,
          table: tableW,
          canvas: canvasW,
          delta: tableW - canvasW,
        });
      }
    }
  }
  return out;
}

type Pair = { slug: string; before: string; after: string; heading: string; body: string };

function ParityPage() {
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [drift, setDrift] = useState<Drift[]>([]);
  const [status, setStatus] = useState("rendering…");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const photo = makePhoto();
      const out: Pair[] = [];
      for (const { slug, spec } of TEMPLATES) {
        const inputs = {
          theme: THEME,
          spec,
          photoDataUrl: photo,
          firstName: "Ignacio",
          role: "Founder, GPT Chain",
        };
        const { heading, body } = validateFontPair(spec.fonts.heading, spec.fonts.body);
        // Both renderers await this too; doing it up front means neither of the
        // two can be the one that pays for a cold cache and falls back.
        await loadGoogleFontPair(heading, body);
        const before = await renderBadge(inputs);
        const after = await renderBadgeReset(inputs);
        out.push({
          slug,
          heading,
          body,
          before: before.toDataURL("image/png"),
          after: after.toDataURL("image/png"),
        });
        setPairs([...out]);
      }
      setStatus("measuring drift…");
      setDrift(await measureDrift());
      setStatus("done");
    })();
  }, []);

  const worst = drift.reduce((a, d) => Math.max(a, Math.abs(d.delta)), 0);

  return (
    // The app shell is theme-aware; this page forces its own colours so the
    // labels stay readable whichever theme is active.
    <div
      style={{
        padding: 24,
        fontFamily: "ui-sans-serif, system-ui",
        background: "#fff",
        color: "#111",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 700, color: "#111" }}>
        Badge text reset — before / after
      </h1>
      <p style={{ fontSize: 13, color: "#555", maxWidth: 720 }}>
        Left is today&apos;s renderer. Right applies the three changes needed for the canvas
        preview, the SVG export and Figma to agree: kerning off, real font weights (no faux bold)
        and text positioned on its baseline instead of its top edge. Status: <b>{status}</b>
      </p>

      {pairs.map((p) => (
        <section key={p.slug} style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 14, fontFamily: "ui-monospace, monospace", color: "#111" }}>
            {p.slug}
            <span style={{ marginLeft: 12, fontSize: 11, color: "#555" }}>
              heading {p.heading} · body {p.body}
            </span>
          </h2>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            <figure style={{ margin: 0 }}>
              <img src={p.before} alt="before" style={{ width: 320, border: "1px solid #ddd" }} />
              <figcaption style={{ fontSize: 11, color: "#666" }}>before</figcaption>
            </figure>
            <figure style={{ margin: 0 }}>
              <img src={p.after} alt="after" style={{ width: 320, border: "1px solid #ddd" }} />
              <figcaption style={{ fontSize: 11, color: "#666" }}>after (reset)</figcaption>
            </figure>
            <figure style={{ margin: 0, position: "relative", width: 320 }}>
              <img src={p.before} alt="overlay before" style={{ width: 320, display: "block" }} />
              <img
                src={p.after}
                alt="overlay after"
                style={{
                  width: 320,
                  position: "absolute",
                  inset: 0,
                  mixBlendMode: "difference",
                  filter: "invert(1)",
                }}
              />
              <figcaption style={{ fontSize: 11, color: "#666" }}>difference</figcaption>
            </figure>
          </div>
        </section>
      ))}

      {drift.length > 0 && (
        <section style={{ marginTop: 36 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>
            Table vs ctx.measureText — worst delta {worst.toFixed(2)}px
          </h2>
          <p style={{ fontSize: 12, color: "#555" }}>
            This is the number that decides whether the table can drive layout. Anything under
            ~0.5px over a full line is noise; a systematic delta means the painter and the layout
            disagree.
          </p>
          <table style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", borderSpacing: 8 }}>
            <thead>
              <tr>
                <th align="left">font</th>
                <th align="left">sample</th>
                <th align="right">table</th>
                <th align="right">canvas</th>
                <th align="right">Δ</th>
              </tr>
            </thead>
            <tbody>
              {[...drift]
                .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
                .slice(0, 24)
                .map((d, i) => (
                  <tr key={i} style={{ color: Math.abs(d.delta) > 0.5 ? "#b00" : "#333" }}>
                    <td>{d.font}</td>
                    <td>{d.sample}</td>
                    <td align="right">{d.table.toFixed(2)}</td>
                    <td align="right">{d.canvas.toFixed(2)}</td>
                    <td align="right">{d.delta.toFixed(2)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
