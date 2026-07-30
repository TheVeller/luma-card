import type { CanonicalTagDTO } from "./canonical-events";
import type { EventDTO } from "./events-aggregate.server";
import { eventTemporalStatus, parseEventTime } from "./event-time";

export type FilterStatus = "all" | "upcoming" | "past";
export type OnlineFilter = "all" | "online" | "in-person";

export type EventFilterState = {
  q: string;
  provider: string;
  labels: string[];
  formats: string[];
  topics: string[];
  audiences: string[];
  online: OnlineFilter;
  cities: string[];
  countries: string[];
  languages: string[];
  dateFrom: string;
  dateTo: string;
  status: FilterStatus;
};

export type EventTagInfo = CanonicalTagDTO & { key: string };

export const EMPTY_FILTERS: EventFilterState = {
  q: "",
  provider: "all",
  labels: [],
  formats: [],
  topics: [],
  audiences: [],
  online: "all",
  cities: [],
  countries: [],
  languages: [],
  dateFrom: "",
  dateTo: "",
  status: "all",
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function addValue(set: Set<string>, value: unknown) {
  const normalized = clean(value);
  if (normalized) set.add(normalized);
}

export function eventTags(event: EventDTO): EventTagInfo[] {
  const enriched = event as EventDTO & {
    tagDetails?: CanonicalTagDTO[];
    tags?: string[];
    suggestedTags?: string[];
  };
  const details = (enriched.tagDetails ?? [])
    .filter((tag) => tag.state === "active")
    .map((tag) => ({ ...tag, key: `${tag.namespace}:${tag.slug}` }));
  if (details.length > 0) return details;

  const fallback: EventTagInfo[] = [];
  const seen = new Set<string>();
  for (const slug of [...(enriched.tags ?? []), ...(enriched.suggestedTags ?? [])]) {
    const normalized = clean(slug);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    fallback.push({
      namespace: "topic",
      slug: normalized,
      label: slug,
      origin: (enriched.suggestedTags ?? []).includes(slug) ? "system" : "manual",
      state: "active",
      confidence: null,
      taxonomyVersion: 1,
      key: `topic:${normalized}`,
    });
  }
  return fallback;
}

export function eventSuggestedTags(event: EventDTO): EventTagInfo[] {
  const enriched = event as EventDTO & { suggestedTags?: string[] };
  return [...new Set(enriched.suggestedTags ?? [])].map((slug) => ({
    namespace: "topic",
    slug: clean(slug),
    label: slug,
    origin: "system" as const,
    state: "active" as const,
    confidence: null,
    taxonomyVersion: 1,
    key: `suggested:${clean(slug)}`,
  }));
}

export function eventProviders(event: EventDTO): string[] {
  const sources = event.sources ?? [];
  const providers = new Set(sources.map((source) => source.provider));
  if (providers.size === 0) providers.add("luma");
  return [...providers];
}

export function eventValues(event: EventDTO) {
  const enrichment = event.enrichment ?? {};
  const values = {
    formats: new Set<string>(),
    topics: new Set<string>(),
    audiences: new Set<string>(),
    cities: new Set<string>(),
    countries: new Set<string>(),
    languages: new Set<string>(),
  };
  for (const tag of eventTags(event)) {
    if (tag.namespace === "format") values.formats.add(tag.slug);
    if (tag.namespace === "topic") values.topics.add(tag.slug);
    if (tag.namespace === "audience") values.audiences.add(tag.slug);
  }
  addValue(values.formats, enrichment.format);
  for (const value of enrichment.topics ?? []) addValue(values.topics, value);
  for (const value of enrichment.audience ?? []) addValue(values.audiences, value);
  addValue(values.cities, event.city);
  addValue(values.countries, enrichment.countryCode);
  addValue(values.languages, enrichment.languageCode);
  return values;
}

function includesAny(values: Set<string>, selected: string[]) {
  return selected.length === 0 || selected.some((value) => values.has(value));
}

export function matchesEvent(event: EventDTO, filters: EventFilterState, now: number) {
  const status = eventTemporalStatus(event, now);
  if (filters.status === "upcoming" && status !== "upcoming" && status !== "ongoing") return false;
  if (filters.status === "past" && status !== "past") return false;
  if (filters.provider !== "all" && !eventProviders(event).includes(filters.provider)) return false;

  const values = eventValues(event);
  if (!includesAny(values.formats, filters.formats)) return false;
  if (!includesAny(values.topics, filters.topics)) return false;
  if (!includesAny(values.audiences, filters.audiences)) return false;
  if (!includesAny(values.cities, filters.cities)) return false;
  if (!includesAny(values.countries, filters.countries)) return false;
  if (!includesAny(values.languages, filters.languages)) return false;

  const isOnline = event.enrichment?.isOnline;
  if (filters.online === "online" && isOnline !== true) return false;
  if (filters.online === "in-person" && isOnline !== false) return false;

  const timestamp = parseEventTime(event.startAt);
  if (filters.dateFrom && (!timestamp || timestamp < Date.parse(filters.dateFrom))) return false;
  if (filters.dateTo && (!timestamp || timestamp > Date.parse(`${filters.dateTo}T23:59:59`)))
    return false;

  const query = filters.q.trim().toLowerCase();
  if (query) {
    const haystack = [event.name, event.city, event.calendarName, event.description]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  if (filters.labels.length > 0) {
    const labels = new Set(eventTags(event).map((tag) => tag.slug));
    if (!filters.labels.every((label) => labels.has(label))) return false;
  }
  return true;
}

export function filtersAreActive(filters: EventFilterState) {
  return Boolean(
    filters.q ||
    filters.provider !== "all" ||
    filters.labels.length ||
    filters.formats.length ||
    filters.topics.length ||
    filters.audiences.length ||
    filters.online !== "all" ||
    filters.cities.length ||
    filters.countries.length ||
    filters.languages.length ||
    filters.dateFrom ||
    filters.dateTo ||
    filters.status !== "all",
  );
}

export function filterLabel(namespace: string, value: string) {
  return value
    .split(/[-_]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
