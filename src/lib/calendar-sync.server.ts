import {
  CURATED_OWNER_EMAIL,
  OWNER_CURATED_SOURCES,
  normalizeSourceUrl,
  sourceCalendarId,
  type CuratedSource,
} from "./owner-curated-catalog";

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
  next_sync_at: string | null;
  source_metadata: Record<string, string | number | boolean | null> | null;
};

const SOURCE_COLUMNS =
  "id,user_id,calendar_id,calendar_name,curated_name,remote_name,calendar_url,source_kind,sync_status,sync_error,event_limit,discovered_count,imported_count,last_synced_at,next_sync_at,source_metadata";

export async function ensureOwnerCuratedCatalog(userId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: user } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (user.user?.email?.toLowerCase() !== CURATED_OWNER_EMAIL) return;

  const { data: existing } = await supabaseAdmin
    .from("user_luma_calendars" as never)
    .select("calendar_id,last_synced_at")
    .eq("user_id", userId);
  const byId = new Map(
    ((existing as Array<{ calendar_id: string; last_synced_at: string | null }> | null) ?? []).map(
      (row) => [row.calendar_id, row],
    ),
  );
  if (OWNER_CURATED_SOURCES.every((source) => byId.has(sourceCalendarId(source)))) return;

  const values = OWNER_CURATED_SOURCES.map((source) => {
    const calendarId = sourceCalendarId(source);
    return {
      user_id: userId,
      calendar_id: calendarId,
      calendar_name: source.name,
      curated_name: source.name,
      calendar_url: normalizeSourceUrl(source.url),
      source: "scrape",
      source_kind: source.kind,
      event_limit: source.kind === "profile" ? 500 : 80,
      sync_enabled: true,
      is_default: false,
      next_sync_at: byId.get(calendarId)?.last_synced_at ? undefined : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });
  const { data: upserted, error } = await supabaseAdmin
    .from("user_luma_calendars" as never)
    .upsert(values as never, { onConflict: "user_id,calendar_id" })
    .select("id,calendar_id");
  if (error) throw new Error(error.message);
  const rows = (upserted as Array<{ id: string; calendar_id: string }> | null) ?? [];
  if (existing?.length === 0 && rows.length > 0) {
    const batchId = crypto.randomUUID();
    const { error: jobsError } = await supabaseAdmin.from("event_sync_jobs" as never).insert(
      rows.map((row) => ({
        user_id: userId,
        source_id: row.id,
        batch_id: batchId,
        trigger: "initial",
        status: "queued",
      })) as never,
    );
    if (jobsError && jobsError.code !== "23505") throw new Error(jobsError.message);
    await supabaseAdmin
      .from("user_luma_calendars" as never)
      .update({ sync_status: "queued" } as never)
      .in(
        "id",
        rows.map((row) => row.id),
      );
  } else {
    for (const row of rows) {
      if (!byId.get(row.calendar_id)?.last_synced_at) {
        await enqueueSource(userId, row.id, "initial");
      }
    }
  }
}

export async function listSyncSourcesForUser(userId: string): Promise<SyncSourceRow[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_luma_calendars" as never)
    .select(SOURCE_COLUMNS)
    .eq("user_id", userId)
    .order("curated_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as SyncSourceRow[] | null) ?? [];
}

export async function upsertCuratedSources(
  userId: string,
  sources: CuratedSource[],
): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let count = 0;
  for (const source of sources) {
    const { data, error } = await supabaseAdmin
      .from("user_luma_calendars" as never)
      .upsert(
        {
          user_id: userId,
          calendar_id: sourceCalendarId(source),
          calendar_name: source.name,
          curated_name: source.name,
          calendar_url: normalizeSourceUrl(source.url),
          source: "scrape",
          source_kind: source.kind,
          event_limit: source.kind === "profile" ? 500 : 80,
          sync_enabled: true,
          is_default: false,
          next_sync_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "user_id,calendar_id" },
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await enqueueSource(userId, (data as { id: string }).id, "manual");
    count++;
  }
  return count;
}

export async function enqueueSource(
  userId: string,
  sourceId: string,
  trigger: "initial" | "manual" | "scheduled",
  batchId?: string,
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("event_sync_jobs" as never).insert({
    user_id: userId,
    source_id: sourceId,
    batch_id: batchId ?? crypto.randomUUID(),
    trigger,
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
): Promise<{ batchId: string; queued: number }> {
  const sources = await listSyncSourcesForUser(userId);
  const batchId = crypto.randomUUID();
  for (const source of sources) await enqueueSource(userId, source.id, trigger, batchId);
  return { batchId, queued: sources.length };
}

async function upsertScrapedRows(
  userId: string,
  source: SyncSourceRow,
  rows: Array<Record<string, unknown>>,
) {
  if (rows.length === 0) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const values = rows.map((row) => ({
    ...row,
    user_id: userId,
    calendar_id: source.id,
    updated_at: new Date().toISOString(),
  }));
  let result = await supabaseAdmin
    .from("scraped_events" as never)
    .upsert(values as never, { onConflict: "user_id,calendar_id,event_key" });
  if (result.error?.code === "42P10") {
    result = await supabaseAdmin
      .from("scraped_events" as never)
      .upsert(values as never, { onConflict: "user_id,event_key" });
  }
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
          sourceType: source.source_kind === "profile" ? "profile_scrape" : "calendar_scrape",
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
        });
      }),
    );
  }
}

