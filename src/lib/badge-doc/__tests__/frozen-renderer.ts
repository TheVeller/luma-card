// FROZEN REFERENCE — the hand-written renderer, kept only so the parity test
// has something independent to compare the BadgeDoc engine against. Nothing in
// the app imports it; do not add features here.
//
// It is the approved baseline: the same layout the app always drew, plus the
// three text changes needed to make canvas, SVG and Figma agree. Those are:
// canvas, SVG and Figma. Nothing about the layout itself moves.
//
//   1. kerning off        canvas kerns automatically, an advance-width table does not
//   2. real weights only  no faux bold — every engine synthesizes it differently
//   3. baseline text      textBaseline "top" reads fontBoundingBoxAscent, which is
//                         browser-specific and has no SVG equivalent; we position
//                         each line on its alphabetic baseline instead
//
// Centring is also resolved to an explicit x here rather than delegating to
// ctx.textAlign, so the number comes from the same table the layout will use.

import QRCode from "qrcode";
import { effectiveAccent, isMonoPalette, type StyleSpec } from "@/lib/style-spec";
import { loadGoogleFontPair, validateFontPair } from "@/lib/google-fonts";
import { TableMeasurer, type FontRequest } from "../layout/measure";
import type { BadgeInputs } from "@/lib/badge-render";

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

