// Client-side canvas badge composer.
// Overlap-proof: the layout is a single vertical stack of measured bands.
// Photo shrinks (in 20px steps) if content would exceed the frame; text
// bands auto-shrink and wrap but never squeeze into each other.

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
const INNER_PAD = 66;

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

async function generateQrDataUrl(url: string, spec: StyleSpec, size: number): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    width: size * 2,
    margin: 2,
    color: { dark: spec.palette.text, light: spec.palette.surface },
  });
}

function fitLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: string,
  family: string,
  startSize: number,
  minSize: number,
  maxWidth: number,
  maxLines: number,
): { lines: string[]; size: number; lineHeight: number } {
  for (let size = startSize; size >= minSize; size -= 2) {
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
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxWidth)) {
      return { lines, size, lineHeight: Math.round(size * 1.08) };
    }
  }
  // Final fallback: hard-truncate with ellipsis
  ctx.font = `${weight} ${minSize}px ${family}`;
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const test = current ? current + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && current) {
      if (lines.length + 1 >= maxLines) {
        // ellipsize
        let last = test;
        while (ctx.measureText(last + "…").width > maxWidth && last.length > 1)
          last = last.slice(0, -1);
        lines.push(last + "…");
        break;
      }
      lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return { lines: lines.slice(0, maxLines), size: minSize, lineHeight: Math.round(minSize * 1.08) };
}

function fitSingle(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: string,
  family: string,
  startSize: number,
  minSize: number,
  maxWidth: number,
): { text: string; size: number } {
  for (let size = startSize; size >= minSize; size -= 2) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) return { text, size };
  }
  // Ellipsize at min size
  ctx.font = `${weight} ${minSize}px ${family}`;
  let t = text;
  while (ctx.measureText(t + "…").width > maxWidth && t.length > 1) t = t.slice(0, -1);
  return { text: t + "…", size: minSize };
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
  heroDataUrl?: string | null; // ignored, kept for back-compat
};

type Band = { name: string; x: number; y: number; w: number; h: number };

