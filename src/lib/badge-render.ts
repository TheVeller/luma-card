// Client-side canvas badge composer. Mirrors the layout of the
// `crafter-station/code-brew-bog` Satori template, but themed per Luma event:
// accent color, header title/subtitle, cover art as the seal, and QR pointing
// to the event URL.

import QRCode from "qrcode";

export type EventTheme = {
  eventId: string;
  name: string;
  subtitle: string; // e.g. city or host
  url: string;
  coverUrl: string | null;
  accent: string; // hex
  dateLine: string; // "10 JULIO — 5:00 P.M."
};

const BADGE_WIDTH = 1080;
const BADGE_HEIGHT = 1600;
const MARGIN = 26;

const PAPER = "#e9e5d8";
const TILE = "#f2efe6";
const INK = "#17150f";
const DIM = "rgba(23, 21, 15, 0.55)";
const MUTED = "rgba(23, 21, 15, 0.4)";
const BORDER = "rgba(23, 21, 15, 0.16)";

const PHOTO = { size: 720, top: 402, left: 180 };
const SEAL = { size: 156, top: 160, left: 785 };
const QR = { size: 138, top: 1171, left: 847 };

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function drawCircleImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cx: number,
  cy: number,
  radius: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  const size = radius * 2;
  // cover fit
  const ratio = Math.max(size / img.width, size / img.height);
  const w = img.width * ratio;
  const h = img.height * ratio;
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  ctx.restore();
  // ring
  ctx.strokeStyle = INK;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
}

function drawContainImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  bg: string,
) {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  const ratio = Math.min(w / img.width, h / img.height);
  const iw = img.width * ratio;
  const ih = img.height * ratio;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

async function generateQrDataUrl(url: string, accent: string): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    width: QR.size * 2,
    margin: 2,
    color: { dark: INK, light: TILE },
  }).then((d) => d);
}

export type BadgeInputs = {
  theme: EventTheme;
  photoDataUrl: string;
  firstName: string;
  role: string;
};

function fitNameSize(name: string) {
  if (name.length > 12) return 64;
  if (name.length > 8) return 78;
  return 92;
}

