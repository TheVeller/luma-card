// Client-side canvas badge composer.
// Themed per event via a StyleSpec (palette + Google Fonts).
//
// Layout is dynamic: content is stacked in vertical bands with computed Y
// positions so nothing overlaps regardless of name length or headline size.

import QRCode from "qrcode";
import { effectiveAccent, isMonoPalette, type StyleSpec } from "./style-spec";

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
const PAD = 66;

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
  ctx.lineWidth = 5;
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

async function generateQrDataUrl(url: string, spec: StyleSpec, size: number): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    width: size * 2,
    margin: 2,
    color: { dark: spec.palette.text, light: spec.palette.surface },
  });
}

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
  photoDataUrl: string;
  firstName: string;
  role: string;
  /** kept for backwards-compat with callers; ignored — hero feature is removed. */
  heroDataUrl?: string | null;
};

export async function renderBadge(inputs: BadgeInputs): Promise<HTMLCanvasElement> {
  const { theme, spec, photoDataUrl, firstName, role } = inputs;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const P = spec.palette;
  const HEAD = `"${spec.fonts.heading}", ui-sans-serif, system-ui, sans-serif`;
  const MONO = `"${spec.fonts.body}", ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textBaseline = "top";

  const ACCENT = effectiveAccent(spec);
  const mono = isMonoPalette(spec);

  // ---------- Paper ----------
  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, W, H);

  // ---------- Frame ----------
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 3;
  ctx.strokeRect(MARGIN, MARGIN, W - MARGIN * 2, H - MARGIN * 2);
  ctx.strokeStyle = withAlpha(P.text, mono ? 0.28 : 0.16);
  ctx.lineWidth = 1;
  ctx.strokeRect(MARGIN + 10, MARGIN + 10, W - (MARGIN + 10) * 2, H - (MARGIN + 10) * 2);

  // ---------- Header vertical bands ----------
  const HEADER_TOP = MARGIN + 44;
  const headerRightReserve = 200;
  const headerMaxWidth = W - PAD - headerRightReserve;

  // Kicker
  ctx.fillStyle = ACCENT;
  ctx.font = `700 20px ${MONO}`;
  ctx.fillText("· WHAT'S BREWING?", PAD, HEADER_TOP);

  // Headline
  const nameUpper = theme.name.toUpperCase();
  const { lines: headLines, size: headSize } = wrapLines(
    ctx, nameUpper, "900", HEAD, 96, 48, headerMaxWidth, 2,
  );
  ctx.fillStyle = P.text;
  ctx.font = `900 ${headSize}px ${HEAD}`;
  let y = HEADER_TOP + 34;
  for (const line of headLines) {
    ctx.fillText(line, PAD, y);
    y += headSize + 6;
  }

  // Meta row: city (left) + date (right) — same baseline, mono, no collision
  y += 12;
  const metaSize = 22;
  const cityText = theme.subtitle.toUpperCase();
  const dateText = theme.dateLine;
  ctx.font = `700 ${metaSize}px ${MONO}`;
  ctx.fillStyle = ACCENT;
  ctx.fillText(cityText, PAD, y);
  const cityWidth = ctx.measureText(cityText).width;

  // Date right-aligned within the same headerMaxWidth column
  ctx.fillStyle = withAlpha(P.text, 0.7);
  ctx.font = `400 ${metaSize}px ${MONO}`;
  const dateWidth = ctx.measureText(dateText).width;
  const dateRightEdge = PAD + headerMaxWidth;
  // If city + date overlap, stack date on next line
  const canFitOnSameLine = PAD + cityWidth + 28 + dateWidth <= dateRightEdge;
  if (canFitOnSameLine) {
    ctx.fillText(dateText, dateRightEdge - dateWidth, y);
  } else {
    ctx.fillText(dateText, PAD, y + metaSize + 6);
  }

  const HEADER_BOTTOM = 380;

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
  const PHOTO_TOP = HEADER_BOTTOM + 20;
  const PHOTO_SIZE = 700;
  const PHOTO_LEFT = (W - PHOTO_SIZE) / 2;
  const PHOTO_BOTTOM = PHOTO_TOP + PHOTO_SIZE;

  const photo = await loadImage(photoDataUrl);
  drawContainImage(ctx, photo, PHOTO_LEFT, PHOTO_TOP, PHOTO_SIZE, PHOTO_SIZE, P.surface);

  ctx.strokeStyle = withAlpha(ACCENT, mono ? 0.6 : 1);
  ctx.lineWidth = 2;
  ctx.strokeRect(PHOTO_LEFT, PHOTO_TOP, PHOTO_SIZE, PHOTO_SIZE);

  // Finer corner brackets
  const cornerLen = 36;
  const cornerThick = 5;
  const corners = [
    { x: PHOTO_LEFT - 3, y: PHOTO_TOP - 3, hFlip: false },
    { x: PHOTO_LEFT + PHOTO_SIZE - cornerLen + 3, y: PHOTO_TOP - 3, hFlip: true },
    { x: PHOTO_LEFT - 3, y: PHOTO_TOP + PHOTO_SIZE - cornerLen + 3, hFlip: false },
    { x: PHOTO_LEFT + PHOTO_SIZE - cornerLen + 3, y: PHOTO_TOP + PHOTO_SIZE - cornerLen + 3, hFlip: true },
  ];
  ctx.fillStyle = ACCENT;
  for (const c of corners) {
    ctx.fillRect(c.x, c.y, cornerLen, cornerThick);
    ctx.fillRect(c.hFlip ? c.x + cornerLen - cornerThick : c.x, c.y, cornerThick, cornerLen);
  }

  // Caption under photo — real date line, centered
  const CAPTION_Y = PHOTO_BOTTOM + 22;
  ctx.fillStyle = withAlpha(P.text, 0.5);
  ctx.font = `400 18px ${MONO}`;
  ctx.textAlign = "center";
  ctx.fillText(`· ${theme.dateLine} ·`, W / 2, CAPTION_Y);
  ctx.textAlign = "left";

  // ---------- Name band ----------
  const NAME_TOP = CAPTION_Y + 46;
  const nameStr = firstName.toUpperCase();
  const nameMaxW = W - PAD * 2;
  const { lines: nameLines, size: nameSize } = wrapLines(
    ctx, nameStr, "900", HEAD, 110, 44, nameMaxW, 2,
  );
  ctx.fillStyle = P.text;
  ctx.font = `900 ${nameSize}px ${HEAD}`;
  let ny = NAME_TOP;
  for (const line of nameLines) {
    ctx.fillText(line, PAD, ny);
    ny += nameSize + 6;
  }

  // ---------- Role ----------
  const ROLE_Y = ny + 8;
  const roleStr = `→ ${role.toUpperCase()}`;
  const roleSize = fitFont(ctx, roleStr, "700", MONO, 26, 16, nameMaxW);
  ctx.fillStyle = ACCENT;
  ctx.font = `700 ${roleSize}px ${MONO}`;
  ctx.fillText(roleStr, PAD, ROLE_Y);

  // Divider
  const DIVIDER_Y = ROLE_Y + roleSize + 16;
  ctx.fillStyle = ACCENT;
  ctx.fillRect(PAD, DIVIDER_Y, 200, 3);
  ctx.fillStyle = withAlpha(P.text, 0.16);
  ctx.fillRect(PAD + 208, DIVIDER_Y + 1, W - (PAD + 208) - PAD, 1);

  // ---------- Scan / QR band ----------
  const QR_SIZE = 156;
  const QR_X = W - MARGIN - 40 - QR_SIZE;
  const QR_Y = Math.max(DIVIDER_Y + 42, 1330);
  const scanTextX = PAD;
  const scanTextMaxW = QR_X - PAD - 24;

  ctx.fillStyle = P.text;
  ctx.font = `700 16px ${MONO}`;
  ctx.fillText("SCAN →", scanTextX, QR_Y + 4);

  ctx.fillStyle = withAlpha(P.text, 0.55);
  ctx.font = `400 14px ${MONO}`;
  ctx.fillText("REGISTER FOR THIS EVENT", scanTextX, QR_Y + 30);

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

  const qrDataUrl = await generateQrDataUrl(theme.url, spec, QR_SIZE);
  const qrImg = await loadImage(qrDataUrl);
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
  ctx.fillText(footerText, W / 2, H - 60);
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
