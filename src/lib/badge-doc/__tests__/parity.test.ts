// G1 — the parity gate.
//
// Runs the frozen renderer and the BadgeDoc engine over the same fixtures and
// requires them to draw the same thing. Headless: both go through FakeCtx and
// measure off the same tables, so the comparison is deterministic and needs no
// browser.

import { beforeAll, describe, expect, test } from "bun:test";
import { fakeImage, installBrowserStubs, type TraceEntry } from "./fake-canvas";

const PHOTO = "data:image/png;base64,PHOTO";
const COVER = "https://images.lumacdn.com/cover.png";

installBrowserStubs({
  [PHOTO]: fakeImage("photo", 512, 512),
  [COVER]: fakeImage("cover", 800, 400),
});

// Imported after the stubs exist — the renderer touches document at module scope.
const { renderFrozenBadge } = await import("./frozen-renderer");
const { renderToCanvasTrace } = await import("./render-through-engine");
const { normalizeStyleSpec } = await import("@/lib/style-spec");

const SPECS = {
  warm: normalizeStyleSpec({
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
  mono: normalizeStyleSpec({
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
  dark: normalizeStyleSpec({
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
};

const EVENT_NAMES = [
  "Hackathon",
  "Code Brew Bogotá — Builders Night",
  "Reunión de fundadores en Arequipa con café",
  "Supercalifragilisticexpialidociousmegaeventwithnospacesatallhere",
];
const FIRST_NAMES = ["Ana", "Maximiliano", "Ignacio Alberto Velásquez"];
const ROLES = ["", "Founder, GPT Chain", "Head of Builders & Community Programs at Sundai Latam"];
const URLS = ["https://luma.com/x", `https://luma.com/${"a-very-long-slug".repeat(6)}`];

type Fixture = {
  label: string;
  spec: (typeof SPECS)[keyof typeof SPECS];
  name: string;
  firstName: string;
  role: string;
  url: string;
  cover: string | null;
};

function fixtures(): Fixture[] {
  const out: Fixture[] = [];
  for (const [specName, spec] of Object.entries(SPECS)) {
    for (const name of EVENT_NAMES) {
      for (const firstName of FIRST_NAMES) {
        for (const role of ROLES) {
          for (const url of URLS) {
            for (const cover of [COVER, null]) {
              out.push({
                label: `${specName} · "${name.slice(0, 18)}" · ${firstName.slice(0, 10)} · role:${role.length} · url:${url.length} · cover:${cover ? "y" : "n"}`,
                spec,
                name,
                firstName,
                role,
                url,
                cover,
              });
            }
          }
        }
      }
    }
  }
  return out;
}

function inputsFor(f: Fixture) {
  return {
    theme: {
      eventId: "fixture",
      name: f.name,
      subtitle: "BOGOTÁ",
      url: f.url,
      coverUrl: f.cover,
      dateLine: "SEPTEMBER 12 — 7:00 PM",
    },
    spec: f.spec,
    photoDataUrl: PHOTO,
    firstName: f.firstName,
    role: f.role,
  };
}

/** "#e33d3d" and "rgba(227,61,61,1)" are the same paint; compare the colour, not the spelling. */
function normalizeColor(v: string | undefined): string | undefined {
  if (!v) return v;
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},1`;
  }
  const rgba = /^rgba?\(([^)]+)\)$/.exec(v);
  if (rgba) {
    const parts = rgba[1].split(",").map((p) => p.trim());
    if (parts.length === 3) parts.push("1");
    return parts.join(",");
  }
  return v;
}

/** Drawing calls only; property assignments do not affect the image. */
function significant(trace: TraceEntry[]): TraceEntry[] {
  return trace
    .filter((t) => t.op !== "rect" && t.op !== "arc" && t.op !== "ellipse")
    .map((t) => ({ ...t, fill: normalizeColor(t.fill), stroke: normalizeColor(t.stroke) }));
}

function describeDiff(a: TraceEntry[], b: TraceEntry[]): string {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = JSON.stringify(a[i] ?? null);
    const y = JSON.stringify(b[i] ?? null);
    if (x !== y) return `op #${i}\n  legacy: ${x}\n  engine: ${y}`;
  }
  return "identical";
}

const ALL = fixtures();

describe("classic doc reproduces the frozen renderer", () => {
  beforeAll(() => {
    expect(ALL.length).toBeGreaterThan(150);
  });

  test("fixture matrix covers the intended combinations", () => {
    expect(ALL.length).toBe(
      Object.keys(SPECS).length *
        EVENT_NAMES.length *
        FIRST_NAMES.length *
        ROLES.length *
        URLS.length *
        2,
    );
  });

  for (const f of ALL.slice(0, 12)) {
    test(`trace matches — ${f.label}`, async () => {
      const legacy = significant(await traceLegacy(f));
      const engine = significant(await traceEngine(f));
      expect(describeDiff(legacy, engine)).toBe("identical");
    });
  }

  // Renders the whole matrix twice over; the default 5s is not enough.
  test("full matrix matches", async () => {
    const failures: string[] = [];
    for (const f of ALL) {
      const legacy = significant(await traceLegacy(f));
      const engine = significant(await traceEngine(f));
      const diff = describeDiff(legacy, engine);
      if (diff !== "identical") failures.push(`${f.label}\n${diff}`);
    }
    expect(failures.slice(0, 3).join("\n---\n")).toBe("");
    expect(failures.length).toBe(0);
  }, 120_000);
});

async function traceLegacy(f: Fixture): Promise<TraceEntry[]> {
  const canvas = (await renderFrozenBadge(inputsFor(f))) as unknown as {
    getContext: () => { trace: TraceEntry[] };
  };
  return canvas.getContext().trace;
}

async function traceEngine(f: Fixture): Promise<TraceEntry[]> {
  return renderToCanvasTrace(inputsFor(f));
}
