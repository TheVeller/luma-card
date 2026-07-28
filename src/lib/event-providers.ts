import type { EventProvider } from "./canonical-events";

export type SupportedProvider = EventProvider;
export type ProviderImportKind = "calendar" | "event" | "profile" | "organizer" | "group";

export type ProviderImportTarget = {
  provider: SupportedProvider;
  kind: ProviderImportKind;
  providerSourceId: string;
  normalizedUrl: string;
  confidence: "certain" | "inferred";
  supportedKinds: ProviderImportKind[];
};

export function providerForUrl(raw: string): SupportedProvider | null {
  try {
    const host = new URL(raw).hostname.replace(/^www\./, "").toLowerCase();
    if (host === "luma.com" || host === "lu.ma") return "luma";
    if (host === "eventbrite.com" || host.includes(".eventbrite.")) return "eventbrite";
    if (host === "meetup.com") return "meetup";
    return null;
  } catch {
    return null;
  }
}

export function providerEventId(provider: SupportedProvider, raw: string): string | null {
  try {
    const url = new URL(raw);
    if (provider === "eventbrite") {
      return url.pathname.match(/\/e\/[^/]*-(\d+)\/?$/i)?.[1] ?? url.searchParams.get("eid");
    }
    if (provider === "meetup") return url.pathname.match(/\/events\/(\d+)\/?$/)?.[1] ?? null;
    return url.pathname.match(/(?:^|\/)(evt-[A-Za-z0-9]+)(?:\/|$)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function providerSourceId(provider: SupportedProvider, raw: string): string {
  const eventId = providerEventId(provider, raw);
  if (eventId) return `${provider}:event:${eventId}`;
  const url = new URL(raw);
  url.search = "";
  url.hash = "";
  return `${provider}:${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/+$/, "")}`;
}

export function detectProviderImportTarget(raw: string): ProviderImportTarget | null {
  const provider = providerForUrl(raw);
  if (!provider) return null;
  const url = new URL(raw);
  url.hash = "";
  const eventId = providerEventId(provider, url.toString());
  let kind: ProviderImportKind;
  let confidence: ProviderImportTarget["confidence"] = "certain";
  let supportedKinds: ProviderImportKind[];

  if (provider === "eventbrite") {
    supportedKinds = ["event", "organizer"];
    kind = eventId ? "event" : "organizer";
  } else if (provider === "meetup") {
    supportedKinds = ["event", "group"];
    kind = eventId ? "event" : "group";
  } else {
    supportedKinds = ["event", "calendar", "profile"];
    const path = url.pathname.replace(/^\/+|\/+$/g, "");
    if (eventId) {
      kind = "event";
    } else if (/^(user|u|profile)\//i.test(path)) {
      kind = "profile";
    } else {
      kind = "calendar";
      if (path && !/^calendar\//i.test(path)) confidence = "inferred";
    }
  }

  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return {
    provider,
    kind,
    providerSourceId: providerSourceId(provider, raw),
    normalizedUrl: url.toString(),
    confidence,
    supportedKinds,
  };
}
