import type { CanonicalBaseEvent, EventProvider } from "./canonical-events";
import { providerEventId } from "./event-providers";
import { inferRoutingCountryCode } from "./event-routing-enrichment";

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
  discoveredCount?: number;
  readableCount?: number;
  truncated?: boolean;
  warnings?: string[];
  cancelledCount?: number;
  unreadableCount?: number;
  imageSource?: "meetup" | "link_preview" | "favicon" | "event_fallback";
  previewImageUrl?: string | null;
  logoUrl?: string | null;
  sourceMethod?:
    | "provider_api"
    | "provider_public_graphql"
    | "public_jsonld"
    | "firecrawl"
    | "hybrid";
};

export type ProviderSyncScope = { kind: "full" } | { kind: "maintenance"; after: string };

function providerCountryCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : inferRoutingCountryCode(value);
}

function eventbriteEvent(raw: {
  id: string;
  name?: { text?: string };
  description?: { text?: string };
  url?: string;
  start?: { utc?: string };
  end?: { utc?: string };
  logo?: { original?: { url?: string }; url?: string };
  organizer?: { name?: string };
  online_event?: boolean;
  venue?: {
    name?: string;
    address?: {
      city?: string;
      region?: string;
      country_code?: string;
      localized_address_display?: string;
    };
  };
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
      enrichment: {
        countryCode: providerCountryCode(raw.venue?.address?.country_code),
        region: raw.venue?.address?.region ?? null,
        venueName: raw.venue?.name ?? null,
        venueAddress: raw.venue?.address?.localized_address_display ?? null,
        isOnline: raw.online_event ?? null,
        format:
          typeof raw.online_event === "boolean"
            ? raw.online_event
              ? "online"
              : "in_person"
            : null,
        organizer: raw.organizer?.name ?? null,
        confidence: 1,
        sources: {
          countryCode: "eventbrite_api",
          venueName: "eventbrite_api",
          isOnline: "eventbrite_api",
        },
      },
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
  scope: ProviderSyncScope,
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
      expand: "organizer,venue",
      page: String(page),
    });
    if (scope.kind === "full") {
      query.set("time_filter", "all");
    } else {
      query.set("start_date.range_start", scope.after);
    }
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
  venue?: {
    name?: string;
    city?: string;
    state?: string;
    country?: string;
  } | null;
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
  const city = [event.venue?.city, event.venue?.state]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(", ");
  return {
    event: {
      id: event.id,
      name: event.title,
      coverUrl: meetupPhoto(event.featuredEventPhoto),
      url: event.eventUrl,
      startAt: event.dateTime,
      endAt,
      city: city || undefined,
      description: event.description,
      enrichment: {
        countryCode: providerCountryCode(event.venue?.country),
        region: event.venue?.state ?? event.venue?.city ?? null,
        venueName: event.venue?.name ?? null,
        isOnline:
          typeof event.venue?.name === "string" ? /online|virtual/i.test(event.venue.name) : null,
        organizer: event.eventHosts?.[0]?.name ?? null,
        confidence: event.venue ? 1 : null,
        sources: event.venue
          ? {
              countryCode: "meetup_api",
              venueName: "meetup_api",
              isOnline: "meetup_api",
            }
          : {},
      },
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

const MEETUP_PUBLIC_GRAPHQL = "https://www.meetup.com/gql2";
const MEETUP_PUBLIC_PAGE_SIZE = 50;
// Keep a safety stop for a broken cursor, but do not impose a practical
// historical cap on large groups (50 events per page, up to 50k events).
const MEETUP_PUBLIC_MAX_PAGES = 1000;

type MeetupPublicEventNode = MeetupEventNode & {
  endTime?: string;
  status?: string;
  venue?: {
    name?: string;
    city?: string;
    state?: string;
    country?: string;
  } | null;
};

type MeetupPublicPage = {
  data?: {
    groupByUrlname?: {
      id: string;
      name: string;
      description?: string;
      keyGroupPhoto?: { id?: string; baseUrl?: string; highResUrl?: string };
      events?: {
        totalCount: number;
        pageInfo?: { endCursor?: string; hasNextPage?: boolean };
        edges?: Array<{ node: MeetupPublicEventNode }>;
      };
    } | null;
  };
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
};

function meetupPublicPhoto(
  raw?: { id?: string; baseUrl?: string; highResUrl?: string } | null,
): string | null {
  return raw?.highResUrl ?? meetupPhoto(raw);
}

function meetupPublicProviderEvent(event: MeetupPublicEventNode): ProviderEvent | null {
  if (
    event.status === "CANCELLED" ||
    !event.id ||
    !event.title ||
    !event.eventUrl ||
    !event.dateTime
  ) {
    return null;
  }
  const city = [event.venue?.city, event.venue?.state]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(", ");
  return {
    event: {
      id: event.id,
      name: event.title,
      coverUrl: meetupPublicPhoto(event.featuredEventPhoto),
      url: event.eventUrl,
      startAt: event.dateTime,
      endAt: event.endTime,
      city: city || undefined,
      description: event.description,
      enrichment: {
        countryCode: providerCountryCode(event.venue?.country),
        region: event.venue?.state ?? event.venue?.city ?? null,
        venueName: event.venue?.name ?? null,
        isOnline:
          typeof event.venue?.name === "string" ? /online|virtual/i.test(event.venue.name) : null,
        organizer: event.eventHosts?.[0]?.name ?? null,
        confidence: event.venue ? 1 : null,
        sources: event.venue
          ? {
              countryCode: "meetup_public_graphql",
              venueName: "meetup_public_graphql",
              isOnline: "meetup_public_graphql",
            }
          : {},
      },
    },
    externalId: event.id,
    hostName: event.eventHosts?.[0]?.name ?? null,
    payload: {
      source: "meetup-public-graphql",
      status: event.status ?? null,
      groupId: event.group?.id ?? null,
      groupUrlname: event.group?.urlname ?? null,
      venue: event.venue ?? null,
    },
  };
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
  if (Number.isFinite(seconds)) return Math.min(30_000, Math.max(0, seconds * 1000));
  return Math.min(5_000, 500 * 2 ** attempt);
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchMeetupPublicGraphql(
  query: string,
  variables: Record<string, unknown>,
): Promise<MeetupPublicPage> {
  let lastError = "Meetup public request failed";
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(MEETUP_PUBLIC_GRAPHQL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "Mozilla/5.0 (compatible; LumaCard/1.0; +https://luma-card.lovable.app)",
      },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await response.json().catch(() => null)) as MeetupPublicPage | null;
    const rateLimited = body?.errors?.some((error) => error.extensions?.code === "RATE_LIMITED");
    if (response.ok && body?.data && !body.errors?.length) return body;
    lastError = body?.errors?.[0]?.message ?? `Meetup public request failed (${response.status})`;
    if (attempt === 2 || (!rateLimited && response.status !== 429 && response.status < 500)) {
      break;
    }
    await wait(retryDelayMs(response, attempt));
  }
  throw new Error(lastError);
}

function meetupPublicEventsQuery(sort: "ASC" | "DESC"): string {
  return `
  query PublicGroupEvents(
    $urlname: String!
    $after: String
    $afterDateTime: DateTime
    $beforeDateTime: DateTime
  ) {
    groupByUrlname(urlname: $urlname) {
      id
      name
      description
      keyGroupPhoto { id baseUrl highResUrl }
      events(
        filter: {
          status: [ACTIVE, PAST]
          afterDateTime: $afterDateTime
          beforeDateTime: $beforeDateTime
        }
        sort: ${sort}
        first: ${MEETUP_PUBLIC_PAGE_SIZE}
        after: $after
      ) {
        totalCount
        pageInfo { endCursor hasNextPage }
        edges {
          node {
            id
            title
            eventUrl
            description
            dateTime
            endTime
            status
            eventHosts { memberId name }
            featuredEventPhoto { id baseUrl highResUrl }
            venue { name city state country }
            group { id name urlname }
          }
        }
      }
    }
  }
`;
}

type MeetupPublicCollection = {
  events: ProviderEvent[];
  totalCount: number;
  cancelledCount: number;
  unreadableCount: number;
  exhausted: boolean;
  name: string;
  description: string | null;
  photo: string | null;
};

async function fetchMeetupPublicCollection(
  urlname: string,
  boundary: { afterDateTime?: string; beforeDateTime?: string; sort: "ASC" | "DESC" },
  limit: number | null,
): Promise<MeetupPublicCollection> {
  const events: ProviderEvent[] = [];
  let cursor: string | null = null;
  let totalCount = 0;
  let name = urlname;
  let description: string | null = null;
  let photo: string | null = null;
  let exhausted = false;
  let cancelledCount = 0;
  let unreadableCount = 0;

  for (let page = 0; page < MEETUP_PUBLIC_MAX_PAGES; page++) {
    const body = await fetchMeetupPublicGraphql(meetupPublicEventsQuery(boundary.sort), {
      urlname,
      after: cursor,
      afterDateTime: boundary.afterDateTime ?? null,
      beforeDateTime: boundary.beforeDateTime ?? null,
    });
    const group = body.data?.groupByUrlname;
    if (!group) throw new Error("Meetup group was not found or is not publicly accessible");
    name = group.name;
    description = group.description ?? null;
    photo = meetupPublicPhoto(group.keyGroupPhoto);
    const connection = group.events;
    if (!connection) throw new Error("Meetup did not return the group event collection");
    totalCount = connection.totalCount;
    for (const { node } of connection.edges ?? []) {
      if (node.status === "CANCELLED") {
        cancelledCount++;
        continue;
      }
      const event = meetupPublicProviderEvent(node);
      if (event) events.push(event);
      else unreadableCount++;
    }
    if (limit !== null && events.length >= limit) break;
    if (!connection.pageInfo?.hasNextPage || !connection.pageInfo.endCursor) {
      exhausted = true;
      break;
    }
    cursor = connection.pageInfo.endCursor;
  }

  return {
    events: limit === null ? events : events.slice(0, limit),
    totalCount,
    cancelledCount,
    unreadableCount,
    exhausted,
    name,
    description,
    photo,
  };
}

export async function fetchPublicMeetupGroupSnapshot(
  sourceUrl: string,
  limit: number | null,
  scope: ProviderSyncScope,
): Promise<ProviderSnapshot> {
  const urlname = new URL(sourceUrl).pathname.split("/").filter(Boolean)[0]?.toLowerCase();
  if (!urlname) throw new Error("Meetup group URL is required");
  const now = new Date().toISOString();
  const collections =
    scope.kind === "full"
      ? await Promise.all([
          fetchMeetupPublicCollection(urlname, { afterDateTime: now, sort: "ASC" }, limit),
          fetchMeetupPublicCollection(urlname, { beforeDateTime: now, sort: "DESC" }, limit),
        ])
      : [
          await fetchMeetupPublicCollection(
            urlname,
            { afterDateTime: scope.after, sort: "ASC" },
            limit,
          ),
        ];
  const unique = [
    ...new Map(
      collections
        .flatMap((collection) => collection.events)
        .map((event) => [event.externalId, event]),
    ).values(),
  ];
  const discoveredCount = collections.reduce((sum, collection) => sum + collection.totalCount, 0);
  const truncated = limit !== null && discoveredCount > limit;
  const unreadableCount = collections.reduce(
    (sum, collection) => sum + collection.unreadableCount,
    0,
  );
  const complete =
    collections.every((collection) => collection.exhausted) && !truncated && unreadableCount === 0;
  const primary = collections[0];
  return {
    name: primary?.name ?? urlname,
    events: limit === null ? unique : unique.slice(0, limit),
    avatarUrl: primary?.photo ?? null,
    coverUrl: primary?.photo ?? null,
    description: primary?.description ?? null,
    complete,
    discoveredCount,
    readableCount: unique.length,
    cancelledCount: collections.reduce((sum, collection) => sum + collection.cancelledCount, 0),
    unreadableCount,
    truncated,
    warnings: [
      ...(!complete ? ["Meetup pagination did not reconcile with the reported total"] : []),
      ...(unreadableCount > 0 ? [`${unreadableCount} Meetup events could not be read`] : []),
      ...(truncated ? [`Discovery reached the ${limit}-event limit`] : []),
    ],
    sourceMethod: "provider_public_graphql",
  };
}

async function enrichSnapshotBranding(
  provider: Exclude<EventProvider, "luma">,
  sourceUrl: string,
  snapshot: ProviderSnapshot,
): Promise<ProviderSnapshot> {
  // Provider branding wins. Only ask the link-preview service when the
  // provider did not return an image; this keeps normal Meetup pagination
  // cheap and makes the fallback deterministic.
  if (snapshot.avatarUrl && snapshot.coverUrl) return snapshot;
  const { firecrawlScrapeSource, hasFirecrawl } = await import("./firecrawl.server");
  if (!hasFirecrawl()) return snapshot;
  const branding = await firecrawlScrapeSource(sourceUrl);
  const avatarUrl = snapshot.avatarUrl ?? branding.avatarUrl ?? branding.coverUrl ?? null;
  const coverUrl = snapshot.coverUrl ?? branding.coverUrl ?? branding.avatarUrl ?? null;
  if (!avatarUrl && !coverUrl) return snapshot;
  return {
    ...snapshot,
    avatarUrl,
    coverUrl,
    logoUrl: branding.avatarUrl,
    previewImageUrl: branding.coverUrl,
    imageSource:
      snapshot.avatarUrl || snapshot.coverUrl
        ? "meetup"
        : branding.avatarUrl
          ? "link_preview"
          : "favicon",
    sourceMethod:
      snapshot.sourceMethod === "provider_public_graphql" ? "hybrid" : snapshot.sourceMethod,
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
  scope: ProviderSyncScope,
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
                    venue { name city state country }
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
        const pageEvents = (group.events?.edges ?? []).map(({ node }) => meetupProviderEvent(node));
        events.push(
          ...pageEvents.filter(
            ({ event }) =>
              scope.kind === "full" ||
              status === "UPCOMING" ||
              Date.parse(event.startAt) >= Date.parse(scope.after),
          ),
        );
        if (limit !== null && events.length >= limit) break;
        if (
          scope.kind === "maintenance" &&
          status === "PAST" &&
          pageEvents.some(({ event }) => Date.parse(event.startAt) < Date.parse(scope.after))
        ) {
          break;
        }
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
  scope: ProviderSyncScope = { kind: "full" },
): Promise<ProviderSnapshot> {
  return provider === "eventbrite"
    ? eventbriteSnapshot(sourceUrl, token, limit, scope)
    : meetupSnapshot(sourceUrl, token, limit, scope);
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
  const addressCountry =
    address?.addressCountry && typeof address.addressCountry === "object"
      ? (address.addressCountry as Record<string, unknown>).name
      : address?.addressCountry;
  const attendanceMode = typeof raw.eventAttendanceMode === "string" ? raw.eventAttendanceMode : "";
  const locationType = typeof location?.["@type"] === "string" ? String(location["@type"]) : "";
  const hasOnlineSignal =
    /online/i.test(attendanceMode) ||
    /virtuallocation/i.test(locationType) ||
    (typeof location?.name === "string" && /online|virtual/i.test(location.name));
  const isOnline = hasOnlineSignal ? true : address || location ? false : null;
  const language = Array.isArray(raw.inLanguage) ? raw.inLanguage[0] : raw.inLanguage;
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
      enrichment: {
        countryCode: providerCountryCode(addressCountry),
        languageCode: typeof language === "string" ? language.toLowerCase() : null,
        region:
          typeof address?.addressRegion === "string"
            ? address.addressRegion
            : typeof address?.addressLocality === "string"
              ? address.addressLocality
              : null,
        venueName: typeof location?.name === "string" ? location.name : null,
        venueAddress: typeof address?.streetAddress === "string" ? address.streetAddress : null,
        isOnline,
        format: isOnline === true ? "online" : isOnline === false ? "in_person" : null,
        organizer: typeof organizer?.name === "string" ? organizer.name : null,
        confidence: 0.95,
        sources: {
          countryCode: "provider_jsonld",
          languageCode: "provider_jsonld",
          venueName: "provider_jsonld",
          isOnline: "provider_jsonld",
        },
      },
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
      enrichment: scraped.enrichment,
    },
    externalId,
    hostName: scraped.hostName,
    payload: {
      source: `${provider}-public-firecrawl`,
      branding: scraped.branding,
      enrichment: scraped.enrichment,
    },
  };
}

