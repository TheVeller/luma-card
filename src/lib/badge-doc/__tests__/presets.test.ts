// The parity gate only protects the classic layout — it compares against the
// frozen renderer, and that renderer only ever drew one composition. New
// layouts need their own net: for every extreme input, nothing may escape the
// canvas and nothing may sit on top of anything else.

import { describe, expect, test } from "bun:test";
import { fakeImage, installBrowserStubs } from "./fake-canvas";

const PHOTO = "data:photo";
const COVER = "https://images.lumacdn.com/cover.png";
const LOGO = "data:logo";

installBrowserStubs({
  [PHOTO]: fakeImage("photo", 512, 512),
  [COVER]: fakeImage("cover", 800, 400),
  [LOGO]: fakeImage("logo", 300, 100),
});

const { layout, findOverlaps } = await import("../layout/engine");
const { TableMeasurer } = await import("../layout/measure");
const { bindingsFrom } = await import("../tokens");
const { validateDoc } = await import("../patch");
const { LAYOUT_PRESETS } = await import("../presets");
const { normalizeStyleSpec } = await import("@/lib/style-spec");

const SPEC = normalizeStyleSpec({
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
});

/** The inputs that broke things before: unbreakable words, accents, empties. */
const CASES = [
  {
    label: "short",
    name: "Hackathon",
    firstName: "Ana",
    role: "",
    url: "https://luma.com/x",
    logos: 0,
  },
  {
    label: "long word",
    name: "Supercalifragilisticexpialidociousmegaeventwithnospacesatallhere",
    firstName: "Maximiliano",
    role: "Head of Builders & Community Programs at Sundai Latam",
    url: `https://luma.com/${"a-very-long-slug".repeat(6)}`,
    logos: 6,
  },
  {
    label: "accents",
    name: "Reunión de fundadores en Arequipa con café",
    firstName: "Ignacio Alberto Velásquez",
    role: "Founder, GPT Chain",
    url: "https://luma.com/ai-first-founders",
    logos: 3,
  },
];

async function measurer() {
  return TableMeasurer.forFamilies([SPEC.fonts.heading, SPEC.fonts.body]);
}

function bindingsFor(c: (typeof CASES)[number]) {
  const logos = Array.from({ length: c.logos }, () => LOGO);
  const assets = {
    [PHOTO]: { source: {}, width: 512, height: 512 },
    [COVER]: { source: {}, width: 800, height: 400 },
    [LOGO]: { source: {}, width: 300, height: 100 },
  };
  return bindingsFrom(
    SPEC,
    {
      name: c.name,
      subtitle: "BOGOTÁ",
      dateLine: "SEPTEMBER 12 — 7:00 PM",
      url: c.url,
      coverUrl: COVER,
    },
    { firstName: c.firstName, role: c.role, photo: PHOTO, logos, sealLogo: null },
    assets,
    {},
  );
}

describe("every layout preset", () => {
  for (const preset of LAYOUT_PRESETS) {
    test(`${preset.id} is a valid document`, () => {
      expect(validateDoc(preset.doc)).toEqual([]);
    });

    for (const c of CASES) {
      test(`${preset.id} stays inside the canvas — ${c.label}`, async () => {
        const { ops } = layout(preset.doc, {
          bindings: bindingsFor(c),
          measurer: await measurer(),
        });
        const { width, height } = preset.doc.canvas;
        const escaped: string[] = [];
        for (const op of ops) {
          if (!("rect" in op)) continue;
          const { x, y, w, h } = op.rect;
          if (x < -1 || y < -1 || x + w > width + 1 || y + h > height + 1) escaped.push(op.id);
        }
        expect(escaped).toEqual([]);
      });

      test(`${preset.id} draws no text off the canvas — ${c.label}`, async () => {
        const { ops } = layout(preset.doc, {
          bindings: bindingsFor(c),
          measurer: await measurer(),
        });
        const { width, height } = preset.doc.canvas;
        const bad: string[] = [];
        for (const op of ops) {
          if (op.k !== "text") continue;
          for (const line of op.lines) {
            if (line.x < -1 || line.x + line.width > width + 1 || line.baselineY > height + 1) {
              bad.push(`${op.id}:"${line.text.slice(0, 14)}"`);
            }
          }
        }
        expect(bad).toEqual([]);
      });
    }

    test(`${preset.id} has no overlapping boxes`, async () => {
      const { ops } = layout(preset.doc, {
        bindings: bindingsFor(CASES[1]),
        measurer: await measurer(),
      });
      // Frames and decorative plates are meant to sit under things.
      const decorative = /^(frame-|corner-|qr-plate|rule|divider)/;
      const hits = findOverlaps(ops).filter(
        ([a, b]) =>
          !decorative.test(a) && !decorative.test(b) && !a.endsWith("-bg") && !b.endsWith("-bg"),
      );
      expect(hits).toEqual([]);
    });
  }

  test("sponsor slots appear only for the logos that exist", async () => {
    const poster = LAYOUT_PRESETS.find((p) => p.id === "poster")!;
    const m = await measurer();
    const withThree = layout(poster.doc, { bindings: bindingsFor(CASES[2]), measurer: m }).ops;
    const withNone = layout(poster.doc, { bindings: bindingsFor(CASES[0]), measurer: m }).ops;
    const count = (ops: typeof withThree) =>
      ops.filter((o) => "id" in o && o.id.startsWith("logo-")).length;
    expect(count(withThree)).toBe(3);
    expect(count(withNone)).toBe(0);
  });
});
