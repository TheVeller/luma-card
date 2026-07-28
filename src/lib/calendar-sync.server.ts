import {
  CURATED_OWNER_EMAIL,
  OWNER_CURATED_SOURCES,
  normalizeSourceUrl,
  sourceCalendarId,
  type CuratedSource,
} from "./owner-curated-catalog";
import { summarizeEventCounts } from "./event-time";

export type SyncSourceRow = {
  id: string;
  user_id: string;
  calendar_id: string;
  calendar_name: string | null;
  curated_name: string | null;
  remote_name: string | null;
  calendar_url: string | null;
  source_kind: "api" | "calendar" | "profile" | "event";
  sync_status: string;
  sync_error: string | null;
  event_limit: number;
  discovered_count: number;
  imported_count: number;
  last_synced_at: string | null;
  last_sync_attempted_at: string | null;
  historical_sync_completed_at: string | null;
  last_sync_scope: "full" | "maintenance" | null;
  next_sync_at: string | null;
  source_metadata: Record<string, string | number | boolean | null> | null;
  calendar_avatar_url: string | null;
  calendar_cover_url: string | null;
  calendar_description: string | null;
  calendar_tint_color: string | null;
  metadata_version: number;
  group_id: string | null;
  sort_order: number;
  suggested_group_name: string | null;
  suggested_group_reason: string | null;
  luma_calendar_id: string | null;
  merged_into_id: string | null;
  source: "api" | "scrape";
  organization_manual: boolean;
  provider: "luma" | "eventbrite" | "meetup";
  provider_source_id: string | null;
  provider_connection_id: string | null;
  ownership: "connected" | "external";
  sync_all_events: boolean;
  brand_kit_id: string | null;
};

const SOURCE_COLUMNS =
  "id,user_id,calendar_id,calendar_name,curated_name,remote_name,calendar_url,source_kind,sync_status,sync_error,event_limit,discovered_count,imported_count,last_synced_at,last_sync_attempted_at,historical_sync_completed_at,last_sync_scope,next_sync_at,source_metadata,calendar_avatar_url,calendar_cover_url,calendar_description,calendar_tint_color,metadata_version,group_id,sort_order,suggested_group_name,suggested_group_reason,luma_calendar_id,merged_into_id,source,organization_manual,provider,provider_source_id,provider_connection_id,ownership,sync_all_events,brand_kit_id";

const CALENDAR_METADATA_VERSION = 1;
const MAINTENANCE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export type RequestedSyncScope = "auto" | "full" | "maintenance";
export type ResolvedSyncScope = { kind: "full" } | { kind: "maintenance"; after: string };

export function maintenanceAfter(now = Date.now()): string {
  return new Date(now - MAINTENANCE_LOOKBACK_MS).toISOString();
}

export function resolveSyncScope(
  historicalSyncCompletedAt: string | null,
  requested: RequestedSyncScope,
  now = Date.now(),
): ResolvedSyncScope {
  if (requested === "full" || !historicalSyncCompletedAt) return { kind: "full" };
  return { kind: "maintenance", after: maintenanceAfter(now) };
}

