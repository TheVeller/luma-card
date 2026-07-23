import { createServerFn } from "@tanstack/react-start";
import { fetchAllEvents, fetchEvent, type LumaEvent } from "./luma.server";

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

export const listEvents = createServerFn({ method: "GET" }).handler(async () => {
  const events = await fetchAllEvents();
  return events.map(toDTO);
});

export const getEvent = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => {
    if (!data || typeof data.id !== "string" || !data.id) throw new Error("id required");
    return data;
  })
  .handler(async ({ data }) => {
    const e = await fetchEvent(data.id);
    return toDTO(e);
  });

export const hasApiKey = createServerFn({ method: "GET" }).handler(async () => {
  return { configured: Boolean(process.env.LUMA_API_KEY) };
});
