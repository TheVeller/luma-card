import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseBulkSources } from "./owner-curated-catalog";

export const listSyncSources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { ensureOwnerCuratedCatalog, listSyncSourcesForUser } =
      await import("./calendar-sync.server");
    await ensureOwnerCuratedCatalog(context.userId);
    return listSyncSourcesForUser(context.userId);
  });

export const importBulkSources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) =>
    z.object({ text: z.string().trim().min(1).max(1_000_000) }).parse(value),
  )
  .handler(async ({ data, context }) => {
    const sources = parseBulkSources(data.text);
    if (sources.length === 0) throw new Error("No valid Luma or Meetup group URLs found");
    const { upsertCuratedSources } = await import("./calendar-sync.server");
    return { imported: await upsertCuratedSources(context.userId, sources), sources };
  });

export const syncAllSources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { ensureOwnerCuratedCatalog, enqueueAllSources, processSyncQueueForUser } =
      await import("./calendar-sync.server");
    await ensureOwnerCuratedCatalog(context.userId);
    const result = await enqueueAllSources(context.userId, "manual");
    await processSyncQueueForUser(context.userId, 4);
    return result;
  });

export const syncOneSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) =>
    z
      .object({
        sourceId: z.string().uuid(),
        scope: z.enum(["auto", "full", "maintenance"]).default("auto"),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    const { enqueueSource, processSyncQueueForUser } = await import("./calendar-sync.server");
    await enqueueSource(context.userId, data.sourceId, "manual", undefined, data.scope);
    await processSyncQueueForUser(context.userId, 1, [data.sourceId]);
    return { ok: true };
  });

export const processSyncQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { processSyncQueueForUser } = await import("./calendar-sync.server");
    return processSyncQueueForUser(context.userId, 4);
  });