async function syncCalendar(userId: string, source: SyncSourceRow) {
  const { resolveLumaCalendar, fetchPublicCalendarEvents } = await import("./luma-public.server");
  const calendar = await resolveLumaCalendar(source.calendar_url ?? "");
  if (!calendar) throw new Error("Calendar is not publicly accessible");
  const events = await fetchPublicCalendarEvents(calendar.apiId, source.event_limit || 80);
  await upsertScrapedRows(
    userId,
    source,
    events.map((event) => ({
      event_key: event.apiId,
      source_url: event.url,
      name: event.name,
      description: null,
      cover_url: event.coverUrl,
      city: event.city,
      start_at: event.startAt,
      end_at: event.endAt,
      host_name: null,
      payload: { source: "luma-public-api", externalEventId: event.apiId },
    })),
  );
  return {
    discovered: events.length,
    imported: events.length,
    remoteName: calendar.name,
    metadata: { lumaCalendarId: calendar.apiId, slug: calendar.slug },
  };
}

async function profileHostedCount(url: string): Promise<number | null> {
  const response = await fetch(url, { headers: { accept: "text/html" } });
  if (!response.ok) return null;
  const html = await response.text();
  const count = html.match(/"hosted_count"\s*:\s*(\d+)/)?.[1];
  return count ? Number(count) : null;
}

async function syncProfile(userId: string, source: SyncSourceRow) {
  const { firecrawlDiscoverLumaEvents, firecrawlScrapeEvent } = await import("./firecrawl.server");
  const url = source.calendar_url ?? "";
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
  await upsertScrapedRows(userId, source, rows);
  const importedUrls = new Set(cachedByUrl.keys());
  for (const row of rows) importedUrls.add(String(row.source_url));
  return {
    discovered: urls.length,
    imported: importedUrls.size,
    remoteName: source.remote_name ?? source.curated_name ?? "Luma profile",
    metadata: { hostedCount, target, refreshed: rows.length },
    partial: hostedCount !== null && urls.length < hostedCount,
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
    .select("id,user_id,source_id,attempt")
    .eq("status", "queued")
    .lte("scheduled_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(1);
  if (userId) query = query.eq("user_id", userId);
  const { data } = await query.maybeSingle();
  const job = data as { id: string; user_id: string; source_id: string; attempt: number } | null;
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

  const { data: sourceData } = await supabaseAdmin
    .from("user_luma_calendars" as never)
    .select(SOURCE_COLUMNS)
    .eq("id", job.source_id)
    .single();
  if (!sourceData) throw new Error("Sync source not found");
  const source = sourceData as unknown as SyncSourceRow;
  await supabaseAdmin
    .from("user_luma_calendars" as never)
    .update({ sync_status: "running", sync_error: null } as never)
    .eq("id", source.id);

  try {
    const result =
      source.source_kind === "profile"
        ? await syncProfile(job.user_id, source)
        : await syncCalendar(job.user_id, source);
    const status = "partial" in result && result.partial ? "partial" : "completed";
    const now = new Date();
    const next = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from("user_luma_calendars" as never)
      .update({
        remote_name: result.remoteName,
        sync_status: status,
        sync_error: null,
        discovered_count: result.discovered,
        imported_count: result.imported,
        source_metadata: result.metadata,
        last_synced_at: now.toISOString(),
        next_sync_at: next,
      } as never)
      .eq("id", source.id);
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
        last_synced_at: new Date().toISOString(),
        next_sync_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      } as never)
      .eq("id", source.id);
    await supabaseAdmin
      .from("event_sync_jobs" as never)
      .update({ status: "failed", error: message, finished_at: new Date().toISOString() } as never)
      .eq("id", job.id);
  }
  return true;
}

export async function enqueueDueSources(): Promise<number> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_luma_calendars" as never)
    .select("id,user_id")
    .eq("sync_enabled", true)
    .lte("next_sync_at", new Date().toISOString());
  const rows = (data as Array<{ id: string; user_id: string }> | null) ?? [];
  for (const row of rows) await enqueueSource(row.user_id, row.id, "scheduled");
  return rows.length;
}
