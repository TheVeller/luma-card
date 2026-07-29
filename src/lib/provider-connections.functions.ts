import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { providerSourceId } from "./event-providers";

const Provider = z.enum(["eventbrite", "meetup"]);

function stableHash(value: string): string {
  let hash = 5381;
  for (const char of value) hash = ((hash << 5) + hash + char.charCodeAt(0)) | 0;
  return Math.abs(hash).toString(36);
}

export type ProviderConnectionDTO = {
  id: string;
  provider: "eventbrite" | "meetup";
  name: string;
  sourceUrl: string | null;
  calendarRowId: string | null;
  createdAt: string;
};

export const listProviderConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProviderConnectionDTO[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("provider_connections" as never)
      .select("id,provider,display_name,metadata,created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: true });
    if (error) {
      if (/schema cache|does not exist/i.test(error.message)) return [];
      throw new Error(error.message);
    }
    const { data: calendars } = await supabaseAdmin
      .from("user_luma_calendars" as never)
      .select("id,provider_connection_id")
      .eq("user_id", context.userId)
      .not("provider_connection_id", "is", null);
    const calendarByConnection = new Map(
      ((calendars as Array<{ id: string; provider_connection_id: string }> | null) ?? []).map(
        (calendar) => [calendar.provider_connection_id, calendar.id],
      ),
    );
    return (
      (data as Array<{
        id: string;
        provider: "eventbrite" | "meetup";
        display_name: string;
        metadata: { sourceUrl?: string } | null;
        created_at: string;
      }> | null) ?? []
    ).map((connection) => ({
      id: connection.id,
      provider: connection.provider,
      name: connection.display_name,
      sourceUrl: connection.metadata?.sourceUrl ?? null,
      calendarRowId: calendarByConnection.get(connection.id) ?? null,
      createdAt: connection.created_at,
    }));
  });

export const connectProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        provider: Provider,
        sourceUrl: z.string().url(),
        accessToken: z.string().trim().min(8),
        refreshToken: z.string().trim().min(8).optional(),
        name: z.string().trim().min(1).max(80).optional(),
        syncAllEvents: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { fetchConnectedProviderSnapshot, refreshMeetupAccessToken } =
      await import("./event-providers.server");
    let accessToken = data.accessToken;
    let refreshToken = data.refreshToken;
    let tokenExpiresAt =
      data.provider === "meetup" && refreshToken
        ? new Date(Date.now() + 55 * 60 * 1000).toISOString()
        : null;
    let snapshot;
    try {
      snapshot = await fetchConnectedProviderSnapshot(
        data.provider,
        data.sourceUrl,
        accessToken,
        1,
      );
    } catch (error) {
      if (data.provider !== "meetup" || !refreshToken) throw error;
      const refreshed = await refreshMeetupAccessToken(refreshToken);
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken;
      tokenExpiresAt = refreshed.expiresAt;
      snapshot = await fetchConnectedProviderSnapshot(
        data.provider,
        data.sourceUrl,
        accessToken,
        1,
      );
    }
    const { encryptString } = await import("./crypto.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const externalAccountId = providerSourceId(data.provider, data.sourceUrl);
    const { data: connection, error: connectionError } = await supabaseAdmin
      .from("provider_connections" as never)
      .upsert(
        {
          user_id: context.userId,
          provider: data.provider,
          display_name: data.name ?? snapshot.name,
          access_token_ciphertext: encryptString(accessToken),
          refresh_token_ciphertext: refreshToken ? encryptString(refreshToken) : undefined,
          token_expires_at: tokenExpiresAt,
          external_account_id: externalAccountId,
          metadata: { sourceUrl: data.sourceUrl },
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "user_id,provider,external_account_id" },
      )
      .select("id")
      .single();
    if (connectionError || !connection) {
      throw new Error(connectionError?.message ?? "Provider connection could not be saved");
    }
    const connectionId = (connection as { id: string }).id;
    const calendarId = `${data.provider}-${stableHash(externalAccountId)}`;
    const eventOnly = /:event:/.test(externalAccountId);
    const calendarValues = {
      calendar_name: data.name ?? snapshot.name,
      remote_name: snapshot.name,
      calendar_url: data.sourceUrl,
      calendar_avatar_url: snapshot.avatarUrl ?? undefined,
      calendar_cover_url: snapshot.coverUrl ?? undefined,
      calendar_description: snapshot.description,
      source_kind: eventOnly ? "event" : "calendar",
      provider: data.provider,
      provider_source_id: externalAccountId,
      provider_connection_id: connectionId,
      ownership: "connected",
      sync_all_events: data.syncAllEvents,
      event_limit: data.syncAllEvents ? 2000 : 80,
      sync_enabled: true,
      sync_status: "idle",
      source_metadata: {
        imageSource: snapshot.imageSource ?? null,
        linkPreviewImageUrl: snapshot.previewImageUrl ?? null,
        linkPreviewLogoUrl: snapshot.logoUrl ?? null,
      },
    };
    const { data: publicSource } = await supabaseAdmin
      .from("user_luma_calendars" as never)
      .select("id")
      .eq("user_id", context.userId)
      .eq("provider", data.provider)
      .eq("provider_source_id", externalAccountId)
      .is("merged_into_id", null)
      .maybeSingle();
    const publicSourceId = (publicSource as { id?: string } | null)?.id;
    const calendarQuery = publicSourceId
      ? supabaseAdmin
          .from("user_luma_calendars" as never)
          .update(calendarValues as never)
          .eq("id", publicSourceId)
          .eq("user_id", context.userId)
      : supabaseAdmin.from("user_luma_calendars" as never).upsert(
          {
            user_id: context.userId,
            calendar_id: calendarId,
            source: "scrape",
            is_default: false,
            ...calendarValues,
          } as never,
          { onConflict: "user_id,calendar_id" },
        );
    const { data: calendar, error: calendarError } = await calendarQuery
      .select("id,calendar_id,calendar_name")
      .single();
    if (calendarError || !calendar) {
      throw new Error(calendarError?.message ?? "Provider calendar could not be saved");
    }
    const row = calendar as { id: string; calendar_id: string; calendar_name: string };
    const { enqueueSource, processSyncQueueForUser } = await import("./calendar-sync.server");
    await enqueueSource(context.userId, row.id, "manual");
    await processSyncQueueForUser(context.userId, 1);
    return {
      connectionId,
      calendarRowId: row.id,
      calendarId: row.calendar_id,
      name: row.calendar_name,
    };
  });

export const removeProviderConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: calendarError } = await supabaseAdmin
      .from("user_luma_calendars" as never)
      .update({
        provider_connection_id: null,
        ownership: "external",
        sync_enabled: false,
        sync_status: "idle",
      } as never)
      .eq("provider_connection_id", data.id)
      .eq("user_id", context.userId);
    if (calendarError) throw new Error(calendarError.message);
    const { error } = await supabaseAdmin
      .from("provider_connections" as never)
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
