import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SyncLibraryResult = {
  scanned: number;
  synced: number;
  failed: number;
};

export const syncEventLibrary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SyncLibraryResult> => {
    const { aggregateCanonicalEventsForUser } = await import("./events-aggregate.server");
    const { upsertCanonicalEventSource } = await import("./canonical-events.server");
    const { sourceRows } = await aggregateCanonicalEventsForUser(context.userId, {
      calendarId: "__all__",
    });

    let synced = 0;
    let failed = 0;
    for (const source of sourceRows) {
      try {
        await upsertCanonicalEventSource(context.userId, source);
        synced++;
      } catch (e) {
        failed++;
        console.error("[syncEventLibrary] source failed", e);
      }
    }
    const { invalidateEventLibraryStatsCache } = await import("./event-library-stats.functions");
    invalidateEventLibraryStatsCache(context.userId);

    return { scanned: sourceRows.length, synced, failed };
  });
