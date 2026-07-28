export default {
  meta: {
    name: "calendar:sync",
    description: "Enqueue due calendar sources and process the persistent sync queue",
  },
  async run() {
    const { enqueueDueSources, processNextSyncJob } = await import("./calendar-sync.server");
    const queued = await enqueueDueSources();
    let processed = 0;
    for (let i = 0; i < 6; i++) {
      if (!(await processNextSyncJob())) break;
      processed++;
    }
    return { result: { queued, processed } };
  },
};