function suggestedGroup(source: SyncSourceRow, description: string | null) {
  const text = `${source.curated_name ?? ""} ${source.calendar_name ?? ""} ${description ?? ""}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  const rules: Array<[string, RegExp, string]> = [
    ["Personal", /\b(personal|ignacio|profile)\b/, "Personal calendar or profile"],
    [
      "Education",
      /\b(university|universidad|utec|utp|unsa|udep|student|education|educacion|dsc)\b/,
      "Education or university community",
    ],
    [
      "Startups & Venture",
      /\b(startup|founder|venture|capital|endeavor|growth|emprende|30x)\b/,
      "Startup, founder, or investment focus",
    ],
    [
      "Regional Tech",
      /\b(latam|peru|lima|arequipa|aqp|mexico|mx|bilbao|suyo)\b/,
      "Regional technology ecosystem",
    ],
    [
      "AI & Dev Tools",
      /\b(ai|ia |cursor|claude|codex|openai|supabase|vercel|n8n|notion|clerk|prisma|devin|elevenlabs|data)\b/,
      "AI or developer-tool ecosystem",
    ],
  ];
  const match = rules.find(([, pattern]) => pattern.test(text));
  return match
    ? { name: match[0], reason: match[2] }
    : { name: "Communities", reason: "Community and meetup calendar" };
}

export async function ensureOwnerCuratedCatalog(userId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: user } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (user.user?.email?.toLowerCase() !== CURATED_OWNER_EMAIL) return;

  for (const [index, source] of OWNER_CURATED_SOURCES.entries()) {
    const row = await ensureCuratedSourceRow(userId, source, index);
    if (
      (row.metadata_version ?? 0) < CALENDAR_METADATA_VERSION ||
      !row.calendar_avatar_url ||
      ((row.imported_count ?? 0) === 0 && !row.source_metadata?.emptyConfirmed)
    ) {
      await enqueueSource(userId, row.id, "initial");
    }
  }
}

async function ensureCuratedSourceRow(
  userId: string,
  source: CuratedSource,
  sortOrder: number,
): Promise<SyncSourceRow> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { lumaCalendarIdFromValues } = await import("./calendar-identity");
  const { resolveCanonicalCalendarRowId, registerLumaCalendarIdentity, addCalendarAliases } =
    await import("./calendar-identity.server");
  const calendarId = sourceCalendarId(source);
  const calendarUrl = normalizeSourceUrl(source.url);
  const identity = lumaCalendarIdFromValues({ calendarId, url: calendarUrl });
  const existingId =
    (identity && (await resolveCanonicalCalendarRowId(userId, identity))) ||
    (await resolveCanonicalCalendarRowId(userId, calendarId)) ||
    (await resolveCanonicalCalendarRowId(userId, calendarUrl));
  const values = {
    user_id: userId,
    ...(existingId
      ? {}
      : {
          calendar_id: calendarId,
          calendar_name: source.name,
          calendar_url: calendarUrl,
          source: "scrape",
          source_kind: source.kind,
        }),
    event_limit: source.kind === "profile" ? 500 : 80,
    sync_all_events: /luma\.com\/cursorcommunity(?:[/?#]|$)/i.test(source.url),
    sync_enabled: true,
    ...(existingId
      ? {}
      : {
          is_default: false,
          sort_order: sortOrder,
          next_sync_at: new Date().toISOString(),
        }),
    updated_at: new Date().toISOString(),
  };
  const query = existingId
    ? supabaseAdmin
        .from("user_luma_calendars" as never)
        .update(values as never)
        .eq("id", existingId)
        .eq("user_id", userId)
    : supabaseAdmin
        .from("user_luma_calendars" as never)
        .upsert(values as never, { onConflict: "user_id,calendar_id" });
  const { data, error } = await query.select(SOURCE_COLUMNS).single();
  if (error) throw new Error(error.message);
  let row = data as unknown as SyncSourceRow;
  // Never overwrite a user's manually curated display name.
  if (!row.organization_manual && row.curated_name !== source.name) {
    const { data: named, error: nameError } = await supabaseAdmin
      .from("user_luma_calendars" as never)
      .update({ curated_name: source.name } as never)
      .eq("id", row.id)
      .select(SOURCE_COLUMNS)
      .single();
    if (nameError) throw new Error(nameError.message);
    row = named as unknown as SyncSourceRow;
  }
  if (identity) {
    const winnerId = await registerLumaCalendarIdentity(userId, row.id, identity);
    if (winnerId !== row.id) {
      const { data: winner, error: winnerError } = await supabaseAdmin
        .from("user_luma_calendars" as never)
        .select(SOURCE_COLUMNS)
        .eq("id", winnerId)
        .single();
      if (winnerError) throw new Error(winnerError.message);
      row = winner as unknown as SyncSourceRow;
    }
  }
  await addCalendarAliases(userId, row.id, [
    { value: calendarId, kind: "legacy_id" },
    { value: calendarUrl, kind: "url" },
    { value: identity, kind: "luma_id" },
  ]);
  return row;
}

export async function listSyncSourcesForUser(userId: string): Promise<SyncSourceRow[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_luma_calendars" as never)
    .select(SOURCE_COLUMNS)
    .eq("user_id", userId)
    .is("merged_into_id", null)
    .order("curated_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as SyncSourceRow[] | null) ?? [];
}

export async function upsertCuratedSources(
  userId: string,
  sources: CuratedSource[],
): Promise<number> {
  let count = 0;
  for (const [index, source] of sources.entries()) {
    const row = await ensureCuratedSourceRow(userId, source, index);
    await enqueueSource(userId, row.id, "manual");
    count++;
  }
  return count;
}

export async function enqueueSource(
  userId: string,
  sourceId: string,
  trigger: "initial" | "manual" | "scheduled",
  batchId?: string,
  syncScope: RequestedSyncScope = "auto",
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("event_sync_jobs" as never).insert({
    user_id: userId,
    source_id: sourceId,
    batch_id: batchId ?? crypto.randomUUID(),
    trigger,
    sync_scope: syncScope,
    status: "queued",
    scheduled_at: new Date().toISOString(),
  } as never);
  if (error?.code === "23505") return;
  if (error) throw new Error(error.message);
  await supabaseAdmin
    .from("user_luma_calendars" as never)
    .update({ sync_status: "queued", sync_error: null } as never)
    .eq("id", sourceId)
    .eq("user_id", userId);
}

export async function enqueueAllSources(
  userId: string,
  trigger: "manual" | "scheduled",
  syncScope: RequestedSyncScope = "auto",
): Promise<{ batchId: string; queued: number }> {
  const sources = await listSyncSourcesForUser(userId);
  const batchId = crypto.randomUUID();
  for (const source of sources) {
    await enqueueSource(userId, source.id, trigger, batchId, syncScope);
  }
  return { batchId, queued: sources.length };
}

async function upsertScrapedRows(
  userId: string,
  source: SyncSourceRow,
  rows: Array<Record<string, unknown>>,
  syncedAt = new Date().toISOString(),
) {
  if (rows.length === 0) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const values = rows.map((row) => ({
    ...row,
    user_id: userId,
    calendar_id: source.id,
    updated_at: syncedAt,
  }));
  const result = await supabaseAdmin
    .from("scraped_events" as never)
    .upsert(values as never, { onConflict: "user_id,calendar_id,event_key" });
  if (result.error) throw new Error(result.error.message);

  const { tryUpsertCanonicalEventSource } = await import("./canonical-events.server");
  for (let offset = 0; offset < rows.length; offset += 10) {
    await Promise.all(
      rows.slice(offset, offset + 10).map((row) => {
        const eventKey = String(row.event_key);
        const externalEventId =
          typeof (row.payload as Record<string, unknown> | undefined)?.externalEventId === "string"
            ? String((row.payload as Record<string, unknown>).externalEventId)
            : eventKey;
        const sourceType =
          source.provider === "eventbrite"
            ? source.ownership === "connected"
              ? "eventbrite_api"
              : "eventbrite_public"
            : source.provider === "meetup"
              ? source.ownership === "connected"
                ? "meetup_api"
                : "meetup_public"
              : source.source_kind === "profile"
                ? "profile_scrape"
                : "calendar_scrape";
        return tryUpsertCanonicalEventSource(userId, {
          event: {
            id: eventKey,
            name: String(row.name),
            coverUrl: typeof row.cover_url === "string" ? row.cover_url : null,
            url: String(row.source_url),
            startAt: typeof row.start_at === "string" ? row.start_at : new Date().toISOString(),
            endAt: typeof row.end_at === "string" ? row.end_at : undefined,
            city: typeof row.city === "string" ? row.city : undefined,
            description: typeof row.description === "string" ? row.description : undefined,
            calendarId: source.calendar_id,
            calendarName: source.curated_name ?? source.calendar_name ?? undefined,
          },
          sourceType,
          provider: source.provider,
          calendarRowId: source.id,
          calendarId: source.calendar_id,
          calendarName: source.curated_name ?? source.calendar_name,
          sourceUrl: String(row.source_url),
          externalEventId,
          hostName: typeof row.host_name === "string" ? row.host_name : null,
          payload:
            row.payload && typeof row.payload === "object"
              ? (row.payload as Record<string, unknown>)
              : {},
          lastSyncedAt: syncedAt,
        });
      }),
    );
  }
}

async function finalizeScopedSync(
  userId: string,
  source: SyncSourceRow,
  runStartedAt: string,
  sourceTypes: string[],
  scope: ResolvedSyncScope,
  removeScrapedSources = false,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.rpc(
    "finalize_scoped_calendar_sync" as never,
    {
      p_user_id: userId,
      p_calendar_row_id: source.id,
      p_run_started_at: runStartedAt,
      p_source_types: sourceTypes,
      p_after: scope.kind === "maintenance" ? scope.after : null,
      p_remove_scraped_sources: removeScrapedSources,
    } as never,
  );
  if (error) throw new Error(error.message);
}

async function syncConnectedProvider(
  userId: string,
  source: SyncSourceRow,
  scope: ResolvedSyncScope,
) {
  if (source.provider === "luma" || !source.provider_connection_id) {
    throw new Error("Provider connection is unavailable");
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: connection, error } = await supabaseAdmin
    .from("provider_connections" as never)
    .select("access_token_ciphertext,refresh_token_ciphertext,token_expires_at")
    .eq("id", source.provider_connection_id)
    .eq("user_id", userId)
    .single();
  if (error || !connection) throw new Error(error?.message ?? "Provider connection not found");
  const { decryptString } = await import("./crypto.server");
  const stored = connection as {
    access_token_ciphertext: string;
    refresh_token_ciphertext: string | null;
    token_expires_at: string | null;
  };
  let token = decryptString(stored.access_token_ciphertext);
  const { fetchConnectedProviderSnapshot, refreshMeetupAccessToken } =
    await import("./event-providers.server");
  if (
    source.provider === "meetup" &&
    stored.refresh_token_ciphertext &&
    (!stored.token_expires_at || Date.parse(stored.token_expires_at) <= Date.now() + 60_000)
  ) {
    const refreshed = await refreshMeetupAccessToken(
      decryptString(stored.refresh_token_ciphertext),
    );
    const { encryptString } = await import("./crypto.server");
    token = refreshed.accessToken;
    const { error: refreshError } = await supabaseAdmin
      .from("provider_connections" as never)
      .update({
        access_token_ciphertext: encryptString(refreshed.accessToken),
        refresh_token_ciphertext: encryptString(refreshed.refreshToken),
        token_expires_at: refreshed.expiresAt,
      } as never)
      .eq("id", source.provider_connection_id)
      .eq("user_id", userId);
    if (refreshError) throw new Error(refreshError.message);
  }
  const runStartedAt = new Date().toISOString();
  const snapshot = await fetchConnectedProviderSnapshot(
    source.provider,
    source.calendar_url ?? "",
    token,
    scope.kind === "maintenance" || source.sync_all_events ? null : source.event_limit || 80,
    scope,
  );
  const rows = snapshot.events.map(({ event, externalId, hostName, payload }) => ({
    event_key: `${source.provider}-${externalId}`,
    source_url: event.url,
    name: event.name,
    description: event.description ?? null,
    cover_url: event.coverUrl,
    city: event.city ?? null,
    start_at: event.startAt,
    end_at: event.endAt ?? null,
    host_name: hostName,
    payload: { ...payload, externalEventId: externalId, provider: source.provider },
  }));
  await upsertScrapedRows(userId, source, rows, runStartedAt);
  if (snapshot.complete) {
    const sourceTypes = source.provider === "eventbrite" ? ["eventbrite_api"] : ["meetup_api"];
    await finalizeScopedSync(userId, source, runStartedAt, sourceTypes, scope);
  }
  return {
    discovered: rows.length,
    imported: rows.length,
    remoteName: snapshot.name,
    avatarUrl: snapshot.avatarUrl,
    coverUrl: snapshot.coverUrl,
    description: snapshot.description,
    tintColor: null,
    metadata: {
      provider: source.provider,
      providerSourceId: source.provider_source_id,
      ingestion: `${source.provider}-api`,
      syncScope: scope.kind,
      authoritativeSnapshotAt: runStartedAt,
      emptyConfirmed: rows.length === 0,
      nextEventAt:
        rows
          .map((row) => row.start_at)
          .filter((value) => Date.parse(value) >= Date.now())
          .sort()[0] ?? null,
    },
    partial: !snapshot.complete,
    warning: null,
    historicalComplete: scope.kind === "full" && snapshot.complete,
  };
}

async function syncPublicProvider(userId: string, source: SyncSourceRow, scope: ResolvedSyncScope) {
  if (source.provider === "luma") throw new Error("Public provider source is invalid");
  const { fetchPublicProviderSnapshot } = await import("./event-providers.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const runStartedAt = new Date().toISOString();
  let skipUrls: string[] = [];
  if (scope.kind === "maintenance") {
    const { data: oldCached } = await supabaseAdmin
      .from("scraped_events" as never)
      .select("source_url")
      .eq("user_id", userId)
      .eq("calendar_id", source.id)
      .lt("start_at", scope.after);
    skipUrls = ((oldCached as Array<{ source_url: string }> | null) ?? []).map(
      ({ source_url }) => source_url,
    );
  }
  const snapshot = await fetchPublicProviderSnapshot(
    source.provider,
    source.calendar_url ?? "",
    source.sync_all_events ? 2000 : source.event_limit || 80,
    {
      skipUrls,
      after: scope.kind === "maintenance" ? scope.after : undefined,
    },
  );
  const rows = snapshot.events.map(({ event, externalId, hostName, payload }) => ({
    event_key: `${source.provider}-${externalId}`,
    source_url: event.url,
    name: event.name,
    description: event.description ?? null,
    cover_url: event.coverUrl,
    city: event.city ?? null,
    start_at: event.startAt,
    end_at: event.endAt ?? null,
    host_name: hostName,
    payload: { ...payload, externalEventId: externalId, provider: source.provider },
  }));
  await upsertScrapedRows(userId, source, rows, runStartedAt);
  if (snapshot.complete) {
    await finalizeScopedSync(
      userId,
      source,
      runStartedAt,
      [source.provider === "eventbrite" ? "eventbrite_public" : "meetup_public"],
      scope,
    );
  }
  return {
    discovered: rows.length,
    imported: rows.length,
    remoteName: snapshot.name,
    avatarUrl: snapshot.avatarUrl,
    coverUrl: snapshot.coverUrl,
    description: snapshot.description,
    tintColor: null,
    metadata: {
      provider: source.provider,
      providerSourceId: source.provider_source_id,
      ingestion: `${source.provider}-public`,
      syncScope: scope.kind,
      emptyConfirmed: rows.length === 0,
      nextEventAt:
        rows
          .map((row) => row.start_at)
          .filter((value) => Date.parse(value) >= Date.now())
          .sort()[0] ?? null,
    },
    partial: !snapshot.complete,
    warning: null,
    historicalComplete: scope.kind === "full" && snapshot.complete,
  };
}

async function syncApiCalendar(userId: string, source: SyncSourceRow, scope: ResolvedSyncScope) {
  const { resolveKeyForCalendar } = await import("./user-luma-calendars.functions");
  const resolved = await resolveKeyForCalendar(userId, source.calendar_id);
  if (!resolved?.key) throw new Error("Luma API key is unavailable for this calendar");
  const { fetchAllEvents, fetchCalendar } = await import("./luma.server");
  const runStartedAt = new Date().toISOString();
  let calendar;
  let events: Awaited<ReturnType<typeof import("./luma.server").fetchAllEvents>>["events"] = [];
  let apiComplete = false;
  let apiPages = 0;
  try {
    const [cal, snapshot] = await Promise.all([
      fetchCalendar(resolved.key),
      fetchAllEvents(resolved.key, scope),
    ]);
    calendar = cal;
    events = snapshot.events;
    apiComplete = snapshot.complete;
    apiPages = snapshot.pages;
  } catch (error) {
    const apiError = error instanceof Error ? error.message : String(error);
    if (!source.calendar_url) throw error;
    try {
      const fallback = await syncCalendar(userId, source, scope);
      return {
        ...fallback,
        partial: true,
        warning: `Luma API unavailable; public link used instead. ${apiError}`,
        metadata: {
          ...fallback.metadata,
          ingestion: "luma-public-fallback",
          apiAuthStatus: /\[(401|403)\]/.test(apiError) ? "needs_attention" : "connected",
          apiError,
        },
      };
    } catch (fallbackError) {
      const linkError =
        fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`${apiError}; public link fallback failed: ${linkError}`);
    }
  }
  const { upsertCanonicalEventSource } = await import("./canonical-events.server");
  for (let offset = 0; offset < events.length; offset += 10) {
    await Promise.all(
      events.slice(offset, offset + 10).map((event) =>
        upsertCanonicalEventSource(userId, {
          event: {
            id: event.api_id,
            name: event.name,
            coverUrl: event.cover_url,
            url: event.url,
            startAt: event.start_at,
            endAt: event.end_at,
            city: event.geo_address_info?.city_state,
            description: event.description_md,
            calendarId: source.calendar_id,
            calendarName: calendar.name,
          },
          sourceType: "api",
          calendarRowId: source.id,
          calendarId: source.calendar_id,
          calendarName: calendar.name,
          sourceUrl: event.url,
          externalEventId: event.api_id,
          payload: {
            source: "luma-api",
            timezone: event.timezone ?? null,
            access: event.access ?? "manage",
            platform: event.platform ?? "luma",
            originCalendarId: event.calendar_id ?? null,
          },
          lastSyncedAt: runStartedAt,
        }),
      ),
    );
  }
  await finalizeScopedSync(userId, source, runStartedAt, ["api"], scope, true);
  const upcoming = events
    .map((event) => event.start_at)
    .filter((value) => Date.parse(value) >= Date.now())
    .sort()[0];
  return {
    discovered: events.length,
    imported: events.length,
    remoteName: calendar.name,
    avatarUrl: calendar.avatar_url,
    coverUrl: calendar.cover_image_url,
    description: source.calendar_description,
    tintColor: source.calendar_tint_color,
    metadata: {
      lumaCalendarId: calendar.id,
      slug: calendar.slug,
      ingestion: "luma-api",
      syncScope: scope.kind,
      apiAuthStatus: "connected",
      authoritativeSnapshotAt: runStartedAt,
      emptyConfirmed: events.length === 0,
      nextEventAt: upcoming ?? null,
    },
    partial: false,
    warning: null,
    historicalComplete: scope.kind === "full",
  };
}

async function syncCalendar(userId: string, source: SyncSourceRow, scope: ResolvedSyncScope) {
  const { resolveLumaCalendar, fetchPublicCalendarEventSnapshot } =
    await import("./luma-public.server");
  const calendar = await resolveLumaCalendar(source.calendar_url ?? "");
  if (!calendar) throw new Error("Calendar is not publicly accessible");
  const runStartedAt = new Date().toISOString();
  let eventSnapshot: Awaited<ReturnType<typeof fetchPublicCalendarEventSnapshot>> | null = null;
  let events: Awaited<ReturnType<typeof fetchPublicCalendarEventSnapshot>>["events"] = [];
  let publicError: string | null = null;
  try {
    eventSnapshot = await fetchPublicCalendarEventSnapshot(
      calendar.apiId,
      scope.kind === "maintenance" || source.sync_all_events ? null : source.event_limit || 80,
      scope,
    );
    events = eventSnapshot.events;
  } catch (error) {
    publicError = error instanceof Error ? error.message : String(error);
  }
  const fallbackRows: Array<Record<string, unknown>> = [];
  let sourceBranding: Awaited<
    ReturnType<(typeof import("./firecrawl.server"))["firecrawlScrapeSource"]>
  > | null = null;
  if (events.length === 0) {
    const {
      firecrawlDiscoverLumaEvents,
      firecrawlScrapeEvent,
      firecrawlScrapeSource,
      hasFirecrawl,
    } = await import("./firecrawl.server");
    if (!hasFirecrawl() && publicError) throw new Error(publicError);
    const urls = await firecrawlDiscoverLumaEvents(
      source.calendar_url ?? calendar.url,
      source.event_limit || 80,
    );
    sourceBranding = await firecrawlScrapeSource(source.calendar_url ?? calendar.url);
    for (let offset = 0; offset < urls.length; offset += 5) {
      const scraped = await Promise.all(
        urls.slice(offset, offset + 5).map(async (eventUrl) => {
          const event = await firecrawlScrapeEvent(eventUrl);
          if (!event) return null;
          return {
            event_key: `scr-${stableHash(eventUrl)}`,
            source_url: eventUrl,
            name: event.name,
            description: event.description,
            cover_url: event.coverUrl,
            city: event.city,
            start_at: event.startAt,
            end_at: event.endAt,
            host_name: event.hostName,
            payload: {
              source: "calendar-firecrawl-fallback",
              externalEventId: null,
              branding: event.branding ?? null,
            },
          };
        }),
      );
      fallbackRows.push(...scraped.filter((row): row is NonNullable<typeof row> => row !== null));
    }
  }
  const rows =
    events.length > 0
      ? events.map((event) => ({
          event_key: event.apiId,
          source_url: event.url,
          name: event.name,
          description: null,
          cover_url: event.coverUrl,
          city: event.city,
          start_at: event.startAt,
          end_at: event.endAt,
          host_name: event.hostNames[0] ?? null,
          payload: {
            source: "luma-public-api",
            externalEventId: event.apiId,
            listedByCalendarId: calendar.apiId,
            originCalendarApiId: event.originCalendarApiId,
            hostIds: event.hostIds,
            hostNames: event.hostNames,
          },
        }))
      : fallbackRows;
  await upsertScrapedRows(userId, source, rows, runStartedAt);
  if (!publicError) {
    await finalizeScopedSync(userId, source, runStartedAt, ["calendar_scrape"], scope);
  }
  const temporalCounts = summarizeEventCounts(
    rows.map((row) => ({
      startAt: typeof row.start_at === "string" ? row.start_at : "",
      endAt: typeof row.end_at === "string" ? row.end_at : null,
    })),
  );
  return {
    discovered: rows.length,
    imported: rows.length,
    remoteName: calendar.name,
    avatarUrl: calendar.avatarUrl ?? sourceBranding?.avatarUrl ?? sourceBranding?.coverUrl ?? null,
    coverUrl: calendar.coverUrl ?? sourceBranding?.coverUrl ?? null,
    description: calendar.description ?? sourceBranding?.description ?? null,
    tintColor: calendar.tintColor,
    metadata: {
      lumaCalendarId: calendar.apiId,
      slug: calendar.slug,
      timezone: calendar.timezone,
      personalUserId: calendar.personalUserId,
      personalUsername: calendar.personalUsername,
      ingestion: events.length > 0 ? "luma-public-api" : "firecrawl-fallback",
      syncScope: scope.kind,
      eventCounts: temporalCounts,
      pagination: eventSnapshot
        ? {
            futurePages: eventSnapshot.pages.future,
            pastPages: eventSnapshot.pages.past,
            futureEntries: eventSnapshot.entries.future,
            pastEntries: eventSnapshot.entries.past,
            exhausted: true,
          }
        : null,
      emptyConfirmed: rows.length === 0,
      publicError,
      nextEventAt:
        rows
          .map((row) => (typeof row.start_at === "string" ? row.start_at : null))
          .filter((value): value is string => Boolean(value))
          .filter((value) => Date.parse(value) >= Date.now())
          .sort()[0] ?? null,
    },
    partial: publicError !== null && rows.length > 0,
    warning: publicError,
    historicalComplete: scope.kind === "full" && publicError === null,
  };
}

async function profileHostedCount(url: string): Promise<number | null> {
  const response = await fetch(url, { headers: { accept: "text/html" } });
  if (!response.ok) return null;
  const html = await response.text();
  const count = html.match(/"hosted_count"\s*:\s*(\d+)/)?.[1];
  return count ? Number(count) : null;
}

async function syncProfile(userId: string, source: SyncSourceRow, scope: ResolvedSyncScope) {
  const { firecrawlDiscoverLumaEvents, firecrawlScrapeEvent, firecrawlScrapeSource, hasFirecrawl } =
    await import("./firecrawl.server");
  if (!hasFirecrawl()) throw new Error("FIRECRAWL_API_KEY missing");
  const url = source.calendar_url ?? "";
  const sourceBranding = await firecrawlScrapeSource(url);
  const profileUsername = new URL(url).pathname.split("/").filter(Boolean).at(-1)?.toLowerCase();
  const hostedCount = await profileHostedCount(url);
  const target = Math.min(Math.max(hostedCount ?? 80, 80), source.event_limit || 500);
  const urls = await firecrawlDiscoverLumaEvents(url, target);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: cached } = await supabaseAdmin
    .from("scraped_events" as never)
    .select("source_url,start_at,updated_at")
    .eq("user_id", userId)
    .eq("calendar_id", source.id);
  const cachedByUrl = new Map(
    (
      (cached as Array<{
        source_url: string;
        start_at: string | null;
        updated_at: string;
      }> | null) ?? []
    ).map((row) => [row.source_url, row]),
  );
  const { data: siblingSources } = await supabaseAdmin
    .from("user_luma_calendars" as never)
    .select(
      "calendar_name,calendar_avatar_url,calendar_cover_url,calendar_description,source_metadata",
    )
    .eq("user_id", userId);
  const relatedPersonal = (
    (siblingSources as Array<{
      calendar_name: string | null;
      calendar_avatar_url: string | null;
      calendar_cover_url: string | null;
      calendar_description: string | null;
      source_metadata: {
        personalUserId?: string | null;
        personalUsername?: string | null;
      } | null;
    }> | null) ?? []
  ).find(
    (candidate) =>
      Boolean(candidate.source_metadata?.personalUserId) &&
      candidate.source_metadata?.personalUsername?.toLowerCase() === profileUsername,
  );
  const staleBefore = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const toScrape = urls.filter((eventUrl) => {
    const row = cachedByUrl.get(eventUrl);
    if (!row) return true;
    return Date.parse(row.updated_at) < staleBefore && Date.parse(row.start_at ?? "") >= Date.now();
  });
  const rows: Array<Record<string, unknown>> = [];
  for (let offset = 0; offset < toScrape.length; offset += 5) {
    const batch = await Promise.all(
      toScrape.slice(offset, offset + 5).map(async (eventUrl) => {
        const event = await firecrawlScrapeEvent(eventUrl);
        if (!event) return null;
        return {
          event_key: `scr-${stableHash(eventUrl)}`,
          source_url: eventUrl,
          name: event.name,
          description: event.description,
          cover_url: event.coverUrl,
          city: event.city,
          start_at: event.startAt,
          end_at: event.endAt,
          host_name: event.hostName,
          payload: { source: "profile", profileUrl: url, branding: event.branding ?? null },
        };
      }),
    );
    for (const row of batch) {
      if (row) rows.push(row);
    }
  }
  if (relatedPersonal?.source_metadata?.personalUserId) {
    const { data: hostedRows } = await supabaseAdmin
      .from("scraped_events" as never)
      .select(
        "event_key,source_url,name,description,cover_url,city,start_at,end_at,host_name,payload",
      )
      .eq("user_id", userId);
    const personalUserId = relatedPersonal.source_metadata.personalUserId;
    for (const hosted of (hostedRows as Array<Record<string, unknown>> | null) ?? []) {
      const payload =
        hosted.payload && typeof hosted.payload === "object"
          ? (hosted.payload as Record<string, unknown>)
          : {};
      if (!Array.isArray(payload.hostIds) || !payload.hostIds.includes(personalUserId)) continue;
      if (rows.some((row) => row.source_url === hosted.source_url)) continue;
      rows.push({
        ...hosted,
        payload: { ...payload, source: "profile-host-match", profileUrl: url },
      });
    }
  }
  await upsertScrapedRows(userId, source, rows);
  const importedUrls = new Set(cachedByUrl.keys());
  for (const row of rows) importedUrls.add(String(row.source_url));
  return {
    discovered: urls.length,
    imported: importedUrls.size,
    remoteName:
      sourceBranding.name ??
      relatedPersonal?.calendar_name ??
      source.remote_name ??
      source.curated_name ??
      "Luma profile",
    avatarUrl:
      sourceBranding.avatarUrl ??
      relatedPersonal?.calendar_avatar_url ??
      sourceBranding.coverUrl ??
      null,
    coverUrl: sourceBranding.coverUrl ?? relatedPersonal?.calendar_cover_url ?? null,
    description: sourceBranding.description ?? relatedPersonal?.calendar_description ?? null,
    tintColor: null,
    metadata: {
      hostedCount,
      target,
      refreshed: rows.length,
      syncScope: scope.kind,
      emptyConfirmed: urls.length === 0 && rows.length === 0 && importedUrls.size === 0,
      nextEventAt:
        [...cachedByUrl.values(), ...rows]
          .map((row) =>
            "start_at" in row && typeof row.start_at === "string" ? row.start_at : null,
          )
          .filter((value): value is string => Boolean(value))
          .filter((value) => Date.parse(value) >= Date.now())
          .sort()[0] ?? null,
    },
    partial: hostedCount !== null && urls.length < hostedCount,
    warning: null,
    historicalComplete:
      scope.kind === "full" && !(hostedCount !== null && urls.length < hostedCount),
  };
}

function stableHash(value: string): string {
  let hash = 5381;
  for (const char of value) hash = ((hash << 5) + hash + char.charCodeAt(0)) | 0;
  return Math.abs(hash).toString(36);
}

export async function processNextSyncJob(userId?: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let query = supabaseAdmin
    .from("event_sync_jobs" as never)
    .select("id,user_id,source_id,attempt,sync_scope")
    .eq("status", "queued")
    .lte("scheduled_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(1);
  if (userId) query = query.eq("user_id", userId);
  const { data } = await query.maybeSingle();
  const job = data as {
    id: string;
    user_id: string;
    source_id: string;
    attempt: number;
    sync_scope: RequestedSyncScope;
  } | null;
  if (!job) return false;
  const { data: claimed } = await supabaseAdmin
    .from("event_sync_jobs" as never)
    .update({
      status: "running",
      started_at: new Date().toISOString(),
      attempt: job.attempt + 1,
    } as never)
    .eq("id", job.id)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();
  if (!claimed) return false;

  const { resolveCanonicalCalendarRowId, registerLumaCalendarIdentity, addCalendarAliases } =
    await import("./calendar-identity.server");
  const canonicalSourceId =
    (await resolveCanonicalCalendarRowId(job.user_id, job.source_id)) ?? job.source_id;
  const { data: sourceData } = await supabaseAdmin
    .from("user_luma_calendars" as never)
    .select(SOURCE_COLUMNS)
    .eq("id", canonicalSourceId)
    .single();
  if (!sourceData) throw new Error("Sync source not found");
  const source = sourceData as unknown as SyncSourceRow;
  const scope = resolveSyncScope(source.historical_sync_completed_at, job.sync_scope ?? "auto");
  const attemptedAt = new Date().toISOString();
  await supabaseAdmin
    .from("user_luma_calendars" as never)
    .update({
      sync_status: "running",
      sync_error: null,
      last_sync_attempted_at: attemptedAt,
    } as never)
    .eq("id", source.id);

  try {
    const result =
      source.provider !== "luma" && source.provider_connection_id
        ? await syncConnectedProvider(job.user_id, source, scope)
        : source.provider !== "luma"
          ? await syncPublicProvider(job.user_id, source, scope)
          : source.source_kind === "api"
            ? await syncApiCalendar(job.user_id, source, scope)
            : source.source_kind === "profile"
              ? await syncProfile(job.user_id, source, scope)
              : await syncCalendar(job.user_id, source, scope);
    const status = "partial" in result && result.partial ? "partial" : "completed";
    const suggestion = suggestedGroup(source, result.description);
    const now = new Date();
    const next = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from("user_luma_calendars" as never)
      .update({
        remote_name: result.remoteName,
        sync_status: status,
        sync_error: result.warning,
        discovered_count: result.discovered,
        imported_count: result.imported,
        source_metadata: { ...(source.source_metadata ?? {}), ...result.metadata },
        calendar_avatar_url: result.avatarUrl ?? source.calendar_avatar_url,
        calendar_cover_url: result.coverUrl ?? source.calendar_cover_url,
        calendar_description: result.description ?? source.calendar_description,
        calendar_tint_color: result.tintColor ?? source.calendar_tint_color,
        calendar_slug:
          "slug" in result.metadata && typeof result.metadata.slug === "string"
            ? result.metadata.slug
            : undefined,
        metadata_version: CALENDAR_METADATA_VERSION,
        suggested_group_name: source.group_id ? null : suggestion.name,
        suggested_group_reason: source.group_id ? null : suggestion.reason,
        last_synced_at: now.toISOString(),
        last_sync_attempted_at: attemptedAt,
        last_sync_scope: scope.kind,
        historical_sync_completed_at: result.historicalComplete
          ? now.toISOString()
          : source.historical_sync_completed_at,
        next_sync_at: next,
      } as never)
      .eq("id", source.id);
    const discoveredIdentity =
      "lumaCalendarId" in result.metadata && typeof result.metadata.lumaCalendarId === "string"
        ? result.metadata.lumaCalendarId
        : null;
    if (discoveredIdentity) {
      const winnerId = await registerLumaCalendarIdentity(
        job.user_id,
        source.id,
        discoveredIdentity,
      );
      await addCalendarAliases(job.user_id, winnerId, [
        { value: source.calendar_id, kind: "legacy_id" },
        { value: source.calendar_url, kind: "url" },
        { value: discoveredIdentity, kind: "luma_id" },
        {
          value:
            "slug" in result.metadata && typeof result.metadata.slug === "string"
              ? result.metadata.slug
              : null,
          kind: "slug",
        },
      ]);
      if (winnerId !== source.id) await enqueueSource(job.user_id, winnerId, "scheduled");
    }
    await supabaseAdmin
      .from("event_sync_jobs" as never)
      .update({
        status,
        discovered_count: result.discovered,
        imported_count: result.imported,
        finished_at: now.toISOString(),
      } as never)
      .eq("id", job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const inaccessible = /not publicly accessible/i.test(message);
    await supabaseAdmin
      .from("user_luma_calendars" as never)
      .update({
        sync_status: inaccessible ? "inaccessible" : "failed",
        sync_error: message,
        last_sync_attempted_at: attemptedAt,
        last_sync_scope: scope.kind,
        next_sync_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      } as never)
      .eq("id", source.id);
    await supabaseAdmin
      .from("event_sync_jobs" as never)
      .update({ status: "failed", error: message, finished_at: new Date().toISOString() } as never)
      .eq("id", job.id);
  }
  const { error: cleanupError } = await supabaseAdmin.rpc(
    "cleanup_merged_calendar_rows" as never,
    { p_user_id: job.user_id } as never,
  );
  if (cleanupError && !/schema cache|does not exist/i.test(cleanupError.message)) {
    console.warn("[calendar-sync] merged calendar cleanup failed", cleanupError.message);
  }
  const { invalidateEventLibraryStatsCache } = await import("./event-library-stats.functions");
  invalidateEventLibraryStatsCache(job.user_id);
  return true;
}

export async function processSyncQueueForUser(
  userId: string,
  maxJobs = 4,
): Promise<{ processed: number; remaining: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await supabaseAdmin
    .from("event_sync_jobs" as never)
    .update({
      status: "queued",
      scheduled_at: new Date().toISOString(),
      started_at: null,
      error: "Recovered stale worker lease",
    } as never)
    .eq("user_id", userId)
    .eq("status", "running")
    .lt("started_at", stale);

  let processed = 0;
  for (let index = 0; index < maxJobs; index++) {
    if (!(await processNextSyncJob(userId))) break;
    processed++;
  }
  const { count } = await supabaseAdmin
    .from("event_sync_jobs" as never)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["queued", "running"]);
  return { processed, remaining: count ?? 0 };
}

export async function enqueueDueSources(): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_luma_calendars" as never)
    .select("id,user_id")
    .eq("sync_enabled", true)
    .is("merged_into_id", null)
    .lte("next_sync_at", new Date().toISOString());
  const rows = (data as Array<{ id: string; user_id: string }> | null) ?? [];
  for (const row of rows) await enqueueSource(row.user_id, row.id, "scheduled");
  return rows.length;
}
