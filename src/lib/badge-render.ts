// Client-side canvas badge composer.
// Themed per event via a StyleSpec (palette + Google Fonts) plus an optional
// AI-generated hero background image.
//
// Layout is dynamic: content is stacked in vertical bands with computed Y
// positions so nothing overlaps regardless of name length or headline size.

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

const W = 1080;
const H = 1600;
const MARGIN = 26;
const PAD = 66; // inner content x

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

async function generateQrDataUrl(url: string, spec: StyleSpec, size: number): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    width: size * 2,
    margin: 2,
    color: { dark: spec.palette.text, light: spec.palette.surface },
  });
}

// Fit a single-line string within maxWidth by shrinking font size.
function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: string,
  family: string,
  startSize: number,
  minSize: number,
  maxWidth: number,
): number {
  let size = startSize;
  while (size > minSize) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 2;
  }
  ctx.font = `${weight} ${minSize}px ${family}`;
  return minSize;
}

// Wrap text into up to maxLines using the given font. Returns lines and used size.
function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: string,
  family: string,
  startSize: number,
  minSize: number,
  maxWidth: number,
  maxLines: number,
): { lines: string[]; size: number } {
  for (let size = startSize; size >= minSize; size -= 4) {
    ctx.font = `${weight} ${size}px ${family}`;
    const words = text.split(" ");
    const lines: string[] = [];
    let current = "";
    for (const w of words) {
      const test = current ? current + " " + w : w;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = w;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    if (lines.length <= maxLines) return { lines, size };
  }
  ctx.font = `${weight} ${minSize}px ${family}`;
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const test = current ? current + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return { lines: lines.slice(0, maxLines), size: minSize };
}

function displayUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/\/$/, "");
    return `${u.hostname}${path}`.toUpperCase();
  } catch {
    return raw.toUpperCase();
  }
}

export type BadgeInputs = {
  theme: EventTheme;
  spec: StyleSpec;
  heroDataUrl: string | null;
  photoDataUrl: string;
  firstName: string;
  role: string;
};

