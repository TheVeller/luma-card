import type { CanonicalBaseEvent, EventProvider } from "./canonical-events";
import { providerEventId } from "./event-providers";

export type ProviderEvent = {
  event: CanonicalBaseEvent;
  externalId: string;
  hostName: string | null;
  payload: Record<string, unknown>;
};

export type ProviderSnapshot = {
  name: string;
  events: ProviderEvent[];
  avatarUrl: string | null;
  coverUrl: string | null;
  description: string | null;
  complete: boolean;
};

function eventbriteEvent(raw: {
  id: string;
  name?: { text?: string };
  description?: { text?: string };
  url?: string;
  start?: { utc?: string };
  end?: { utc?: string };
  logo?: { original?: { url?: string }; url?: string };
  organizer?: { name?: string };
  venue?: { address?: { city?: string; region?: string } };
}): ProviderEvent | null {
  if (!raw.id || !raw.name?.text || !raw.start?.utc || !raw.url) return null;
  const city = [raw.venue?.address?.city, raw.venue?.address?.region].filter(Boolean).join(", ");
  return {
    event: {
      id: raw.id,
      name: raw.name.text,
      coverUrl: raw.logo?.original?.url ?? raw.logo?.url ?? null,
      url: raw.url,
      startAt: raw.start.utc,
      endAt: raw.end?.utc,
      city: city || undefined,
      description: raw.description?.text,
    },
    externalId: raw.id,
    hostName: raw.organizer?.name ?? null,
    payload: { source: "eventbrite-api" },
  };
}

