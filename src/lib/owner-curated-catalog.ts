import { detectProviderImportTarget } from "./event-providers";

export const CURATED_OWNER_EMAIL = "ivelasquezfr@gmail.com";

export type CuratedSource = {
  name: string;
  url: string;
  kind: "calendar" | "profile" | "group";
  provider: "luma" | "meetup";
};

export const OWNER_CURATED_SOURCES: CuratedSource[] = [
  ["Ignacio Velasquez", "https://luma.com/calendar/manage/cal-kxl4D1uAoU43FUo"],
  ["AI First Founders", "https://luma.com/calendar/manage/cal-SWU8CT273B56jaH"],
  ["Cursor Arequipa, Peru", "https://luma.com/calendar/manage/cal-wB2uz8heNY4oBFD"],
  ["Cursor Lima, Peru", "https://luma.com/calendar/manage/cal-ti6D1KKVYOhnASI"],
  ["FLIT FESTIVAL", "https://luma.com/calendar/manage/cal-bNk2zfu3F4QK6Oc"],
  ["Hack0 Community", "https://luma.com/hack0?k=c"],
  ["Jebi Calendar", "https://luma.com/calendar/manage/cal-F7g8T62gj6Xf9M6"],
  ["Notion Arequipa", "https://luma.com/calendar/manage/cal-4GQh1WBnfsGFcAY"],
  ["Sundai Latam", "https://luma.com/sundailatam?k=c"],
  ["30X Team", "https://luma.com/crece30X?k=c"],
  ["BNB Chain LatAm", "https://luma.com/bnbchainlatam?k=c"],
  ["B Venture Capital", "https://luma.com/BVentureCapitalEvents?k=c"],
  ["Claude Community Events", "https://luma.com/claudecommunity?k=c"],
  ["Clerk", "https://luma.com/clerk?k=c"],
  ["Cursor Community", "https://luma.com/cursorcommunity?k=c"],
  ["Datahackers", "https://luma.com/datahackers?k=c"],
  ["Devin Events Calendar", "https://luma.com/devin?k=c"],
  ["ElevenLabs", "https://luma.com/elevenlabsio?k=c"],
  ["European Defense Tech Hub", "https://luma.com/eurodefensetech?k=c"],
  ["Google DeepMind", "https://luma.com/deepmind?k=c"],
  ["IA Labs Sessions", "https://luma.com/ia-labs?k=c"],
  ["Lenny's Newsletter Meetups", "https://luma.com/lennysnewsletter?k=c"],
  ["🌍 Make AI Global Calendar", "https://luma.com/ai-automations-make-global-calendar?k=c"],
  ["n8n Community Events", "https://luma.com/n8n-events?k=c"],
  ["Notion Perú", "https://luma.com/notionperu?k=c"],
  ["OpenClaw Meetups", "https://luma.com/claw?k=c"],
  ["PM Beers", "https://luma.com/pmbeers?k=c"],
  ["Prisma Latam", "https://luma.com/getprisma?k=c"],
  ["Supabase Community Events", "https://luma.com/supabase_community_events?k=c"],
  ["Virrey Valley", "https://luma.com/VirreyValley?k=c"],
  ["Voice AI Space", "https://luma.com/voiceaispace?k=c"],
  ["Administración y Negocios Digitales", "https://luma.com/calendar/cal-9ftPVfeXGHrWEqB"],
  ["ADN PARTNERS", "https://luma.com/calendar/cal-aanWN5kK7gHCDcx"],
  ["Arequipa Tech Week", "https://luma.com/ArequipaTechWeek?k=c"],
  ["Bilbao 2", "https://luma.com/bilbao2?k=c"],
  ["Calendario Wondertech", "https://luma.com/wearewondertech?k=c"],
  ["Clawdbot Community [Español 🇪🇸]", "https://luma.com/claw-e?k=c"],
  ["Club Canva Perú", "https://luma.com/club-canva-pe?k=c"],
  ["Codex Community", "https://luma.com/codexcommunity?k=c"],
  ["Crafter Station", "https://luma.com/crafter?k=c"],
  ["Cursor Ambassadors", "https://luma.com/calendar/cal-5OSJfbggnvHYf2E"],
  ["DSC UTP", "https://luma.com/dsc-utp?k=c"],
  ["Endeavor Perú", "https://luma.com/calendar/cal-4wf3IQ85hm7rUS8"],
  ["Eventos: AceleraNet", "https://luma.com/AceleraNet?k=c"],
  ["Eventos: Conexa", "https://luma.com/Conexa?k=c"],
  ["Eventos Hub UDEP", "https://luma.com/eventoshubudep?k=c"],
  ["GetBlock", "https://luma.com/GetBlock?k=c"],
  ["GianSecurAI", "https://luma.com/GianSecurAI?k=c"],
  ["IndieHackersAQP", "https://luma.com/calendar/cal-ZQFw7Zk0H9R22nH"],
  ["JAKU Emprende UNSA", "https://luma.com/calendar/cal-pwvXaUIBCmvFMJn"],
  ["LatAmBuilds", "https://luma.com/calendar/cal-tMx4CyALnWeYMzv"],
  ["LEAD UTEC", "https://luma.com/calendar/cal-vwRaTPAosGIM3mS"],
  ["LEAD UTP", "https://luma.com/leadutp_?k=c"],
  ["Manychat events", "https://luma.com/manychat?k=c"],
  ["Mindful Makers", "https://luma.com/mindful-makers?k=c"],
  ["Notion Lima", "https://luma.com/notion-lima?k=c"],
  ["OpenAI Build Week", "https://luma.com/calendar/cal-FhWvOxHV0AGL38z"],
  ["Super Happy Dev House MX", "https://luma.com/shdhmx?k=c"],
  ["Techsuyo", "https://luma.com/techsuyo?k=c"],
  ["The Growth System", "https://luma.com/calendar/cal-vwIdWR9STPyGSm0"],
  ["Vercel Community", "https://luma.com/VercelCommunity?k=c"],
  ["Ignacio Velasquez profile", "https://luma.com/user/theveller", "profile"],
].map(([name, url, kind = "calendar"]) => ({
  name,
  url,
  kind: kind as "calendar" | "profile",
  provider: "luma" as const,
}));