export async function renderBadge(inputs: BadgeInputs): Promise<HTMLCanvasElement> {
  const { theme, spec, heroDataUrl, photoDataUrl, firstName, role } = inputs;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const P = spec.palette;
  const HEAD = `"${spec.fonts.heading}", ui-sans-serif, system-ui, sans-serif`;
  const BODY = `"${spec.fonts.body}", ui-sans-serif, system-ui, sans-serif`;
  const MONO = `ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textBaseline = "top";

  // ---------- Paper + frame ----------
  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, W, H);

  // ---------- Vertical band budget ----------
  // Bands (top → bottom):
  //   header:  MARGIN+40 → 380
  //   photo:   400 → 1100  (700x700 centered)
  //   name:    1120 → 1240
  //   role:    1250 → 1290
  //   scan/qr: 1330 → 1500
  //   footer:  1540 → 1580

  const HEADER_TOP = MARGIN + 44;
  const HEADER_BOTTOM = 380;
  const PHOTO_TOP = 400;
  const PHOTO_SIZE = 700;
  const PHOTO_LEFT = (W - PHOTO_SIZE) / 2;
  const PHOTO_BOTTOM = PHOTO_TOP + PHOTO_SIZE; // 1100
  const NAME_TOP = PHOTO_BOTTOM + 44;          // 1144 → moved down after caption
  const CAPTION_Y = PHOTO_BOTTOM + 18;
  const ROLE_ROW_Y = NAME_TOP + 100;           // moves with name band
  const DIVIDER_Y = ROLE_ROW_Y + 44;           // ~1288
  const FOOTER_TOP = 1330;
  const FOOTER_BOTTOM = H - 60;

  // ---------- Hero band (behind header) ----------
  if (heroDataUrl) {
    try {
      const hero = await loadImage(heroDataUrl);
      const bx = MARGIN + 12;
      const by = MARGIN + 12;
      const bw = W - (MARGIN + 12) * 2;
      const bh = HEADER_BOTTOM - by - 20;
      drawCoverImage(ctx, hero, bx, by, bw, bh);
      const grad = ctx.createLinearGradient(0, by, 0, by + bh);
      grad.addColorStop(0, withAlpha(P.bg, 0));
      grad.addColorStop(1, withAlpha(P.bg, 0.94));
      ctx.fillStyle = grad;
      ctx.fillRect(bx, by, bw, bh);
    } catch {}
  }

  // ---------- Frame ----------
  ctx.strokeStyle = P.accent;
  ctx.lineWidth = 3;
  ctx.strokeRect(MARGIN, MARGIN, W - MARGIN * 2, H - MARGIN * 2);
  ctx.strokeStyle = withAlpha(P.text, 0.16);
  ctx.lineWidth = 1;
  ctx.strokeRect(MARGIN + 10, MARGIN + 10, W - (MARGIN + 10) * 2, H - (MARGIN + 10) * 2);

  // ---------- Header ----------
  const headerRightReserve = 200; // seal
  const headerMaxWidth = W - PAD - headerRightReserve;

  // Kicker
  ctx.fillStyle = P.accent;
  ctx.font = `700 20px ${MONO}`;
  ctx.fillText("· WHAT'S BREWING?", PAD, HEADER_TOP);

  // Headline (up to 2 lines, auto-fit)
  const nameUpper = theme.name.toUpperCase();
  const { lines: headLines, size: headSize } = wrapLines(
    ctx, nameUpper, "900", HEAD, 96, 52, headerMaxWidth, 2,
  );
  ctx.fillStyle = P.text;
  ctx.font = `900 ${headSize}px ${HEAD}`;
  let y = HEADER_TOP + 34;
  for (const line of headLines) {
    ctx.fillText(line, PAD, y);
    y += headSize + 6;
  }

  // Subtitle (city)
  const subMaxW = W - PAD * 2;
  const subSize = fitFont(ctx, theme.subtitle.toUpperCase(), "900", HEAD, 56, 34, subMaxW);
  ctx.fillStyle = P.accent;
  ctx.font = `900 ${subSize}px ${HEAD}`;
  y += 6;
  ctx.fillText(theme.subtitle.toUpperCase(), PAD, y);
  y += subSize + 10;

  // Date line
  ctx.fillStyle = withAlpha(P.text, 0.6);
  ctx.font = `400 22px ${MONO}`;
  ctx.fillText(theme.dateLine, PAD, Math.min(y, HEADER_BOTTOM - 32));

  // Seal (cover as circle) top-right
  if (theme.coverUrl) {
    try {
      const seal = await loadImage(theme.coverUrl);
      const sealSize = 148;
      drawCircleImage(
        ctx, seal,
        W - MARGIN - 36 - sealSize / 2,
        HEADER_TOP + sealSize / 2 - 8,
        sealSize / 2, P.text,
      );
    } catch {}
  }

  // ---------- Photo ----------
  const photo = await loadImage(photoDataUrl);
  drawContainImage(ctx, photo, PHOTO_LEFT, PHOTO_TOP, PHOTO_SIZE, PHOTO_SIZE, P.surface);
  ctx.strokeStyle = P.accent;
  ctx.lineWidth = 3;
  ctx.strokeRect(PHOTO_LEFT, PHOTO_TOP, PHOTO_SIZE, PHOTO_SIZE);
  const cornerLen = 44;
  const cornerThick = 8;
  const corners = [
    { x: PHOTO_LEFT - 4, y: PHOTO_TOP - 4, hFlip: false, vFlip: false },
    { x: PHOTO_LEFT + PHOTO_SIZE - cornerLen + 4, y: PHOTO_TOP - 4, hFlip: true, vFlip: false },
    { x: PHOTO_LEFT - 4, y: PHOTO_TOP + PHOTO_SIZE - cornerLen + 4, hFlip: false, vFlip: true },
    { x: PHOTO_LEFT + PHOTO_SIZE - cornerLen + 4, y: PHOTO_TOP + PHOTO_SIZE - cornerLen + 4, hFlip: true, vFlip: true },
  ];
  ctx.fillStyle = P.accent;
  for (const c of corners) {
    ctx.fillRect(c.x, c.y, cornerLen, cornerThick);
    ctx.fillRect(c.hFlip ? c.x + cornerLen - cornerThick : c.x, c.y, cornerThick, cornerLen);
  }

  // Caption under photo (centered)
  ctx.fillStyle = withAlpha(P.text, 0.55);
  ctx.font = `400 18px ${MONO}`;
  ctx.textAlign = "center";
  ctx.fillText(`· ${theme.subtitle.toUpperCase()} ·`, W / 2, CAPTION_Y);
  ctx.textAlign = "left";

  // ---------- Name band (dynamic size to fit width) ----------
  const nameStr = firstName.toUpperCase();
  const nameMaxW = W - PAD * 2;
  const nameSize = fitFont(ctx, nameStr, "900", HEAD, 110, 44, nameMaxW);
  ctx.fillStyle = P.text;
  ctx.font = `900 ${nameSize}px ${HEAD}`;
  ctx.fillText(nameStr, PAD, NAME_TOP);

  // ---------- Role row ----------
  const roleStr = `→ ${role.toUpperCase()}`;
  const roleSize = fitFont(ctx, roleStr, "700", MONO, 26, 16, nameMaxW);
  ctx.fillStyle = P.accent;
  ctx.font = `700 ${roleSize}px ${MONO}`;
  ctx.fillText(roleStr, PAD, ROLE_ROW_Y);

  // Divider
  ctx.fillStyle = P.accent;
  ctx.fillRect(PAD, DIVIDER_Y, 200, 3);
  ctx.fillStyle = withAlpha(P.text, 0.16);
  ctx.fillRect(PAD + 208, DIVIDER_Y + 1, W - (PAD + 208) - PAD, 1);

  // ---------- Scan / QR band ----------
  const QR_SIZE = 156;
  const QR_X = W - MARGIN - 40 - QR_SIZE;
  const QR_Y = FOOTER_TOP;
  const scanTextX = PAD;
  const scanTextMaxW = QR_X - PAD - 24;

  ctx.fillStyle = P.text;
  ctx.font = `700 16px ${MONO}`;
  ctx.fillText("SCAN →", scanTextX, QR_Y + 4);

  ctx.fillStyle = withAlpha(P.text, 0.55);
  ctx.font = `400 14px ${MONO}`;
  ctx.fillText("REGISTER FOR THIS EVENT", scanTextX, QR_Y + 30);

  // Real URL, fit to width, wrap 2 lines if needed
  const urlText = displayUrl(theme.url);
  const { lines: urlLines, size: urlSize } = wrapLines(
    ctx, urlText, "700", MONO, 20, 12, scanTextMaxW, 2,
  );
  ctx.fillStyle = P.text;
  ctx.font = `700 ${urlSize}px ${MONO}`;
  let uy = QR_Y + 62;
  for (const line of urlLines) {
    ctx.fillText(line, scanTextX, uy);
    uy += urlSize + 4;
  }

  // QR
  const qrDataUrl = await generateQrDataUrl(theme.url, spec, QR_SIZE);
  const qrImg = await loadImage(qrDataUrl);
  // subtle plate behind QR
  ctx.fillStyle = P.surface;
  ctx.fillRect(QR_X - 8, QR_Y - 8, QR_SIZE + 16, QR_SIZE + 16);
  ctx.strokeStyle = withAlpha(P.text, 0.2);
  ctx.lineWidth = 1;
  ctx.strokeRect(QR_X - 8, QR_Y - 8, QR_SIZE + 16, QR_SIZE + 16);
  ctx.drawImage(qrImg, QR_X, QR_Y, QR_SIZE, QR_SIZE);

  // ---------- Footer ----------
  const footerText = `${theme.name.toLowerCase()} · powered by luma_`;
  ctx.fillStyle = withAlpha(P.text, 0.4);
  const footerSize = fitFont(ctx, footerText, "400", MONO, 18, 12, W - PAD * 2);
  ctx.font = `400 ${footerSize}px ${MONO}`;
  ctx.textAlign = "center";
  ctx.fillText(footerText, W / 2, FOOTER_BOTTOM);
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
