import { franc } from "franc-min";
import type { CanonicalBaseEvent, EventEnrichment } from "./canonical-events";

const COUNTRY_HINTS: Array<[string, string[]]> = [
  ["AR", ["argentina", "buenos aires", "cordoba", "mendoza", "rosario", "salta"]],
  ["BO", ["bolivia", "la paz", "santa cruz de la sierra", "cochabamba"]],
  ["BR", ["brasil", "brazil", "sao paulo", "rio de janeiro", "porto alegre"]],
  ["CL", ["chile", "santiago de chile", "valparaiso"]],
  ["CO", ["colombia", "bogota", "medellin", "barranquilla", "cali", "cartagena"]],
  ["CR", ["costa rica", "san jose costa rica"]],
  ["CU", ["cuba", "la habana", "havana"]],
  ["DO", ["republica dominicana", "dominican republic", "santo domingo"]],
  ["EC", ["ecuador", "quito", "guayaquil"]],
  ["GT", ["guatemala", "ciudad de guatemala", "guatemala city"]],
  ["HN", ["honduras", "tegucigalpa", "san pedro sula"]],
  ["HT", ["haiti", "port au prince"]],
  ["MX", ["mexico", "ciudad de mexico", "mexico city", "guadalajara", "monterrey", "merida"]],
  ["NI", ["nicaragua", "managua"]],
  ["PA", ["panama", "ciudad de panama", "panama city"]],
  ["PE", ["peru", "lima", "arequipa", "cusco", "trujillo"]],
  ["PR", ["puerto rico", "san juan puerto rico"]],
  ["PY", ["paraguay", "asuncion"]],
  ["SV", ["el salvador", "san salvador"]],
  ["UY", ["uruguay", "montevideo"]],
  ["VE", ["venezuela", "caracas", "maracaibo"]],
];

const LANGUAGE_CODES: Record<string, string> = {
  eng: "en",
  por: "pt",
  spa: "es",
};

const LANGUAGE_NAMES: Record<string, string> = {
  english: "en",
  ingles: "en",
  en: "en",
  es: "es",
  espanol: "es",
  portuguese: "pt",
  portugues: "pt",
  pt: "pt",
  spanish: "es",
};

const SPANISH_MARKERS = new Set([
  "asi",
  "como",
  "con",
  "construir",
  "construye",
  "creando",
  "datos",
  "desarrollo",
  "desde",
  "evento",
  "hacia",
  "inteligencia",
  "para",
  "pasos",
  "primer",
  "primeros",
  "produccion",
  "proximo",
  "taller",
  "tecnologia",
  "virtual",
]);

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function containsPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

export function inferRoutingCountryCode(
  ...values: Array<string | null | undefined>
): string | null {
  const text = normalizeText(values.filter(Boolean).join(" "));
  if (!text) return null;
  for (const [countryCode, hints] of COUNTRY_HINTS) {
    if (hints.some((hint) => containsPhrase(text, hint))) return countryCode;
  }
  return null;
}

function inferLanguageCode(name: string, description?: string | null): string | null {
  const text = normalizeText([name, description].filter(Boolean).join(" "));
  if (!text) return null;
  const words = text.split(" ");
  const spanishMarkers = words.filter((word) => SPANISH_MARKERS.has(word)).length;
  if (spanishMarkers >= 2) return "es";
  if (text.length < 40) return null;
  const detected = franc(text, {
    minLength: 20,
    only: Object.keys(LANGUAGE_CODES),
  });
  return LANGUAGE_CODES[detected] ?? null;
}

function onlineSignal(...values: Array<string | null | undefined>): boolean {
  const text = normalizeText(values.filter(Boolean).join(" "));
  return /\b(online|virtual|remoto|remota|remote|webinar|en linea)\b/.test(text);
}

function normalizedCountryCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

function normalizedLanguageCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  const languageName = LANGUAGE_NAMES[normalizeText(normalized)];
  if (languageName) return languageName;
  return /^[a-z]{2,3}(?:-[a-z]{2})?$/.test(normalized) ? normalized : null;
}

export function enrichEventForRouting(input: {
  event: Pick<CanonicalBaseEvent, "name" | "description" | "city" | "enrichment">;
  calendarNames?: string[];
}): EventEnrichment {
  const existing = input.event.enrichment ?? {};
  const sources = { ...(existing.sources ?? {}) };
  const inferredConfidences: number[] = [];
  const calendarText = (input.calendarNames ?? []).join(" ");
  const explicitLocationText = [
    input.event.city,
    existing.region,
    existing.venueName,
    existing.venueAddress,
  ];

  let countryCode = normalizedCountryCode(existing.countryCode);
  if (countryCode) {
    sources.countryCode ??= "provider";
  } else {
    countryCode = inferRoutingCountryCode(...explicitLocationText);
    if (countryCode) {
      sources.countryCode = "event_location";
      inferredConfidences.push(0.95);
    } else {
      countryCode = inferRoutingCountryCode(input.event.name);
      if (countryCode) {
        sources.countryCode = "event_title";
        inferredConfidences.push(0.75);
      } else {
        countryCode = inferRoutingCountryCode(input.event.description);
        if (countryCode) {
          sources.countryCode = "event_description";
          inferredConfidences.push(0.5);
        } else {
          countryCode = inferRoutingCountryCode(calendarText);
          if (countryCode) {
            sources.countryCode = "calendar_name";
            inferredConfidences.push(0.6);
          }
        }
      }
    }
  }

  let region = existing.region?.trim() || null;
  if (!region && /\b(latam|latin america|latinoamerica)\b/i.test(calendarText)) {
    region = "LATAM";
    sources.region = "calendar_name";
    inferredConfidences.push(0.55);
  }

  let languageCode = normalizedLanguageCode(existing.languageCode);
  if (languageCode) {
    sources.languageCode ??= "provider";
  } else {
    languageCode = inferLanguageCode(input.event.name, input.event.description);
    if (languageCode) {
      sources.languageCode = "event_text";
      inferredConfidences.push(0.8);
    }
  }

  let isOnline = existing.isOnline ?? null;
  if (typeof isOnline === "boolean") {
    sources.isOnline ??= "provider";
  } else if (
    onlineSignal(
      input.event.name,
      input.event.description,
      input.event.city,
      existing.format,
      existing.venueName,
    )
  ) {
    isOnline = true;
    sources.isOnline = "event_text";
    inferredConfidences.push(0.85);
  } else if (
    sources.countryCode === "event_location" ||
    existing.venueAddress ||
    input.event.city
  ) {
    isOnline = false;
    sources.isOnline = "event_location";
    inferredConfidences.push(0.85);
  }

  let format = existing.format?.trim() || null;
  if (!format && isOnline === true) {
    format = "online";
    sources.format = sources.isOnline ?? "event_text";
  } else if (!format && isOnline === false) {
    format = "in_person";
    sources.format = sources.isOnline ?? "event_location";
  }

  const languages = [
    ...new Set([...(existing.languages ?? []), ...(languageCode ? [languageCode] : [])]),
  ];
  const inferredConfidence =
    inferredConfidences.length > 0 ? Math.min(...inferredConfidences) : null;
  const confidence =
    existing.confidence === null || existing.confidence === undefined
      ? inferredConfidence
      : inferredConfidence === null
        ? existing.confidence
        : Math.min(existing.confidence, inferredConfidence);

  return {
    ...existing,
    countryCode,
    region,
    languageCode,
    languages,
    isOnline,
    format,
    confidence,
    sources,
  };
}