export function normalizeSourceUrl(raw: string): string {
  const url = new URL(raw.trim());
  url.search = "";
  url.hash = "";
  if (url.hostname.replace(/^www\./, "").toLowerCase() === "meetup.com") {
    const slug = url.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
    if (!slug) throw new Error("Meetup group URL is missing its slug");
    return `https://www.meetup.com/${slug}`;
  }
  url.hostname = "luma.com";
  const manage = url.pathname.match(/^\/calendar\/manage\/(cal-[A-Za-z0-9]+)\/?$/i);
  if (manage) url.pathname = `/calendar/${manage[1]}`;
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function sourceCalendarId(source: CuratedSource): string {
  const normalized = normalizeSourceUrl(source.url);
  const calendarId =
    source.provider === "luma" ? normalized.match(/\/calendar\/(cal-[A-Za-z0-9]+)$/i)?.[1] : null;
  if (calendarId) return `scr-${calendarId}`;
  let hash = 5381;
  for (const char of normalized) hash = ((hash << 5) + hash + char.charCodeAt(0)) | 0;
  return source.provider === "luma"
    ? `scr-${source.kind}-${Math.abs(hash).toString(36)}`
    : `scr-meetup-${Math.abs(hash).toString(36)}`;
}

function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[index + 1] === "\n") index++;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function sourceFromUrl(rawUrl: string, name?: string): CuratedSource | null {
  const target = detectProviderImportTarget(rawUrl);
  if (!target) return null;
  if (target.provider === "eventbrite" || target.kind === "event") return null;
  const kind =
    target.provider === "meetup" ? "group" : target.kind === "profile" ? "profile" : "calendar";
  const normalized = normalizeSourceUrl(target.normalizedUrl);
  const fallbackName =
    new URL(normalized).pathname.split("/").filter(Boolean).at(-1) ??
    (target.provider === "meetup" ? "Meetup group" : "Luma source");
  return {
    name: name?.trim() || fallbackName,
    url: normalized,
    kind,
    provider: target.provider,
  };
}

export type BulkParseReport = {
  sources: CuratedSource[];
  rowsProcessed: number;
  uniqueUrls: number;
  duplicatesIgnored: number;
  invalidRows: number;
};

export function parseBulkSourcesReport(input: string): BulkParseReport {
  const sources: CuratedSource[] = [];
  const seen = new Set<string>();
  let rowsProcessed = 0;
  let duplicatesIgnored = 0;
  let invalidRows = 0;

  const collect = (rawUrl: string | undefined, name?: string) => {
    rowsProcessed++;
    if (!rawUrl) {
      invalidRows++;
      return;
    }
    const source = sourceFromUrl(rawUrl.trim(), name);
    if (!source) {
      invalidRows++;
      return;
    }
    if (seen.has(source.url)) {
      duplicatesIgnored++;
      return;
    }
    seen.add(source.url);
    sources.push(source);
  };

  const report = (): BulkParseReport => ({
    sources,
    rowsProcessed,
    uniqueUrls: sources.length,
    duplicatesIgnored,
    invalidRows,
  });

  const csvRows = parseCsvRows(input);
  const header = csvRows[0]?.map((cell) => cell.trim().toLowerCase()) ?? [];
  const nameColumn = header.findIndex((cell) =>
    /^(name|title|group|group name|calendar name|ds2-m18)$/.test(cell),
  );
  const hasHeader =
    nameColumn >= 0 ||
    header.some((cell) => /^(url|link|href|flex href|calendar url|group url)$/.test(cell));
  if (csvRows.length > 1 && csvRows.some((row) => row.length > 1)) {
    for (const row of csvRows.slice(hasHeader ? 1 : 0)) {
      const urlColumn = row.findIndex((cell) =>
        /^https?:\/\/(?:www\.)?(?:lu\.ma|luma\.com|meetup\.com)\//i.test(cell.trim()),
      );
      const rawUrl = row[urlColumn];
      if (!rawUrl) {
        rowsProcessed++;
        invalidRows++;
        continue;
      }
      const inferredName = hasHeader
        ? nameColumn >= 0
          ? row[nameColumn]
          : undefined
        : row.find((cell, index) => index !== urlColumn && cell.trim());
      collect(rawUrl, inferredName);
    }
    if (sources.length > 0) return report();
  }

  rowsProcessed = 0;
  duplicatesIgnored = 0;
  invalidRows = 0;
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("```") || /^[-| :]+$/.test(line)) continue;
    const url = line.match(
      /https?:\/\/(?:www\.)?(?:lu\.ma|luma\.com|meetup\.com)\/[^\s|",]+/i,
    )?.[0];
    if (!url) continue;
    const cleanUrl = url.replace(/[),.;]+$/, "");
    const before = line.slice(0, line.indexOf(url)).replace(/^[|\s*\d.]+|[|\s—–-]+$/g, "");
    collect(cleanUrl, before);
  }
  return report();
}

export function parseBulkSources(input: string): CuratedSource[] {
  return parseBulkSourcesReport(input).sources;
}
