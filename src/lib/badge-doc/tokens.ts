// Token resolution: turns "$palette.text|alpha(0.7)" into a concrete value.
//
// Deliberately not an expression language. A closed set of namespaces and a
// closed set of filters, so a doc coming from a model can be validated up front
// and can never reach anything it was not given.

import { effectiveAccent, isMonoPalette, type StyleSpec } from "@/lib/style-spec";

/** A colour, kept as hex + alpha instead of a css string: SVG needs them apart. */
export type ResolvedColor = { hex: string; alpha: number };

export type ImageAsset = {
  /** whatever the painter draws: HTMLImageElement in the browser, data url on the server */
  source: unknown;
  width: number;
  height: number;
};

export type BindingContext = {
  palette: StyleSpec["palette"];
  fonts: { heading: string; body: string };
  derived: {
    accent: string;
    isMono: boolean;
    /** the classic badge draws its hairlines heavier on a mono palette */
    hairlineAlpha: number;
    photoStrokeAlpha: number;
  };
  event: {
    name: string;
    subtitle: string;
    dateLine: string;
    url: string;
    coverUrl: string | null;
  };
  user: { firstName: string; role: string; photo: string | null };
  assets: Record<string, ImageAsset>;
  doc: Record<string, number | string>;
};

export function bindingsFrom(
  spec: StyleSpec,
  event: BindingContext["event"],
  user: BindingContext["user"],
  assets: Record<string, ImageAsset> = {},
  vars: Record<string, number | string> = {},
): BindingContext {
  const isMono = isMonoPalette(spec);
  return {
    palette: spec.palette,
    fonts: { heading: spec.fonts.heading, body: spec.fonts.body },
    derived: {
      accent: effectiveAccent(spec),
      isMono,
      hairlineAlpha: isMono ? 0.28 : 0.16,
      photoStrokeAlpha: isMono ? 0.6 : 1,
    },
    event,
    user,
    assets,
    doc: vars,
  };
}

/* ---------- filters ---------- */

/** Ported from badge-render.ts: displayUrl() */
function displayUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/\/$/, "");
    return `${u.hostname}${path}`.toUpperCase();
  } catch {
    return raw.toUpperCase();
  }
}

type FilterFn = (
  value: unknown,
  arg: string | undefined,
  out: { alpha: number },
  bindings: BindingContext,
) => unknown;

const FILTERS: Record<string, FilterFn> = {
  // Colour opacity. Kept out of the value so SVG can emit fill + fill-opacity.
  // The argument may itself be a token, which is how the classic badge keeps
  // its mono-palette hairlines without a conditional in the document.
  alpha: (v, arg, out, bindings) => {
    const raw = arg?.startsWith("$") ? lookup(bindings, arg.slice(1).split(".")) : arg;
    const a = Number(raw);
    out.alpha = Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 1;
    return v;
  },
  upper: (v) => String(v).toUpperCase(),
  lower: (v) => String(v).toLowerCase(),
  displayUrl: (v) => displayUrl(String(v)),
  prefix: (v, arg) => `${arg ?? ""}${String(v)}`,
  suffix: (v, arg) => `${String(v)}${arg ?? ""}`,
  default: (v, arg) => (v === null || v === undefined || v === "" ? (arg ?? "") : v),
};

export const FILTER_NAMES = Object.keys(FILTERS);
export const NAMESPACES = ["palette", "fonts", "derived", "event", "user", "doc", "assets"];

/* ---------- resolution ---------- */

type Parsed = { path: string[]; pipes: { name: string; arg?: string }[] };

function parseToken(token: string): Parsed | null {
  if (!token.startsWith("$")) return null;
  const [head, ...rest] = token.slice(1).split("|");
  const pipes = rest.map((p) => {
    const m = /^([a-z]+)(?:\((.*)\))?$/.exec(p);
    return m ? { name: m[1], arg: m[2] } : { name: p };
  });
  return { path: head.split("."), pipes };
}

/** Shorthands that keep the classic doc readable. */
const ALIASES: Record<string, string[]> = {
  photo: ["user", "photo"],
  accent: ["derived", "accent"],
};

function lookup(bindings: BindingContext, path: string[]): unknown {
  const resolved = ALIASES[path[0]] && path.length === 1 ? ALIASES[path[0]] : path;
  let cur: unknown = bindings;
  for (const key of resolved) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export class TokenError extends Error {}

/** Raw value behind a token, filters applied. Non-tokens pass through. */
export function resolveToken(
  value: string,
  bindings: BindingContext,
): { value: unknown; alpha: number } {
  if (!value.startsWith("$")) return { value, alpha: 1 };
  const parsed = parseToken(value);
  if (!parsed) throw new TokenError(`malformed token: ${value}`);
  if (!NAMESPACES.includes(parsed.path[0]) && !ALIASES[parsed.path[0]]) {
    throw new TokenError(`unknown namespace: $${parsed.path[0]}`);
  }

  const out = { alpha: 1 };
  let v = lookup(bindings, parsed.path);
  for (const pipe of parsed.pipes) {
    const fn = FILTERS[pipe.name];
    if (!fn) throw new TokenError(`unknown filter: |${pipe.name}`);
    v = fn(v, pipe.arg, out, bindings);
  }
  return { value: v, alpha: out.alpha };
}

export function resolveString(value: string, bindings: BindingContext): string {
  const { value: v } = resolveToken(value, bindings);
  return v === null || v === undefined ? "" : String(v);
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function resolveColor(value: string, bindings: BindingContext): ResolvedColor {
  const { value: v, alpha } = resolveToken(value, bindings);
  const hex = typeof v === "string" && HEX_RE.test(v) ? v.toLowerCase() : "#000000";
  return { hex, alpha };
}

/** visibleIf semantics: non-empty string, non-zero number, true. */
export function resolveTruthy(value: string, bindings: BindingContext): boolean {
  const { value: v } = resolveToken(value, bindings);
  if (typeof v === "string") return v.length > 0;
  if (typeof v === "number") return v !== 0;
  return Boolean(v);
}

export function colorToCss(c: ResolvedColor): string {
  if (c.alpha >= 1) return c.hex;
  const n = parseInt(c.hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${c.alpha})`;
}