function assertNoOverlap(bands: Band[]) {
  for (let i = 0; i < bands.length; i++) {
    for (let j = i + 1; j < bands.length; j++) {
      const a = bands[i], b = bands[j];
      if (
        a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.y < b.y + b.h &&
        a.y + a.h > b.y
      ) {
        console.warn(
          `[badge-render] overlap between ${a.name} and ${b.name}`,
          { a, b },
        );
      }
    }
  }
}

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

  // Paper
  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, W, H);

  // Frame
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 3;
  ctx.strokeRect(MARGIN, MARGIN, W - MARGIN * 2, H - MARGIN * 2);
  ctx.strokeStyle = withAlpha(P.text, mono ? 0.28 : 0.16);
  ctx.lineWidth = 1;
  ctx.strokeRect(MARGIN + 10, MARGIN + 10, W - (MARGIN + 10) * 2, H - (MARGIN + 10) * 2);

  // Preload photo (needed for measurement stability); cover is optional
  const photo = await loadImage(photoDataUrl);
  const seal = theme.coverUrl ? await loadImage(theme.coverUrl).catch(() => null) : null;

  // ==== Measurement pass ====
  // Available inner box (inside frame padding)
  const innerX = MARGIN + INNER_PAD * 0.34; // ~48
  const innerRight = W - MARGIN - INNER_PAD * 0.34;
  const innerW = innerRight - innerX;

  // Header
  const SEAL_SIZE = 148;
  const SEAL_MARGIN = 24;
  const headerReservedRight = seal ? SEAL_SIZE + SEAL_MARGIN : 0;
  const headerW = innerW - headerReservedRight;
  const kickerH = 22; // "· WHAT'S BREWING?" line
  const gapKickerHead = 14;

  const nameUpper = theme.name.toUpperCase();
  const head = fitLines(ctx, nameUpper, "900", HEAD, 88, 40, headerW, 2);

  // Meta row (city + date)
  const cityText = theme.subtitle.toUpperCase();
  const dateText = theme.dateLine;
  ctx.font = `700 22px ${MONO}`;
  const cityW = ctx.measureText(cityText).width;
  ctx.font = `400 22px ${MONO}`;
  const dateW = ctx.measureText(dateText).width;
  const metaFitsOneLine = cityW + 32 + dateW <= headerW;
  const metaH = metaFitsOneLine ? 22 : 22 + 8 + 22;
  const gapHeadMeta = 14;

  const HEADER_TOP = MARGIN + 44;
  const headerBlockH =
    kickerH + gapKickerHead + head.lines.length * head.lineHeight + gapHeadMeta + metaH;
  // Ensure seal fits: header block minimum height = seal size + small padding
  const headerH = Math.max(headerBlockH, seal ? SEAL_SIZE + 8 : headerBlockH);
  const HEADER_BOTTOM = HEADER_TOP + headerH;

  // Gap before photo
  const gapHeaderPhoto = 40;

  // Photo (start big and shrink to fit)
  let PHOTO_SIZE = 680;
  const PHOTO_MIN = 380;

  // Caption
  const captionH = 22;
  const gapPhotoCaption = 22;

  // Name band
  const nameStr = firstName.toUpperCase();
  const name = fitLines(ctx, nameStr, "900", HEAD, 104, 42, innerW, 2);
  const gapCaptionName = 40;

  // Role
  const roleStr = `→ ${role.toUpperCase()}`;
  const roleFit = fitSingle(ctx, roleStr, "700", MONO, 26, 16, innerW);
  const gapNameRole = 12;

  // Divider
  const dividerH = 3;
  const gapRoleDivider = 18;

  // Scan block
  const QR_SIZE = 156;
  const QR_PAD = 8;
  const scanBlockH = Math.max(QR_SIZE + QR_PAD * 2, 152);
  const gapDividerScan = 32;

  // Footer
  const footerH = 22;
  const gapScanFooter = 24;

  const fixedContentBelowPhoto =
    gapPhotoCaption +
    captionH +
    gapCaptionName +
    name.lines.length * name.lineHeight +
    gapNameRole +
    roleFit.size +
    gapRoleDivider +
    dividerH +
    gapDividerScan +
    scanBlockH +
    gapScanFooter +
    footerH;

  const availForPhoto =
    H - MARGIN - INNER_PAD * 0.5 - HEADER_BOTTOM - gapHeaderPhoto - fixedContentBelowPhoto;
  // Also can't exceed inner width
  const maxPhoto = Math.min(innerW, availForPhoto);
  PHOTO_SIZE = Math.max(PHOTO_MIN, Math.min(PHOTO_SIZE, Math.floor(maxPhoto)));

  // ==== Paint pass ====
  const bands: Band[] = [];

  // Kicker
  ctx.fillStyle = ACCENT;
  ctx.font = `700 20px ${MONO}`;
  ctx.fillText("· WHAT'S BREWING?", innerX, HEADER_TOP);
  bands.push({ name: "kicker", x: innerX, y: HEADER_TOP, w: headerW, h: kickerH });

  // Headline
  ctx.fillStyle = P.text;
  ctx.font = `900 ${head.size}px ${HEAD}`;
  const headY = HEADER_TOP + kickerH + gapKickerHead;
  let hy = headY;
  for (const line of head.lines) {
    ctx.fillText(line, innerX, hy);
    hy += head.lineHeight;
  }
  bands.push({ name: "headline", x: innerX, y: headY, w: headerW, h: head.lines.length * head.lineHeight });

  // Meta
  const metaY = headY + head.lines.length * head.lineHeight + gapHeadMeta;
  ctx.font = `700 22px ${MONO}`;
  ctx.fillStyle = ACCENT;
  ctx.fillText(cityText, innerX, metaY);
  ctx.font = `400 22px ${MONO}`;
  ctx.fillStyle = withAlpha(P.text, 0.7);
  if (metaFitsOneLine) {
    ctx.fillText(dateText, innerX + headerW - dateW, metaY);
  } else {
    ctx.fillText(dateText, innerX, metaY + 22 + 8);
  }
  bands.push({ name: "meta", x: innerX, y: metaY, w: headerW, h: metaH });

  // Seal (top-right)
  if (seal) {
    const sealCx = innerRight - SEAL_SIZE / 2;
    const sealCy = HEADER_TOP + SEAL_SIZE / 2 - 4;
    drawCircleImage(ctx, seal, sealCx, sealCy, SEAL_SIZE / 2, P.text);
    bands.push({
      name: "seal",
      x: sealCx - SEAL_SIZE / 2,
      y: sealCy - SEAL_SIZE / 2,
      w: SEAL_SIZE,
      h: SEAL_SIZE,
    });
  }

  // Photo — centered horizontally
  const PHOTO_TOP = HEADER_BOTTOM + gapHeaderPhoto;
  const PHOTO_LEFT = (W - PHOTO_SIZE) / 2;
  drawContainImage(ctx, photo, PHOTO_LEFT, PHOTO_TOP, PHOTO_SIZE, PHOTO_SIZE, P.surface);
  ctx.strokeStyle = withAlpha(ACCENT, mono ? 0.6 : 1);
  ctx.lineWidth = 2;
  ctx.strokeRect(PHOTO_LEFT, PHOTO_TOP, PHOTO_SIZE, PHOTO_SIZE);
  // Corner brackets
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
  bands.push({ name: "photo", x: PHOTO_LEFT, y: PHOTO_TOP, w: PHOTO_SIZE, h: PHOTO_SIZE });

  // Caption
  const CAPTION_Y = PHOTO_TOP + PHOTO_SIZE + gapPhotoCaption;
  ctx.fillStyle = withAlpha(P.text, 0.5);
  ctx.font = `400 18px ${MONO}`;
  ctx.textAlign = "center";
  ctx.fillText(`· ${theme.dateLine} ·`, W / 2, CAPTION_Y);
  ctx.textAlign = "left";
  bands.push({ name: "caption", x: innerX, y: CAPTION_Y, w: innerW, h: captionH });

  // Name band
  const NAME_TOP = CAPTION_Y + captionH + gapCaptionName;
  ctx.fillStyle = P.text;
  ctx.font = `900 ${name.size}px ${HEAD}`;
  let ny = NAME_TOP;
  for (const line of name.lines) {
    ctx.fillText(line, innerX, ny);
    ny += name.lineHeight;
  }
  bands.push({ name: "name", x: innerX, y: NAME_TOP, w: innerW, h: name.lines.length * name.lineHeight });

  // Role
  const ROLE_Y = NAME_TOP + name.lines.length * name.lineHeight + gapNameRole;
  ctx.fillStyle = ACCENT;
  ctx.font = `700 ${roleFit.size}px ${MONO}`;
  ctx.fillText(roleFit.text, innerX, ROLE_Y);
  bands.push({ name: "role", x: innerX, y: ROLE_Y, w: innerW, h: roleFit.size });

  // Divider
  const DIVIDER_Y = ROLE_Y + roleFit.size + gapRoleDivider;
  ctx.fillStyle = ACCENT;
  ctx.fillRect(innerX, DIVIDER_Y, 200, dividerH);
  ctx.fillStyle = withAlpha(P.text, 0.16);
  ctx.fillRect(innerX + 208, DIVIDER_Y + 1, innerW - 208, 1);
  bands.push({ name: "divider", x: innerX, y: DIVIDER_Y, w: innerW, h: dividerH });

  // Scan block
  const SCAN_Y = DIVIDER_Y + dividerH + gapDividerScan;
  const QR_X = innerRight - QR_SIZE;
  const QR_Y = SCAN_Y;
  const scanTextMaxW = QR_X - innerX - 24;

  ctx.fillStyle = P.text;
  ctx.font = `700 16px ${MONO}`;
  ctx.fillText("SCAN →", innerX, QR_Y + 4);
  ctx.fillStyle = withAlpha(P.text, 0.55);
  ctx.font = `400 14px ${MONO}`;
  ctx.fillText("REGISTER FOR THIS EVENT", innerX, QR_Y + 30);

  const urlText = displayUrl(theme.url);
  const urlFit = fitLines(ctx, urlText, "700", MONO, 20, 12, scanTextMaxW, 2);
  ctx.fillStyle = P.text;
  ctx.font = `700 ${urlFit.size}px ${MONO}`;
  let uy = QR_Y + 62;
  for (const line of urlFit.lines) {
    ctx.fillText(line, innerX, uy);
    uy += urlFit.lineHeight;
  }
  bands.push({ name: "scan-text", x: innerX, y: QR_Y, w: scanTextMaxW, h: scanBlockH });

  const qrDataUrl = await generateQrDataUrl(theme.url, spec, QR_SIZE);
  const qrImg = await loadImage(qrDataUrl);
  ctx.fillStyle = P.surface;
  ctx.fillRect(QR_X - QR_PAD, QR_Y - QR_PAD, QR_SIZE + QR_PAD * 2, QR_SIZE + QR_PAD * 2);
  ctx.strokeStyle = withAlpha(P.text, 0.2);
  ctx.lineWidth = 1;
  ctx.strokeRect(QR_X - QR_PAD, QR_Y - QR_PAD, QR_SIZE + QR_PAD * 2, QR_SIZE + QR_PAD * 2);
  ctx.drawImage(qrImg, QR_X, QR_Y, QR_SIZE, QR_SIZE);
  bands.push({ name: "qr", x: QR_X - QR_PAD, y: QR_Y - QR_PAD, w: QR_SIZE + QR_PAD * 2, h: QR_SIZE + QR_PAD * 2 });

  // Footer
  const FOOTER_Y = Math.max(SCAN_Y + scanBlockH + gapScanFooter, H - MARGIN - 40);
  const footerText = `${theme.name.toLowerCase()} · powered by luma_`;
  const footerFit = fitSingle(ctx, footerText, "400", MONO, 18, 12, innerW);
  ctx.fillStyle = withAlpha(P.text, 0.4);
  ctx.font = `400 ${footerFit.size}px ${MONO}`;
  ctx.textAlign = "center";
  ctx.fillText(footerFit.text, W / 2, FOOTER_Y);
  ctx.textAlign = "left";
  bands.push({ name: "footer", x: innerX, y: FOOTER_Y, w: innerW, h: footerH });

  if (import.meta.env.DEV) assertNoOverlap(bands);

  return canvas;
}

// Legacy pixel accent (kept for callers that still import it).
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
