import type { EventProvider } from "./canonical-events";

export type SupportedProvider = EventProvider;

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
      return url.pathname.match(/-(\d+)\/?$/)?.[1] ?? url.searchParams.get("eid");
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
