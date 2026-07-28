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
    z.object({ text: z.string().trim().min(1).max(100_000) }).parse(value),
  )
  .handler(async ({ data, context }) => {
    const sources = parseBulkSources(data.text);
    if (sources.length === 0) throw new Error("No valid Luma URLs found");
    const { upsertCuratedSources } = await import("./calendar-sync.server");
    return { imported: await upsertCuratedSources(context.userId, sources), sources };
  });

export const syncAllSources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { ensureOwnerCuratedCatalog, enqueueAllSources, processNextSyncJob } =
      await import("./calendar-sync.server");
    await ensureOwnerCuratedCatalog(context.userId);
    const result = await enqueueAllSources(context.userId, "manual");
    await processNextSyncJob(context.userId);
    return result;
  });

export const syncOneSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ sourceId: z.string().uuid() }).parse(value))
  .handler(async ({ data, context }) => {
    const { enqueueSource, processNextSyncJob } = await import("./calendar-sync.server");
    await enqueueSource(context.userId, data.sourceId, "manual");
    await processNextSyncJob(context.userId);
    return { ok: true };
  });

export const processSyncQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { processNextSyncJob } = await import("./calendar-sync.server");
    let processed = 0;
    for (let i = 0; i < 2; i++) {
      if (!(await processNextSyncJob(context.userId))) break;
      processed++;
    }
    return { processed };
  });