export async function fetchPublicProviderSnapshot(
  provider: Exclude<EventProvider, "luma">,
  sourceUrl: string,
  limit: number | null,
  options: { skipUrls?: string[]; after?: string } = {},
): Promise<ProviderSnapshot> {
  const eventId = providerEventId(provider, sourceUrl);
  let meetupPublicError: Error | null = null;
  if (provider === "meetup" && !eventId) {
    try {
      const snapshot = await fetchPublicMeetupGroupSnapshot(
        sourceUrl,
        limit,
        options.after ? { kind: "maintenance", after: options.after } : { kind: "full" },
      );
      return await enrichSnapshotBranding(provider, sourceUrl, snapshot);
    } catch (error) {
      meetupPublicError = error instanceof Error ? error : new Error(String(error));
      console.warn("[meetup] public GraphQL failed; trying Firecrawl", meetupPublicError.message);
    }
  }
  const { firecrawlDiscoverProviderEvents, firecrawlScrapeSource, hasFirecrawl } =
    await import("./firecrawl.server");
  const fallbackLimit = limit ?? 2000;
  const urls = eventId
    ? [sourceUrl]
    : hasFirecrawl()
      ? await firecrawlDiscoverProviderEvents(sourceUrl, provider, fallbackLimit)
      : [];
  if (urls.length === 0) {
    throw new Error(
      meetupPublicError
        ? `Meetup public sync failed (${meetupPublicError.message}) and Firecrawl found no events.`
        : `No public ${provider} events were found. Connect an organizer token for reliable sync.`,
    );
  }
  const skipUrls = new Set(options.skipUrls ?? []);
  const urlsToRead = urls.filter((url) => !skipUrls.has(url));
  const events: ProviderEvent[] = [];
  let readableCount = 0;
  for (let offset = 0; offset < urlsToRead.length; offset += 5) {
    const batch = await Promise.all(
      urlsToRead.slice(offset, offset + 5).map(async (url) => {
        try {
          return await fetchPublicProviderEvent(provider, url);
        } catch (error) {
          console.warn(`[${provider}] public event skipped`, error);
          return null;
        }
      }),
    );
    const readable = batch.filter((event): event is ProviderEvent => event !== null);
    readableCount += readable.length;
    events.push(
      ...readable.filter(
        ({ event }) => !options.after || Date.parse(event.startAt) >= Date.parse(options.after),
      ),
    );
  }
  if (readableCount === 0 && urlsToRead.length > 0) {
    throw new Error(`No readable ${provider} events were found`);
  }
  const branding = hasFirecrawl() ? await firecrawlScrapeSource(sourceUrl) : null;
  const unreadableCount = urlsToRead.length - readableCount;
  const discoveryLimitReached = !eventId && urls.length >= fallbackLimit;
  const fallbackCannotCertifyHistory = meetupPublicError !== null;
  const meetupPublicFailureMessage = meetupPublicError?.message;
  const truncated = discoveryLimitReached || fallbackCannotCertifyHistory;
  const usedJsonLd = events.some(({ payload }) =>
    String(payload.source ?? "").endsWith("-public-jsonld"),
  );
  const usedFirecrawl = events.some(({ payload }) =>
    String(payload.source ?? "").endsWith("-public-firecrawl"),
  );
  return {
    name:
      branding?.name ??
      events[0]?.hostName ??
      (provider === "eventbrite" ? "Eventbrite" : "Meetup"),
    events,
    avatarUrl: branding?.avatarUrl ?? null,
    coverUrl: branding?.coverUrl ?? events[0]?.event.coverUrl ?? null,
    description: branding?.description ?? null,
    complete: unreadableCount === 0 && !truncated && !fallbackCannotCertifyHistory,
    discoveredCount: urls.length,
    readableCount,
    truncated,
    warnings: [
      ...(unreadableCount > 0 ? [`${unreadableCount} discovered events could not be read`] : []),
      ...(discoveryLimitReached
        ? [`Discovery reached the ${fallbackLimit}-event fallback limit`]
        : []),
      ...(fallbackCannotCertifyHistory
        ? [
            `Meetup public pagination failed (${meetupPublicFailureMessage}); Firecrawl fallback cannot certify complete history`,
          ]
        : []),
    ],
    sourceMethod:
      usedJsonLd && usedFirecrawl
        ? "hybrid"
        : usedFirecrawl
          ? "firecrawl"
          : usedJsonLd
            ? "public_jsonld"
            : "firecrawl",
    logoUrl: branding?.avatarUrl ?? null,
    previewImageUrl: branding?.coverUrl ?? null,
    imageSource: branding?.avatarUrl
      ? "link_preview"
      : branding?.coverUrl
        ? "link_preview"
        : undefined,
  };
}
