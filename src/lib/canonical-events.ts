export type EventSourceType = "api" | "calendar_scrape" | "event_scrape" | "profile_scrape";

export type CanonicalBaseEvent = {
  id: string;
  name: string;
  coverUrl: string | null;
  url: string;
  startAt: string;
  endAt?: string;
  city?: string;
  description?: string;
  calendarId?: string;
  calendarName?: string;
};

export type CanonicalEventSourceDTO = {
  sourceType: EventSourceType;
  sourceKey: string;
  calendarId: string | null;
  calendarName: string | null;
  sourceUrl: string;
  externalEventId: string | null;
  hostName: string | null;
  lastSyncedAt: string;
};

export type CanonicalEventDTO = CanonicalBaseEvent & {
  externalIds: {
    lumaEventId?: string;
    scrapedEventKeys: string[];
  };
  sources: CanonicalEventSourceDTO[];
  tags: string[];
  suggestedTags: string[];
};

export type SourceEventInput = {
  event: CanonicalBaseEvent;
  sourceType: EventSourceType;
  sourceKey?: string;
  calendarRowId?: string | null;
  calendarId?: string | null;
  calendarName?: string | null;
  sourceUrl?: string | null;
  externalEventId?: string | null;
  hostName?: string | null;
  payload?: Record<string, unknown>;
};

export function normalizeCanonicalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.replace(/^www\./, "").toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return raw.trim() || null;
  }
}

export function stableEventHash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

export function canonicalKeyFor(input: SourceEventInput): string {
  const externalId = input.externalEventId ?? input.event.id;
  if (/^evt-/i.test(externalId)) return `luma:${externalId}`;
  const normalized = normalizeCanonicalUrl(input.sourceUrl ?? input.event.url);
  if (normalized) return `url:${normalized}`;
  const fallback = [input.event.name, input.event.startAt, input.hostName ?? input.event.city ?? ""]
    .join("|")
    .toLowerCase();
  return `hash:${stableEventHash(fallback)}`;
}

export function sourceKeyFor(input: SourceEventInput): string {
  if (input.sourceKey) return input.sourceKey;
  const calendar = input.calendarId ?? input.event.calendarId ?? "standalone";
  return [input.sourceType, calendar, input.externalEventId ?? input.event.id].join(":");
}

export function sourceDTO(input: SourceEventInput): CanonicalEventSourceDTO {
  return {
    sourceType: input.sourceType,
    sourceKey: sourceKeyFor(input),
    calendarId: input.calendarId ?? input.event.calendarId ?? null,
    calendarName: input.calendarName ?? input.event.calendarName ?? null,
    sourceUrl: normalizeCanonicalUrl(input.sourceUrl ?? input.event.url) ?? input.event.url,
    externalEventId: input.externalEventId ?? input.event.id ?? null,
    hostName: input.hostName ?? null,
    lastSyncedAt: new Date().toISOString(),
  };
}

function preferEvent(base: CanonicalEventDTO, next: CanonicalBaseEvent): CanonicalEventDTO {
  return {
    ...base,
    name: base.name || next.name,
    coverUrl: base.coverUrl ?? next.coverUrl,
    url: base.url || next.url,
    startAt: base.startAt || next.startAt,
    endAt: base.endAt ?? next.endAt,
    city: base.city ?? next.city,
    description: base.description ?? next.description,
  };
}

export function canonicalizeEvents(inputs: SourceEventInput[]): CanonicalEventDTO[] {
  const byKey = new Map<string, CanonicalEventDTO>();
  const output = new Set<CanonicalEventDTO>();
  for (const input of inputs) {
    const key = canonicalKeyFor(input);
    const normalizedUrl = normalizeCanonicalUrl(input.sourceUrl ?? input.event.url);
    const aliases = [key, ...(normalizedUrl ? [`url:${normalizedUrl}`] : [])];
    const event = input.event;
    const source = sourceDTO(input);
    const existing = aliases.map((alias) => byKey.get(alias)).find(Boolean);
    if (!existing) {
      const created: CanonicalEventDTO = {
        ...event,
        id: stableEventHash(key),
        externalIds: {
          lumaEventId: /^evt-/i.test(input.externalEventId ?? event.id)
            ? (input.externalEventId ?? event.id)
            : undefined,
          scrapedEventKeys: event.id.startsWith("scr-") ? [event.id] : [],
        },
        sources: [source],
        tags: [],
        suggestedTags: [],
      };
      for (const alias of aliases) byKey.set(alias, created);
      output.add(created);
      continue;
    }
    const merged = preferEvent(existing, event);
    if (/^evt-/i.test(input.externalEventId ?? event.id)) {
      merged.externalIds.lumaEventId = input.externalEventId ?? event.id;
    }
    if (event.id.startsWith("scr-") && !merged.externalIds.scrapedEventKeys.includes(event.id)) {
      merged.externalIds.scrapedEventKeys.push(event.id);
    }
    if (
      !merged.sources.some(
        (s) => s.sourceType === source.sourceType && s.sourceKey === source.sourceKey,
      )
    ) {
      merged.sources.push(source);
    }
    output.delete(existing);
    output.add(merged);
    for (const alias of aliases) byKey.set(alias, merged);
  }
  return [...output];
}
