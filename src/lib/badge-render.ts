// Client-side canvas badge composer.
// Themed per event via a StyleSpec (palette + Google Fonts) plus an optional
// AI-generated hero background image.

import QRCode from "qrcode";
import type { StyleSpec } from "./style-spec";

export type EventTheme = {
  eventId: string;
  name: string;
  subtitle: string;
  url: string;
  coverUrl: string | null;
  dateLine: string;
};

const BADGE_WIDTH = 1080;
const BADGE_HEIGHT = 1600;
const MARGIN = 26;

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

function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(0,0,0,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function drawCircleImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cx: number,
  cy: number,
  radius: number,
  ringColor: string,
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  const size = radius * 2;
  const ratio = Math.max(size / img.width, size / img.height);
  const w = img.width * ratio;
  const h = img.height * ratio;
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  ctx.restore();
  ctx.strokeStyle = ringColor;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const ratio = Math.max(w / img.width, h / img.height);
  const iw = img.width * ratio;
  const ih = img.height * ratio;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  ctx.restore();
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

async function generateQrDataUrl(url: string, spec: StyleSpec): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    width: QR.size * 2,
    margin: 2,
    color: { dark: spec.palette.text, light: spec.palette.surface },
  });
}

export type BadgeInputs = {
  theme: EventTheme;
  spec: StyleSpec;
  heroDataUrl: string | null; // AI-generated hero background (optional)
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
  const { theme, spec, heroDataUrl, photoDataUrl, firstName, role } = inputs;
  const canvas = document.createElement("canvas");
  canvas.width = BADGE_WIDTH;
  canvas.height = BADGE_HEIGHT;
  const ctx = canvas.getContext("2d")!;

  const P = spec.palette;
  const HEAD_FONT = `"${spec.fonts.heading}", ui-sans-serif, system-ui, sans-serif`;
  const BODY_FONT = `"${spec.fonts.body}", ui-sans-serif, system-ui, sans-serif`;
  const MONO_FONT = `ui-monospace, SFMono-Regular, Menlo, monospace`;

  // Paper background
  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, BADGE_WIDTH, BADGE_HEIGHT);

  // Hero art band across the top — behind everything, but only inside the frame.
  if (heroDataUrl) {
    try {
      const hero = await loadImage(heroDataUrl);
      // Draw hero across full width in the header band; keep bottom half clean paper.
      drawCoverImage(ctx, hero, MARGIN + 12, MARGIN + 12, BADGE_WIDTH - (MARGIN + 12) * 2, 360);
      // Soft fade to paper at the bottom of the band so text stays readable.
      const grad = ctx.createLinearGradient(0, MARGIN + 12, 0, MARGIN + 12 + 360);
      grad.addColorStop(0, withAlpha(P.bg, 0));
      grad.addColorStop(1, withAlpha(P.bg, 0.92));
      ctx.fillStyle = grad;
      ctx.fillRect(MARGIN + 12, MARGIN + 12, BADGE_WIDTH - (MARGIN + 12) * 2, 360);
    } catch {
      // ignore hero errors
    }
  }

  // Outer stamp frame (accent)
  ctx.strokeStyle = P.accent;
  ctx.lineWidth = 3;
  ctx.strokeRect(MARGIN, MARGIN, BADGE_WIDTH - MARGIN * 2, BADGE_HEIGHT - MARGIN * 2);
  ctx.strokeStyle = withAlpha(P.text, 0.16);
  ctx.lineWidth = 1;
  ctx.strokeRect(MARGIN + 10, MARGIN + 10, BADGE_WIDTH - (MARGIN + 10) * 2, BADGE_HEIGHT - (MARGIN + 10) * 2);

  // Kicker
  ctx.fillStyle = P.accent;
  ctx.font = `700 20px ${MONO_FONT}`;
  ctx.textBaseline = "top";
  ctx.fillText("· WHAT'S BREWING?", 72, 72);

  // Event headline (2 lines max)
  ctx.fillStyle = P.text;
  const headlineSize = theme.name.length > 18 ? 72 : theme.name.length > 12 ? 88 : 104;
  ctx.font = `900 ${headlineSize}px ${HEAD_FONT}`;
  const nameUpper = theme.name.toUpperCase();
  const words = nameUpper.split(" ");
  const lines: string[] = [];
  let current = "";
  const maxLineWidth = BADGE_WIDTH - 140;
  for (const w of words) {
    const test = current ? current + " " + w : w;
    if (ctx.measureText(test).width > maxLineWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
    if (lines.length >= 2) break;
  }
  if (current && lines.length < 2) lines.push(current);
  lines.slice(0, 2).forEach((line, i) => {
    ctx.fillText(line, 66, 100 + i * (headlineSize + 8));
  });

  const subtitleY = 224 + (lines.length > 1 ? 60 : 0);
  ctx.fillStyle = P.accent;
  ctx.font = `900 58px ${HEAD_FONT}`;
  ctx.fillText(theme.subtitle.toUpperCase(), 72, subtitleY);

  ctx.fillStyle = withAlpha(P.text, 0.55);
  ctx.font = `400 22px ${MONO_FONT}`;
  ctx.fillText(theme.dateLine.toUpperCase(), 74, subtitleY + 88);

  // Seal (event cover as circle) — top right
  if (theme.coverUrl) {
    try {
      const seal = await loadImage(theme.coverUrl);
      drawCircleImage(ctx, seal, SEAL.left + SEAL.size / 2, SEAL.top + SEAL.size / 2, SEAL.size / 2, P.text);
    } catch {
      // ignore
    }
  }

  // Photo tile
  const photo = await loadImage(photoDataUrl);
  drawContainImage(ctx, photo, PHOTO.left, PHOTO.top, PHOTO.size, PHOTO.size, P.surface);
  ctx.strokeStyle = P.accent;
  ctx.lineWidth = 3;
  ctx.strokeRect(PHOTO.left, PHOTO.top, PHOTO.size, PHOTO.size);

  const corners = [
    { x: PHOTO.left - 4, y: PHOTO.top - 4, hFlip: false },
    { x: PHOTO.left + PHOTO.size - 44, y: PHOTO.top - 4, hFlip: true },
    { x: PHOTO.left - 4, y: PHOTO.top + PHOTO.size - 44, hFlip: false },
    { x: PHOTO.left + PHOTO.size - 44, y: PHOTO.top + PHOTO.size - 44, hFlip: true },
  ];
  ctx.fillStyle = P.accent;
  for (const c of corners) {
    ctx.fillRect(c.x, c.y, 48, 8);
    ctx.fillRect(c.hFlip ? c.x + 40 : c.x, c.y, 8, 48);
  }

  // Caption under photo
  ctx.fillStyle = withAlpha(P.text, 0.55);
  ctx.font = `400 18px ${MONO_FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(`· ${theme.subtitle.toUpperCase()} ·`, BADGE_WIDTH / 2, PHOTO.top + PHOTO.size + 20);
  ctx.textAlign = "left";

  // Name
  const nameSize = fitNameSize(firstName);
  ctx.fillStyle = P.text;
  ctx.font = `900 ${nameSize}px ${HEAD_FONT}`;
  ctx.fillText(firstName.toUpperCase(), 74, PHOTO.top + PHOTO.size + 60);

  // Role
  ctx.fillStyle = P.accent;
  ctx.font = `700 24px ${MONO_FONT}`;
  ctx.fillText(`→ ${role.toUpperCase()}`, 76, PHOTO.top + PHOTO.size + 160);

  // Divider
  ctx.fillStyle = P.accent;
  ctx.fillRect(74, PHOTO.top + PHOTO.size + 208, 200, 3);
  ctx.fillStyle = withAlpha(P.text, 0.16);
  ctx.fillRect(282, PHOTO.top + PHOTO.size + 209, BADGE_WIDTH - 282 - 74, 1);

  // QR
  const qrDataUrl = await generateQrDataUrl(theme.url, spec);
  const qrImg = await loadImage(qrDataUrl);
  ctx.drawImage(qrImg, QR.left, QR.top, QR.size, QR.size);

  ctx.fillStyle = P.text;
  ctx.font = `700 16px ${MONO_FONT}`;
  ctx.fillText("SCAN →", 74, QR.top + 8);
  ctx.fillStyle = withAlpha(P.text, 0.55);
  ctx.font = `400 14px ${MONO_FONT}`;
  ctx.fillText("REGISTER ON LU.MA", 74, QR.top + 40);
  ctx.fillText("SHARE THIS BADGE", 74, QR.top + 62);

  // Footer
  ctx.fillStyle = withAlpha(P.text, 0.4);
  ctx.font = `400 18px ${MONO_FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(`${theme.name.toLowerCase()} · powered by luma_`, BADGE_WIDTH / 2, BADGE_HEIGHT - 66);
  ctx.textAlign = "left";

  return canvas;
}

// Legacy pixel-based accent extractor (used as fallback when AI hasn't answered yet).
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
    const buckets = new Map<string, { r: number; g: number; b: number; n: number; score: number }>();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 200) continue;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      const light = (max + min) / 2 / 255;
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
    for (const v of buckets.values()) if (!best || v.score > best.score) best = v;
    if (!best) return fallback;
    const rr = Math.round(best.r / best.n);
    const gg = Math.round(best.g / best.n);
    const bb = Math.round(best.b / best.n);
    return `#${[rr, gg, bb].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return fallback;
  }
}