export async function renderBadge(inputs: BadgeInputs): Promise<HTMLCanvasElement> {
  const { theme, photoDataUrl, firstName, role } = inputs;
  const canvas = document.createElement("canvas");
  canvas.width = BADGE_WIDTH;
  canvas.height = BADGE_HEIGHT;
  const ctx = canvas.getContext("2d")!;

  // Paper background
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, BADGE_WIDTH, BADGE_HEIGHT);

  // Outer stamp frame (accent)
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 3;
  ctx.strokeRect(MARGIN, MARGIN, BADGE_WIDTH - MARGIN * 2, BADGE_HEIGHT - MARGIN * 2);
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(MARGIN + 10, MARGIN + 10, BADGE_WIDTH - (MARGIN + 10) * 2, BADGE_HEIGHT - (MARGIN + 10) * 2);

  // Kicker
  ctx.fillStyle = theme.accent;
  ctx.font = "700 20px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "top";
  ctx.fillText("· WHAT'S BREWING?".toUpperCase(), 72, 72);

  // Event name headline (wrap if long)
  ctx.fillStyle = INK;
  const headlineSize = theme.name.length > 18 ? 72 : theme.name.length > 12 ? 88 : 104;
  ctx.font = `900 ${headlineSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  const nameUpper = theme.name.toUpperCase();
  // Simple two-line wrap
  const words = nameUpper.split(" ");
  const lines: string[] = [];
  let current = "";
  const maxLineWidth = BADGE_WIDTH - 140;
  ctx.font = `900 ${headlineSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  for (const w of words) {
    const test = current ? current + " " + w : w;
    if (ctx.measureText(test).width > maxLineWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
    if (lines.length >= 1) break; // 2 lines max
  }
  if (current) lines.push(current);
  const remainingWords = words.slice(lines.join(" ").split(" ").length);
  if (remainingWords.length) lines.push(remainingWords.join(" "));
  lines.slice(0, 2).forEach((line, i) => {
    ctx.fillText(line, 66, 100 + i * (headlineSize + 8));
  });

  // Subtitle
  ctx.fillStyle = theme.accent;
  ctx.font = "900 58px ui-sans-serif, system-ui, -apple-system, sans-serif";
  ctx.fillText(theme.subtitle.toUpperCase(), 72, 224 + (lines.length > 1 ? 60 : 0));

  // Date line
  ctx.fillStyle = DIM;
  ctx.font = "400 22px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(theme.dateLine.toUpperCase(), 74, 312 + (lines.length > 1 ? 60 : 0));

  // Seal (event cover as circle) — top right
  if (theme.coverUrl) {
    try {
      const seal = await loadImage(theme.coverUrl);
      drawCircleImage(ctx, seal, SEAL.left + SEAL.size / 2, SEAL.top + SEAL.size / 2, SEAL.size / 2);
    } catch {
      // ignore
    }
  }

  // Photo tile
  const photo = await loadImage(photoDataUrl);
  drawContainImage(ctx, photo, PHOTO.left, PHOTO.top, PHOTO.size, PHOTO.size, TILE);
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 3;
  ctx.strokeRect(PHOTO.left, PHOTO.top, PHOTO.size, PHOTO.size);

  // Blue corner brackets on photo
  const corners = [
    { x: PHOTO.left - 4, y: PHOTO.top - 4, hFlip: false, vFlip: false },
    { x: PHOTO.left + PHOTO.size - 44, y: PHOTO.top - 4, hFlip: true, vFlip: false },
    { x: PHOTO.left - 4, y: PHOTO.top + PHOTO.size - 44, hFlip: false, vFlip: true },
    { x: PHOTO.left + PHOTO.size - 44, y: PHOTO.top + PHOTO.size - 44, hFlip: true, vFlip: true },
  ];
  ctx.fillStyle = theme.accent;
  for (const c of corners) {
    // horizontal arm
    ctx.fillRect(c.x, c.y, 48, 8);
    // vertical arm
    ctx.fillRect(c.hFlip ? c.x + 40 : c.x, c.y, 8, 48);
  }

  // Caption under photo
  ctx.fillStyle = DIM;
  ctx.font = "400 18px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  const caption = `· ${theme.subtitle.toUpperCase()} ·`;
  ctx.fillText(caption, BADGE_WIDTH / 2, PHOTO.top + PHOTO.size + 20);
  ctx.textAlign = "left";

  // Name
  const nameSize = fitNameSize(firstName);
  ctx.fillStyle = INK;
  ctx.font = `900 ${nameSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
  ctx.fillText(firstName.toUpperCase(), 74, PHOTO.top + PHOTO.size + 60);

  // Role
  ctx.fillStyle = theme.accent;
  ctx.font = "700 24px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(`→ ${role.toUpperCase()}`, 76, PHOTO.top + PHOTO.size + 160);

  // Divider
  ctx.fillStyle = theme.accent;
  ctx.fillRect(74, PHOTO.top + PHOTO.size + 208, 200, 3);
  ctx.fillStyle = BORDER;
  ctx.fillRect(282, PHOTO.top + PHOTO.size + 209, BADGE_WIDTH - 282 - 74, 1);

  // QR code -> event URL
  const qrDataUrl = await generateQrDataUrl(theme.url, theme.accent);
  const qrImg = await loadImage(qrDataUrl);
  ctx.drawImage(qrImg, QR.left, QR.top, QR.size, QR.size);

  // "SCAN ME" caption next to QR
  ctx.fillStyle = INK;
  ctx.font = "700 16px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("SCAN →", 74, QR.top + 8);
  ctx.fillStyle = DIM;
  ctx.font = "400 14px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("REGISTER ON LU.MA", 74, QR.top + 40);
  ctx.fillText("SHARE THIS BADGE", 74, QR.top + 62);

  // Footer tagline
  ctx.fillStyle = MUTED;
  ctx.font = "400 18px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.fillText(`${theme.name.toLowerCase()} · powered by luma_`, BADGE_WIDTH / 2, BADGE_HEIGHT - 66);
  ctx.textAlign = "left";

  return canvas;
}

// Extract a dominant accent color from an image URL. Runs entirely in the browser.
export async function extractAccent(imageUrl: string, fallback = "#2970ef"): Promise<string> {
  try {
    const img = await loadImage(imageUrl);
    const c = document.createElement("canvas");
    const S = 64;
    c.width = S;
    c.height = S;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, S, S);
    const { data } = ctx.getImageData(0, 0, S, S);
    // Bucket into 32-step color cubes, pick the most saturated/vibrant bucket.
    const buckets = new Map<string, { r: number; g: number; b: number; n: number; score: number }>();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 200) continue;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      const light = (max + min) / 2 / 255;
      // Skip near-white / near-black
      if (light < 0.15 || light > 0.9) continue;
      if (sat < 0.25) continue;
      const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
      const b0 = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0, score: 0 };
      b0.r += r; b0.g += g; b0.b += b; b0.n += 1;
      b0.score += sat * (1 - Math.abs(light - 0.5));
      buckets.set(key, b0);
    }
    if (buckets.size === 0) return fallback;
    let best: { r: number; g: number; b: number; n: number; score: number } | null = null;
    for (const v of buckets.values()) {
      if (!best || v.score > best.score) best = v;
    }
    if (!best) return fallback;
    const rr = Math.round(best.r / best.n);
    const gg = Math.round(best.g / best.n);
    const bb = Math.round(best.b / best.n);
    return `#${[rr, gg, bb].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return fallback;
  }
}