async function eventbriteSnapshot(
  sourceUrl: string,
  token: string,
  limit: number | null,
): Promise<ProviderSnapshot> {
  const sourceId = providerEventId("eventbrite", sourceUrl);
  if (sourceId) {
    const response = await fetch(
      `https://www.eventbriteapi.com/v3/events/${encodeURIComponent(sourceId)}/?expand=organizer,venue`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) throw new Error(`Eventbrite event request failed (${response.status})`);
    const raw = (await response.json()) as Parameters<typeof eventbriteEvent>[0];
    const event = eventbriteEvent(raw);
    if (!event) throw new Error("Eventbrite returned an incomplete event");
    return {
      name: event.hostName ?? "Eventbrite event",
      events: [event],
      avatarUrl: null,
      coverUrl: event.event.coverUrl,
      description: null,
      complete: true,
    };
  }

  let organizationId = sourceUrl.match(/(?:organizations?|o)\/(?:[^/]*-)?(\d+)(?:\/|$)/i)?.[1];
  let organizationName = "Eventbrite";
  if (!organizationId) {
    const organizations = await fetch("https://www.eventbriteapi.com/v3/users/me/organizations/", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!organizations.ok) {
      throw new Error(`Eventbrite account request failed (${organizations.status})`);
    }
    const body = (await organizations.json()) as {
      organizations?: Array<{ id: string; name?: string }>;
    };
    organizationId = body.organizations?.[0]?.id;
    organizationName = body.organizations?.[0]?.name ?? organizationName;
  }
  if (!organizationId) throw new Error("No Eventbrite organization is available");

  const events: ProviderEvent[] = [];
  for (let page = 1; page <= 100; page++) {
    const query = new URLSearchParams({
      time_filter: "all",
      expand: "organizer,venue",
      page: String(page),
    });
    const response = await fetch(
      `https://www.eventbriteapi.com/v3/organizations/${organizationId}/events/?${query}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) throw new Error(`Eventbrite events request failed (${response.status})`);
    const body = (await response.json()) as {
      events?: Array<Parameters<typeof eventbriteEvent>[0]>;
      pagination?: { has_more_items?: boolean };
    };
    events.push(...(body.events ?? []).flatMap((event) => eventbriteEvent(event) ?? []));
    if ((limit !== null && events.length >= limit) || !body.pagination?.has_more_items) break;
  }
  return {
    name: organizationName,
    events: limit === null ? events : events.slice(0, limit),
    avatarUrl: null,
    coverUrl: events[0]?.event.coverUrl ?? null,
    description: null,
    complete: limit === null,
  };
}

function meetupPhoto(raw?: { id?: string; baseUrl?: string } | null): string | null {
  return raw?.id && raw.baseUrl ? `${raw.baseUrl}${raw.id}/676x380.webp` : null;
}

type MeetupEventNode = {
  id: string;
  title: string;
  eventUrl: string;
  description?: string;
  dateTime: string;
  duration?: string;
  eventHosts?: Array<{ name?: string }>;
  featuredEventPhoto?: { id?: string; baseUrl?: string };
  group?: { id?: string; name?: string; urlname?: string };
};

type MeetupGroupResponse = {
  groupByUrlname?: {
    id: string;
    name: string;
    description?: string;
    keyGroupPhoto?: { id?: string; baseUrl?: string };
    events?: {
      pageInfo?: { endCursor?: string; hasNextPage?: boolean };
      edges?: Array<{ node: MeetupEventNode }>;
    };
  };
};

function meetupProviderEvent(event: MeetupEventNode): ProviderEvent {
  const durationMatch = event.duration?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/);
  const durationMs = durationMatch
    ? (Number(durationMatch[1] ?? 0) * 60 + Number(durationMatch[2] ?? 0)) * 60_000
    : 0;
  const endAt = durationMs
    ? new Date(Date.parse(event.dateTime) + durationMs).toISOString()
    : undefined;
  return {
    event: {
      id: event.id,
      name: event.title,
      coverUrl: meetupPhoto(event.featuredEventPhoto),
      url: event.eventUrl,
      startAt: event.dateTime,
      endAt,
      description: event.description,
    },
    externalId: event.id,
    hostName: event.eventHosts?.[0]?.name ?? null,
    payload: {
      source: "meetup-api",
      groupId: event.group?.id ?? null,
      groupUrlname: event.group?.urlname ?? null,
    },
  };
}

async function meetupGraphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch("https://api.meetup.com/gql-ext", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await response.json()) as { data?: T; errors?: Array<{ message?: string }> };
  if (!response.ok || body.errors?.length || !body.data) {
    throw new Error(body.errors?.[0]?.message ?? `Meetup request failed (${response.status})`);
  }
  return body.data;
}

async function meetupSnapshot(
  sourceUrl: string,
  token: string,
  limit: number | null,
): Promise<ProviderSnapshot> {
  const eventId = providerEventId("meetup", sourceUrl);
  if (!eventId) {
    const urlname = new URL(sourceUrl).pathname.split("/").filter(Boolean)[0];
    if (!urlname) throw new Error("Meetup group URL is required");
    const events: ProviderEvent[] = [];
    let groupName = urlname;
    let groupDescription: string | null = null;
    let groupPhoto: string | null = null;
    for (const status of ["UPCOMING", "PAST"] as const) {
      let cursor: string | null = null;
      for (let page = 0; page < 100; page++) {
        const after = cursor ? ", after: $cursor" : "";
        const responseData: MeetupGroupResponse = await meetupGraphql<MeetupGroupResponse>(
          token,
          `query($urlname: String!${cursor ? ", $cursor: String!" : ""}) {
            groupByUrlname(urlname: $urlname) {
              id name description keyGroupPhoto { id baseUrl }
              events(input: { first: 50${after}, filter: { status: "${status}" } }) {
                pageInfo { endCursor hasNextPage }
                edges {
                  node {
                    id title eventUrl description dateTime duration
                    eventHosts { name }
                    featuredEventPhoto { id baseUrl }
                    group { id name urlname }
                  }
                }
              }
            }
          }`,
          cursor ? { urlname, cursor } : { urlname },
        );
        const group: NonNullable<MeetupGroupResponse["groupByUrlname"]> | undefined =
          responseData.groupByUrlname;
        if (!group) throw new Error("Meetup group was not found or is not accessible");
        groupName = group.name;
        groupDescription = group.description ?? null;
        groupPhoto = meetupPhoto(group.keyGroupPhoto);
        events.push(...(group.events?.edges ?? []).map(({ node }) => meetupProviderEvent(node)));
        if (limit !== null && events.length >= limit) break;
        if (!group.events?.pageInfo?.hasNextPage || !group.events.pageInfo.endCursor) break;
        cursor = group.events.pageInfo.endCursor;
      }
      if (limit !== null && events.length >= limit) break;
    }
    const unique = [...new Map(events.map((event) => [event.externalId, event])).values()];
    return {
      name: groupName,
      events: limit === null ? unique : unique.slice(0, limit),
      avatarUrl: groupPhoto,
      coverUrl: groupPhoto,
      description: groupDescription,
      complete: limit === null,
    };
  }
  const data = await meetupGraphql<{
    event?: MeetupEventNode;
  }>(
    token,
    `query($eventId: ID!) {
      event(id: $eventId) {
        id title eventUrl description dateTime duration
        eventHosts { name }
        featuredEventPhoto { id baseUrl }
        group { id name urlname }
      }
    }`,
    { eventId },
  );
  if (!data.event) throw new Error("Meetup event was not found");
  const photo = meetupPhoto(data.event.featuredEventPhoto);
  return {
    name: data.event.group?.name ?? "Meetup",
    events: [meetupProviderEvent(data.event)],
    avatarUrl: null,
    coverUrl: photo,
    description: null,
    complete: eventId !== null,
  };
}

export async function fetchConnectedProviderSnapshot(
  provider: Exclude<EventProvider, "luma">,
  sourceUrl: string,
  token: string,
  limit: number | null,
): Promise<ProviderSnapshot> {
  return provider === "eventbrite"
    ? eventbriteSnapshot(sourceUrl, token, limit)
    : meetupSnapshot(sourceUrl, token, limit);
}

export async function refreshMeetupAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}> {
  const clientId = process.env.MEETUP_CLIENT_ID;
  const clientSecret = process.env.MEETUP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Meetup token expired and MEETUP_CLIENT_ID/MEETUP_CLIENT_SECRET are missing");
  }
  const response = await fetch("https://secure.meetup.com/oauth2/access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!response.ok || !body.access_token) {
    throw new Error(body.error ?? `Meetup token refresh failed (${response.status})`);
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? refreshToken,
    expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString(),
  };
}

function jsonLdEvents(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap(jsonLdEvents);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (
    record["@type"] === "Event" ||
    (Array.isArray(record["@type"]) && record["@type"].includes("Event"))
  ) {
    return [record];
  }
  return record["@graph"] ? jsonLdEvents(record["@graph"]) : [];
}

function publicJsonLdEvent(
  provider: Exclude<EventProvider, "luma">,
  raw: Record<string, unknown>,
  fallbackUrl: string,
): ProviderEvent | null {
  const startAt = typeof raw.startDate === "string" ? raw.startDate : null;
  const name = typeof raw.name === "string" ? raw.name : null;
  if (!startAt || !name) return null;
  const location =
    raw.location && typeof raw.location === "object"
      ? (raw.location as Record<string, unknown>)
      : null;
  const address =
    location?.address && typeof location.address === "object"
      ? (location.address as Record<string, unknown>)
      : null;
  const organizer =
    raw.organizer && typeof raw.organizer === "object"
      ? (raw.organizer as Record<string, unknown>)
      : null;
  const image = Array.isArray(raw.image) ? raw.image[0] : raw.image;
  const externalId =
    providerEventId(provider, fallbackUrl) ?? String(raw.identifier ?? raw.url ?? fallbackUrl);
  return {
    event: {
      id: `${provider}-${externalId}`,
      name,
      coverUrl: typeof image === "string" ? image : null,
      url: typeof raw.url === "string" ? raw.url : fallbackUrl,
      startAt,
      endAt: typeof raw.endDate === "string" ? raw.endDate : undefined,
      city:
        typeof address?.addressLocality === "string"
          ? address.addressLocality
          : typeof location?.name === "string"
            ? location.name
            : undefined,
      description: typeof raw.description === "string" ? raw.description : undefined,
    },
    externalId,
    hostName: typeof organizer?.name === "string" ? organizer.name : null,
    payload: { source: `${provider}-public-jsonld` },
  };
}

export async function fetchPublicProviderEvent(
  provider: Exclude<EventProvider, "luma">,
  eventUrl: string,
): Promise<ProviderEvent> {
  const response = await fetch(eventUrl, {
    headers: { accept: "text/html", "user-agent": "Mozilla/5.0" },
    redirect: "follow",
  });
  if (response.ok) {
    const html = await response.text();
    for (const match of html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    )) {
      try {
        for (const raw of jsonLdEvents(JSON.parse(match[1]))) {
          const event = publicJsonLdEvent(provider, raw, eventUrl);
          if (event) return event;
        }
      } catch {
        // Try the next JSON-LD block.
      }
    }
  }
  const { firecrawlScrapeEvent, hasFirecrawl } = await import("./firecrawl.server");
  if (!hasFirecrawl()) {
    throw new Error(`Couldn't read this ${provider} event and Firecrawl is not configured`);
  }
  const scraped = await firecrawlScrapeEvent(eventUrl);
  if (!scraped?.startAt) throw new Error(`Couldn't read this ${provider} event`);
  const externalId = providerEventId(provider, eventUrl) ?? eventUrl;
  return {
    event: {
      id: `${provider}-${externalId}`,
      name: scraped.name,
      coverUrl: scraped.coverUrl,
      url: eventUrl,
      startAt: scraped.startAt,
      endAt: scraped.endAt ?? undefined,
      city: scraped.city ?? undefined,
      description: scraped.description ?? undefined,
    },
    externalId,
    hostName: scraped.hostName,
    payload: { source: `${provider}-public-firecrawl`, branding: scraped.branding },
  };
}

export async function fetchPublicProviderSnapshot(
  provider: Exclude<EventProvider, "luma">,
  sourceUrl: string,
  limit: number,
): Promise<ProviderSnapshot> {
  const eventId = providerEventId(provider, sourceUrl);
  const { firecrawlDiscoverProviderEvents, firecrawlScrapeSource, hasFirecrawl } =
    await import("./firecrawl.server");
  const urls = eventId
    ? [sourceUrl]
    : hasFirecrawl()
      ? await firecrawlDiscoverProviderEvents(sourceUrl, provider, limit)
      : [];
  if (urls.length === 0) {
    throw new Error(
      `No public ${provider} events were found. Connect an organizer token for reliable sync.`,
    );
  }
  const events: ProviderEvent[] = [];
  for (let offset = 0; offset < urls.length; offset += 5) {
    const batch = await Promise.all(
      urls.slice(offset, offset + 5).map(async (url) => {
        try {
          return await fetchPublicProviderEvent(provider, url);
        } catch (error) {
          console.warn(`[${provider}] public event skipped`, error);
          return null;
        }
      }),
    );
    events.push(...batch.filter((event): event is ProviderEvent => event !== null));
  }
  if (events.length === 0) throw new Error(`No readable ${provider} events were found`);
  const branding = hasFirecrawl() ? await firecrawlScrapeSource(sourceUrl) : null;
  return {
    name:
      branding?.name ??
      events[0]?.hostName ??
      (provider === "eventbrite" ? "Eventbrite" : "Meetup"),
    events,
    avatarUrl: branding?.avatarUrl ?? null,
    coverUrl: branding?.coverUrl ?? events[0]?.event.coverUrl ?? null,
    description: branding?.description ?? null,
    complete: eventId !== null,
  };
}
