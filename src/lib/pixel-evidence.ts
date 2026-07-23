// Client-only: extract a small dominant/chroma-biased palette from an image URL.
// Returns up to 6 hexes ranked by chroma × coverage.

function toHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
}

async function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export type PixelEvidence = {
  dominants: string[]; // top 6, chroma-biased
  darkest: string; // for text fallback
  lightest: string; // for bg fallback
  isMonochrome: boolean;
};

export async function extractPixelEvidence(imageUrl: string): Promise<PixelEvidence | null> {
  try {
    const img = await loadImg(imageUrl);
    const S = 80;
    const c = document.createElement("canvas");
    c.width = S;
    c.height = S;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, S, S);
    const { data } = ctx.getImageData(0, 0, S, S);

    const buckets = new Map<string, { r: number; g: number; b: number; n: number; score: number; sat: number }>();
    let darkest: [number, number, number, number] = [255, 255, 255, 999];
    let lightest: [number, number, number, number] = [0, 0, 0, -1];
    let maxSat = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 200) continue;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      const light = (max + min) / 2 / 255;
      if (light < darkest[3]) darkest = [r, g, b, light];
      if (light > lightest[3]) lightest = [r, g, b, light];
      if (sat > maxSat) maxSat = sat;
      // Coarser bucket (4 bits per channel) for stability
      const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
      const rec = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0, score: 0, sat: 0 };
      rec.r += r; rec.g += g; rec.b += b; rec.n += 1; rec.sat = Math.max(rec.sat, sat);
      // score biases towards saturated mid-light bins, but still rewards volume
      rec.score += sat * (1 - Math.abs(light - 0.55)) + 0.05;
      buckets.set(key, rec);
    }

    const ranked = Array.from(buckets.values())
      .filter((v) => v.n >= 4)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((v) => toHex(Math.round(v.r / v.n), Math.round(v.g / v.n), Math.round(v.b / v.n)));

    return {
      dominants: ranked,
      darkest: toHex(darkest[0], darkest[1], darkest[2]),
      lightest: toHex(lightest[0], lightest[1], lightest[2]),
      isMonochrome: maxSat < 0.18,
    };
  } catch {
    return null;
  }
}
