// User-scoped Luma read APIs. Every call resolves the Luma API key from the
// signed-in user's `user_luma_keys` row.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchAllEvents, fetchEvent, type LumaEvent } from "./luma.server";
import { resolveUserLumaKey } from "./user-luma-key.functions";

export type EventDTO = {
  id: string;
  name: string;
  coverUrl: string | null;
  url: string;
  startAt: string;
  endAt?: string;
  city?: string;
  description?: string;
};

function toDTO(e: LumaEvent): EventDTO {
  return {
    id: e.api_id,
    name: e.name,
    coverUrl: e.cover_url,
    url: e.url,
    startAt: e.start_at,
    endAt: e.end_at,
    city: e.geo_address_info?.city_state ?? undefined,
    description: e.description_md,
  };
}

class NoLumaKeyError extends Error {
  constructor() {
    super("NO_LUMA_KEY");
  }
}

async function keyFor(userId: string): Promise<string> {
  const key = await resolveUserLumaKey(userId);
  if (!key) throw new NoLumaKeyError();
  return key;
}

export const listEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const key = await keyFor(context.userId);
    const events = await fetchAllEvents(key);
    return events.map(toDTO);
  });

export const getEvent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => {
    if (!data || typeof data.id !== "string" || !data.id) throw new Error("id required");
    return data;
  })
  .handler(async ({ data, context }) => {
    const key = await keyFor(context.userId);
    const e = await fetchEvent(key, data.id);
    return toDTO(e);
  });
