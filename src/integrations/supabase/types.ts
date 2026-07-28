export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      api_tokens: {
        Row: {
          created_at: string
          id: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          token_hash: string
          token_prefix: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          token_hash: string
          token_prefix: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          token_hash?: string
          token_prefix?: string
          user_id?: string
        }
        Relationships: []
      }
      badges: {
        Row: {
          created_at: string
          event_id: string
          first_name: string
          id: string
          image_path: string
          role: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_id: string
          first_name: string
          id?: string
          image_path: string
          role?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string
          first_name?: string
          id?: string
          image_path?: string
          role?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      calendar_groups: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      calendar_merge_audit: {
        Row: {
          aliases_created: number
          created_at: string
          events_moved: number
          id: string
          loser_id: string | null
          luma_calendar_id: string | null
          reason: string
          sources_moved: number
          user_id: string
          winner_id: string
        }
        Insert: {
          aliases_created?: number
          created_at?: string
          events_moved?: number
          id?: string
          loser_id?: string | null
          luma_calendar_id?: string | null
          reason: string
          sources_moved?: number
          user_id: string
          winner_id: string
        }
        Update: {
          aliases_created?: number
          created_at?: string
          events_moved?: number
          id?: string
          loser_id?: string | null
          luma_calendar_id?: string | null
          reason?: string
          sources_moved?: number
          user_id?: string
          winner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_merge_audit_loser_id_fkey"
            columns: ["loser_id"]
            isOneToOne: false
            referencedRelation: "user_luma_calendars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_merge_audit_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "user_luma_calendars"
            referencedColumns: ["id"]
          },
        ]
      }
      canonical_events: {
        Row: {
          canonical_key: string
          city: string | null
          cover_url: string | null
          created_at: string
          description: string | null
          end_at: string | null
          host_name: string | null
          id: string
          identity_fingerprint: string | null
          luma_event_id: string | null
          name: string
          payload: Json
          start_at: string | null
          suggested_tags: string[]
          tags: string[]
          updated_at: string
          url: string
          user_id: string
        }
        Insert: {
          canonical_key: string
          city?: string | null
          cover_url?: string | null
          created_at?: string
          description?: string | null
          end_at?: string | null
          host_name?: string | null
          id?: string
          identity_fingerprint?: string | null
          luma_event_id?: string | null
          name: string
          payload?: Json
          start_at?: string | null
          suggested_tags?: string[]
          tags?: string[]
          updated_at?: string
          url: string
          user_id: string
        }
        Update: {
          canonical_key?: string
          city?: string | null
          cover_url?: string | null
          created_at?: string
          description?: string | null
          end_at?: string | null
          host_name?: string | null
          id?: string
          identity_fingerprint?: string | null
          luma_event_id?: string | null
          name?: string
          payload?: Json
          start_at?: string | null
          suggested_tags?: string[]
          tags?: string[]
          updated_at?: string
          url?: string
          user_id?: string
        }
        Relationships: []
      }
      event_sources: {
        Row: {
          calendar_name: string | null
          calendar_public_id: string | null
          calendar_row_id: string | null
          canonical_event_id: string
          created_at: string
          external_event_id: string | null
          host_name: string | null
          id: string
          last_synced_at: string
          payload: Json
          source_key: string
          source_type: string
          source_url: string
          updated_at: string
          user_id: string
        }
        Insert: {
          calendar_name?: string | null
          calendar_public_id?: string | null
          calendar_row_id?: string | null
          canonical_event_id: string
          created_at?: string
          external_event_id?: string | null
          host_name?: string | null
          id?: string
          last_synced_at?: string
          payload?: Json
          source_key: string
          source_type: string
          source_url: string
          updated_at?: string
          user_id: string
        }
        Update: {
          calendar_name?: string | null
          calendar_public_id?: string | null
          calendar_row_id?: string | null
          canonical_event_id?: string
          created_at?: string
          external_event_id?: string | null
          host_name?: string | null
          id?: string
          last_synced_at?: string
          payload?: Json
          source_key?: string
          source_type?: string
          source_url?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_sources_calendar_row_id_fkey"
            columns: ["calendar_row_id"]
            isOneToOne: false
            referencedRelation: "user_luma_calendars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_sources_canonical_event_id_fkey"
            columns: ["canonical_event_id"]
            isOneToOne: false
            referencedRelation: "canonical_events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_style_presets: {
        Row: {
          created_at: string
          event_id: string
          id: string
          label: string | null
          spec_hash: string
          style_spec: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          label?: string | null
          spec_hash: string
          style_spec: Json
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          label?: string | null
          spec_hash?: string
          style_spec?: Json
          user_id?: string
        }
        Relationships: []
      }
      event_sync_jobs: {
        Row: {
          attempt: number
          batch_id: string
          created_at: string
          discovered_count: number | null
          error: string | null
          finished_at: string | null
          id: string
          imported_count: number | null
          scheduled_at: string
          source_id: string
          started_at: string | null
          status: string
          trigger: string
          user_id: string
        }
        Insert: {
          attempt?: number
          batch_id: string
          created_at?: string
          discovered_count?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          imported_count?: number | null
          scheduled_at?: string
          source_id: string
          started_at?: string | null
          status?: string
          trigger: string
          user_id: string
        }
        Update: {
          attempt?: number
          batch_id?: string
          created_at?: string
          discovered_count?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          imported_count?: number | null
          scheduled_at?: string
          source_id?: string
          started_at?: string | null
          status?: string
          trigger?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_sync_jobs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "user_luma_calendars"
            referencedColumns: ["id"]
          },
        ]
      }
      scraped_events: {
        Row: {
          calendar_id: string | null
          city: string | null
          cover_url: string | null
          created_at: string
          description: string | null
          end_at: string | null
          event_key: string
          host_name: string | null
          id: string
          name: string
          payload: Json
          source_url: string
          start_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          calendar_id?: string | null
          city?: string | null
          cover_url?: string | null
          created_at?: string
          description?: string | null
          end_at?: string | null
          event_key: string
          host_name?: string | null
          id?: string
          name: string
          payload?: Json
          source_url: string
          start_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          calendar_id?: string | null
          city?: string | null
          cover_url?: string | null
          created_at?: string
          description?: string | null
          end_at?: string | null
          event_key?: string
          host_name?: string | null
          id?: string
          name?: string
          payload?: Json
          source_url?: string
          start_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scraped_events_calendar_id_fkey"
            columns: ["calendar_id"]
            isOneToOne: false
            referencedRelation: "user_luma_calendars"
            referencedColumns: ["id"]
          },
        ]
      }
      templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_system: boolean
          name: string
          preview_path: string | null
          slug: string
          source_url: string | null
          style_spec: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_system?: boolean
          name: string
          preview_path?: string | null
          slug: string
          source_url?: string | null
          style_spec: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_system?: boolean
          name?: string
          preview_path?: string | null
          slug?: string
          source_url?: string | null
          style_spec?: Json
          updated_at?: string
        }
        Relationships: []
      }
      user_calendar_aliases: {
        Row: {
          alias: string
          alias_kind: string
          calendar_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          alias: string
          alias_kind?: string
          calendar_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          alias?: string
          alias_kind?: string
          calendar_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_calendar_aliases_calendar_id_fkey"
            columns: ["calendar_id"]
            isOneToOne: false
            referencedRelation: "user_luma_calendars"
            referencedColumns: ["id"]
          },
        ]
      }
      user_luma_calendars: {
        Row: {
          api_key_ciphertext: string | null
          calendar_avatar_url: string | null
          calendar_cover_url: string | null
          calendar_description: string | null
          calendar_id: string
          calendar_name: string | null
          calendar_slug: string | null
          calendar_tint_color: string | null
          calendar_url: string | null
          created_at: string
          curated_name: string | null
          discovered_count: number
          event_limit: number
          group_id: string | null
          id: string
          imported_count: number
          is_default: boolean
          last_synced_at: string | null
          luma_calendar_id: string | null
          merged_into_id: string | null
          metadata_version: number
          next_sync_at: string | null
          organization_manual: boolean
          remote_name: string | null
          sort_order: number
          source: string
          source_kind: string | null
          source_metadata: Json | null
          suggested_group_name: string | null
          suggested_group_reason: string | null
          sync_enabled: boolean
          sync_error: string | null
          sync_status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key_ciphertext?: string | null
          calendar_avatar_url?: string | null
          calendar_cover_url?: string | null
          calendar_description?: string | null
          calendar_id: string
          calendar_name?: string | null
          calendar_slug?: string | null
          calendar_tint_color?: string | null
          calendar_url?: string | null
          created_at?: string
          curated_name?: string | null
          discovered_count?: number
          event_limit?: number
          group_id?: string | null
          id?: string
          imported_count?: number
          is_default?: boolean
          last_synced_at?: string | null
          luma_calendar_id?: string | null
          merged_into_id?: string | null
          metadata_version?: number
          next_sync_at?: string | null
          organization_manual?: boolean
          remote_name?: string | null
          sort_order?: number
          source?: string
          source_kind?: string | null
          source_metadata?: Json | null
          suggested_group_name?: string | null
          suggested_group_reason?: string | null
          sync_enabled?: boolean
          sync_error?: string | null
          sync_status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key_ciphertext?: string | null
          calendar_avatar_url?: string | null
          calendar_cover_url?: string | null
          calendar_description?: string | null
          calendar_id?: string
          calendar_name?: string | null
          calendar_slug?: string | null
          calendar_tint_color?: string | null
          calendar_url?: string | null
          created_at?: string
          curated_name?: string | null
          discovered_count?: number
          event_limit?: number
          group_id?: string | null
          id?: string
          imported_count?: number
          is_default?: boolean
          last_synced_at?: string | null
          luma_calendar_id?: string | null
          merged_into_id?: string | null
          metadata_version?: number
          next_sync_at?: string | null
          organization_manual?: boolean
          remote_name?: string | null
          sort_order?: number
          source?: string
          source_kind?: string | null
          source_metadata?: Json | null
          suggested_group_name?: string | null
          suggested_group_reason?: string | null
          sync_enabled?: boolean
          sync_error?: string | null
          sync_status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_luma_calendars_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "calendar_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_luma_calendars_merged_into_id_fkey"
            columns: ["merged_into_id"]
            isOneToOne: false
            referencedRelation: "user_luma_calendars"
            referencedColumns: ["id"]
          },
        ]
      }
      user_luma_keys: {
        Row: {
          api_key_ciphertext: string
          calendar_avatar_url: string | null
          calendar_id: string | null
          calendar_name: string | null
          calendar_slug: string | null
          calendar_url: string | null
          created_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key_ciphertext: string
          calendar_avatar_url?: string | null
          calendar_id?: string | null
          calendar_name?: string | null
          calendar_slug?: string | null
          calendar_url?: string | null
          created_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key_ciphertext?: string
          calendar_avatar_url?: string | null
          calendar_id?: string | null
          calendar_name?: string | null
          calendar_slug?: string | null
          calendar_url?: string | null
          created_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      calendar_canonicalization_report: {
        Row: {
          active_calendars: number | null
          aliases_created: number | null
          events_moved: number | null
          merged_calendars: number | null
          sources_moved: number | null
          unresolved_calendars: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_calendar_alias: {
        Args: {
          p_alias: string
          p_alias_kind?: string
          p_calendar_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      calendar_identity_from_values: {
        Args: {
          calendar_id: string
          calendar_url: string
          source_metadata: Json
        }
        Returns: string
      }
      cleanup_merged_calendar_rows: {
        Args: { p_user_id: string }
        Returns: number
      }
      finalize_api_calendar_sync: {
        Args: {
          p_calendar_row_id: string
          p_run_started_at: string
          p_user_id: string
        }
        Returns: Json
      }
      get_event_library_stats: {
        Args: { p_at?: string; p_user_id: string }
        Returns: Json
      }
      merge_calendar_rows: {
        Args: {
          p_loser_id: string
          p_reason?: string
          p_user_id: string
          p_winner_id: string
        }
        Returns: string
      }
      normalize_calendar_alias: { Args: { value: string }; Returns: string }
      register_luma_calendar_identity: {
        Args: {
          p_calendar_row_id: string
          p_luma_calendar_id: string
          p_user_id: string
        }
        Returns: string
      }
      resolve_user_calendar_row_id: {
        Args: { p_identifier: string; p_user_id: string }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