/** Same word-wrap + shrink algorithm as badge-render.ts, measured off the table. */
function fitLines(
  m: TableMeasurer,
  text: string,
  font: Omit<FontRequest, "size">,
  startSize: number,
  minSize: number,
  maxWidth: number,
  maxLines: number,
): { lines: string[]; size: number; lineHeight: number } {
  const width = (t: string, size: number) => m.width(t, { ...font, size });

  for (let size = startSize; size >= minSize; size -= 2) {
    const words = text.split(" ");
    const lines: string[] = [];
    let current = "";
    for (const w of words) {
      const test = current ? current + " " + w : w;
      if (width(test, size) > maxWidth && current) {
        lines.push(current);
        current = w;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    if (lines.length <= maxLines && lines.every((l) => width(l, size) <= maxWidth)) {
      return { lines, size, lineHeight: Math.round(size * 1.08) };
    }
  }

  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const test = current ? current + " " + w : w;
    if (width(test, minSize) > maxWidth && current) {
      if (lines.length + 1 >= maxLines) {
        let last = test;
        while (width(last + "…", minSize) > maxWidth && last.length > 1) last = last.slice(0, -1);
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

  // Matches the engine: an unbreakable word wider than the box gets clipped
  // rather than drawn off the badge.
  const clipped = lines.slice(0, maxLines).map((line) => {
    if (width(line, minSize) <= maxWidth) return line;
    let t = line;
    while (t.length > 1 && width(t + "…", minSize) > maxWidth) t = t.slice(0, -1);
    return t + "…";
  });
  return { lines: clipped, size: minSize, lineHeight: Math.round(minSize * 1.08) };
}

function fitSingle(
  m: TableMeasurer,
  text: string,
  font: Omit<FontRequest, "size">,
  startSize: number,
  minSize: number,
  maxWidth: number,
): { text: string; size: number } {
  for (let size = startSize; size >= minSize; size -= 2) {
    if (m.width(text, { ...font, size }) <= maxWidth) return { text, size };
  }
  let t = text;
  while (m.width(t + "…", { ...font, size: minSize }) > maxWidth && t.length > 1)
    t = t.slice(0, -1);
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

export async function renderFrozenBadge(inputs: BadgeInputs): Promise<HTMLCanvasElement> {
  const { theme, spec, photoDataUrl, firstName, role } = inputs;

  const { heading: headingFamily, body: bodyFamily } = validateFontPair(
    spec.fonts.heading,
    spec.fonts.body,
  );
  await loadGoogleFontPair(headingFamily, bodyFamily);
  const m = await TableMeasurer.forFamilies([headingFamily, bodyFamily]);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const P = spec.palette;
  const ACCENT = effectiveAccent(spec);
  const mono = isMonoPalette(spec);

  // (1) + (3): the table has no kerning and positions by baseline.
  ctx.textBaseline = "alphabetic";
  ctx.fontKerning = "none";
  ctx.letterSpacing = "0px";
  ctx.textAlign = "left";

  const head = (weight: number): Omit<FontRequest, "size"> => ({
    family: headingFamily,
    weight: m.resolveWeight(headingFamily, weight),
  });
  const body = (weight: number): Omit<FontRequest, "size"> => ({
    family: bodyFamily,
    weight: m.resolveWeight(bodyFamily, weight),
  });

  /** Draws one line whose TOP edge sits at `top`, matching the legacy geometry. */
  function text(str: string, x: number, top: number, f: Omit<FontRequest, "size">, size: number) {
    // (2): f.weight is already the real weight, so the browser never fakes it.
    ctx.font = `${f.weight} ${size}px "${f.family}"`;
    const { ascent } = m.vmetrics({ ...f, size });
    ctx.fillText(str, x, top + ascent);
  }

  function textCentered(
    str: string,
    center: number,
    top: number,
    f: Omit<FontRequest, "size">,
    size: number,
  ) {
    text(str, center - m.width(str, { ...f, size }) / 2, top, f, size);
  }

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

  const photo = await loadImage(photoDataUrl);
  const seal = theme.coverUrl ? await loadImage(theme.coverUrl).catch(() => null) : null;

  // ==== Measurement pass ====
  const innerX = MARGIN + INNER_PAD * 0.34;
  const innerRight = W - MARGIN - INNER_PAD * 0.34;
  const innerW = innerRight - innerX;

  const SEAL_SIZE = 148;
  const SEAL_MARGIN = 24;
  const headerReservedRight = seal ? SEAL_SIZE + SEAL_MARGIN : 0;
  const headerW = innerW - headerReservedRight;
  const kickerH = 22;
  const gapKickerHead = 14;

  const nameUpper = theme.name.toUpperCase();
  const headFit = fitLines(m, nameUpper, head(900), 88, 40, headerW, 2);

  const cityText = theme.subtitle.toUpperCase();
  const dateText = theme.dateLine;
  const cityW = m.width(cityText, { ...body(700), size: 22 });
  const dateW = m.width(dateText, { ...body(400), size: 22 });
  const metaFitsOneLine = cityW + 32 + dateW <= headerW;
  const metaH = metaFitsOneLine ? 22 : 22 + 8 + 22;
  const gapHeadMeta = 14;

  const HEADER_TOP = MARGIN + 44;
  const headerBlockH =
    kickerH + gapKickerHead + headFit.lines.length * headFit.lineHeight + gapHeadMeta + metaH;
  const headerH = Math.max(headerBlockH, seal ? SEAL_SIZE + 8 : headerBlockH);
  const HEADER_BOTTOM = HEADER_TOP + headerH;

  const gapHeaderPhoto = 40;

  let PHOTO_SIZE = 680;
  const PHOTO_MIN = 380;

  const captionH = 22;
  const gapPhotoCaption = 22;

  const nameStr = firstName.toUpperCase();
  const nameFit = fitLines(m, nameStr, head(900), 104, 42, innerW, 2);
  const gapCaptionName = 40;

  const roleStr = `→ ${role.toUpperCase()}`;
  const roleFit = fitSingle(m, roleStr, body(700), 26, 16, innerW);
  const gapNameRole = 12;

  const dividerH = 3;
  const gapRoleDivider = 18;

  const QR_SIZE = 156;
  const QR_PAD = 8;
  const scanBlockH = Math.max(QR_SIZE + QR_PAD * 2, 152);
  const gapDividerScan = 32;

  const footerH = 22;
  const gapScanFooter = 24;

  const fixedContentBelowPhoto =
    gapPhotoCaption +
    captionH +
    gapCaptionName +
    nameFit.lines.length * nameFit.lineHeight +
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
  const maxPhoto = Math.min(innerW, availForPhoto);
  PHOTO_SIZE = Math.max(PHOTO_MIN, Math.min(PHOTO_SIZE, Math.floor(maxPhoto)));

  // ==== Paint pass ====

  // Kicker
  ctx.fillStyle = ACCENT;
  text("· WHAT'S BREWING?", innerX, HEADER_TOP, body(700), 20);

  // Headline
  ctx.fillStyle = P.text;
  const headY = HEADER_TOP + kickerH + gapKickerHead;
  let hy = headY;
  for (const line of headFit.lines) {
    text(line, innerX, hy, head(900), headFit.size);
    hy += headFit.lineHeight;
  }

  // Meta
  const metaY = headY + headFit.lines.length * headFit.lineHeight + gapHeadMeta;
  ctx.fillStyle = ACCENT;
  text(cityText, innerX, metaY, body(700), 22);
  ctx.fillStyle = withAlpha(P.text, 0.7);
  if (metaFitsOneLine) {
    text(dateText, innerX + headerW - dateW, metaY, body(400), 22);
  } else {
    text(dateText, innerX, metaY + 22 + 8, body(400), 22);
  }

  // Seal (top-right)
  if (seal) {
    const sealCx = innerRight - SEAL_SIZE / 2;
    const sealCy = HEADER_TOP + SEAL_SIZE / 2 - 4;
    drawCircleImage(ctx, seal, sealCx, sealCy, SEAL_SIZE / 2, P.text);
  }

  // Photo — centered horizontally
  const PHOTO_TOP = HEADER_BOTTOM + gapHeaderPhoto;
  const PHOTO_LEFT = (W - PHOTO_SIZE) / 2;
  drawContainImage(ctx, photo, PHOTO_LEFT, PHOTO_TOP, PHOTO_SIZE, PHOTO_SIZE, P.surface);
  ctx.strokeStyle = withAlpha(ACCENT, mono ? 0.6 : 1);
  ctx.lineWidth = 2;
  ctx.strokeRect(PHOTO_LEFT, PHOTO_TOP, PHOTO_SIZE, PHOTO_SIZE);
  const cornerLen = 36;
  const cornerThick = 5;
  const corners = [
    { x: PHOTO_LEFT - 3, y: PHOTO_TOP - 3, hFlip: false },
    { x: PHOTO_LEFT + PHOTO_SIZE - cornerLen + 3, y: PHOTO_TOP - 3, hFlip: true },
    { x: PHOTO_LEFT - 3, y: PHOTO_TOP + PHOTO_SIZE - cornerLen + 3, hFlip: false },
    {
      x: PHOTO_LEFT + PHOTO_SIZE - cornerLen + 3,
      y: PHOTO_TOP + PHOTO_SIZE - cornerLen + 3,
      hFlip: true,
    },
  ];
  ctx.fillStyle = ACCENT;
  for (const c of corners) {
    ctx.fillRect(c.x, c.y, cornerLen, cornerThick);
    ctx.fillRect(c.hFlip ? c.x + cornerLen - cornerThick : c.x, c.y, cornerThick, cornerLen);
  }

  // Caption
  const CAPTION_Y = PHOTO_TOP + PHOTO_SIZE + gapPhotoCaption;
  ctx.fillStyle = withAlpha(P.text, 0.5);
  textCentered(`· ${theme.dateLine} ·`, W / 2, CAPTION_Y, body(400), 18);

  // Name band
  const NAME_TOP = CAPTION_Y + captionH + gapCaptionName;
  ctx.fillStyle = P.text;
  let ny = NAME_TOP;
  for (const line of nameFit.lines) {
    text(line, innerX, ny, head(900), nameFit.size);
    ny += nameFit.lineHeight;
  }

  // Role
  const ROLE_Y = NAME_TOP + nameFit.lines.length * nameFit.lineHeight + gapNameRole;
  ctx.fillStyle = ACCENT;
  text(roleFit.text, innerX, ROLE_Y, body(700), roleFit.size);

  // Divider
  const DIVIDER_Y = ROLE_Y + roleFit.size + gapRoleDivider;
  ctx.fillStyle = ACCENT;
  ctx.fillRect(innerX, DIVIDER_Y, 200, dividerH);
  ctx.fillStyle = withAlpha(P.text, 0.16);
  ctx.fillRect(innerX + 208, DIVIDER_Y + 1, innerW - 208, 1);

  // Scan block
  const SCAN_Y = DIVIDER_Y + dividerH + gapDividerScan;
  const QR_X = innerRight - QR_SIZE;
  const QR_Y = SCAN_Y;
  const scanTextMaxW = QR_X - innerX - 24;

  ctx.fillStyle = P.text;
  text("SCAN →", innerX, QR_Y + 4, body(700), 16);
  ctx.fillStyle = withAlpha(P.text, 0.55);
  text("REGISTER FOR THIS EVENT", innerX, QR_Y + 30, body(400), 14);

  const urlText = displayUrl(theme.url);
  const urlFit = fitLines(m, urlText, body(700), 20, 12, scanTextMaxW, 2);
  ctx.fillStyle = P.text;
  let uy = QR_Y + 62;
  for (const line of urlFit.lines) {
    text(line, innerX, uy, body(700), urlFit.size);
    uy += urlFit.lineHeight;
  }

  const qrDataUrl = await generateQrDataUrl(theme.url, spec, QR_SIZE);
  const qrImg = await loadImage(qrDataUrl);
  ctx.fillStyle = P.surface;
  ctx.fillRect(QR_X - QR_PAD, QR_Y - QR_PAD, QR_SIZE + QR_PAD * 2, QR_SIZE + QR_PAD * 2);
  ctx.strokeStyle = withAlpha(P.text, 0.2);
  ctx.lineWidth = 1;
  ctx.strokeRect(QR_X - QR_PAD, QR_Y - QR_PAD, QR_SIZE + QR_PAD * 2, QR_SIZE + QR_PAD * 2);
  ctx.drawImage(qrImg, QR_X, QR_Y, QR_SIZE, QR_SIZE);

  // Footer
  const FOOTER_Y = Math.max(SCAN_Y + scanBlockH + gapScanFooter, H - MARGIN - 40);
  const footerText = `${theme.name.toLowerCase()} · powered by luma_`;
  const footerFit = fitSingle(m, footerText, body(400), 18, 12, innerW);
  ctx.fillStyle = withAlpha(P.text, 0.4);
  textCentered(footerFit.text, W / 2, FOOTER_Y, body(400), footerFit.size);

  return canvas;
}
