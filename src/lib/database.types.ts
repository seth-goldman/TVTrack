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
      episode_cache: {
        Row: {
          air_date: string | null
          episode: number
          name: string | null
          overview: string | null
          refreshed_at: string
          runtime: number | null
          season: number
          show_id: number
          still_path: string | null
          tmdb_episode_id: number | null
        }
        Insert: {
          air_date?: string | null
          episode: number
          name?: string | null
          overview?: string | null
          refreshed_at?: string
          runtime?: number | null
          season: number
          show_id: number
          still_path?: string | null
          tmdb_episode_id?: number | null
        }
        Update: {
          air_date?: string | null
          episode?: number
          name?: string | null
          overview?: string | null
          refreshed_at?: string
          runtime?: number | null
          season?: number
          show_id?: number
          still_path?: string | null
          tmdb_episode_id?: number | null
        }
        Relationships: []
      }
      episodes_watched: {
        Row: {
          episode: number
          id: number
          season: number
          show_id: number
          tmdb_episode_id: number | null
          user_id: string
          watched_at: string
        }
        Insert: {
          episode: number
          id?: number
          season: number
          show_id: number
          tmdb_episode_id?: number | null
          user_id: string
          watched_at?: string
        }
        Update: {
          episode?: number
          id?: number
          season?: number
          show_id?: number
          tmdb_episode_id?: number | null
          user_id?: string
          watched_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "episodes_watched_show_fk"
            columns: ["user_id", "show_id"]
            isOneToOne: false
            referencedRelation: "shows"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      household_members: {
        Row: {
          household_id: string
          joined_at: string
          user_id: string
        }
        Insert: {
          household_id: string
          joined_at?: string
          user_id: string
        }
        Update: {
          household_id?: string
          joined_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      import_batches: {
        Row: {
          committed_at: string | null
          created_at: string
          filenames: string[]
          id: string
          source: string
          stats: Json
          user_id: string
        }
        Insert: {
          committed_at?: string | null
          created_at?: string
          filenames?: string[]
          id?: string
          source?: string
          stats?: Json
          user_id: string
        }
        Update: {
          committed_at?: string | null
          created_at?: string
          filenames?: string[]
          id?: string
          source?: string
          stats?: Json
          user_id?: string
        }
        Relationships: []
      }
      import_staging: {
        Row: {
          batch_id: string
          created_at: string
          episode: number | null
          id: number
          imdb_id: string | null
          kind: string
          match_candidates: Json | null
          match_confidence: string | null
          match_status: string
          rating: number | null
          raw: Json
          resolved_kind: string | null
          resolved_tmdb_id: number | null
          season: number | null
          source_file: string | null
          title: string | null
          tmdb_id: number | null
          tvdb_id: number | null
          user_id: string
          watched_at: string | null
          year: number | null
        }
        Insert: {
          batch_id: string
          created_at?: string
          episode?: number | null
          id?: number
          imdb_id?: string | null
          kind: string
          match_candidates?: Json | null
          match_confidence?: string | null
          match_status?: string
          rating?: number | null
          raw: Json
          resolved_kind?: string | null
          resolved_tmdb_id?: number | null
          season?: number | null
          source_file?: string | null
          title?: string | null
          tmdb_id?: number | null
          tvdb_id?: number | null
          user_id: string
          watched_at?: string | null
          year?: number | null
        }
        Update: {
          batch_id?: string
          created_at?: string
          episode?: number | null
          id?: number
          imdb_id?: string | null
          kind?: string
          match_candidates?: Json | null
          match_confidence?: string | null
          match_status?: string
          rating?: number | null
          raw?: Json
          resolved_kind?: string | null
          resolved_tmdb_id?: number | null
          season?: number | null
          source_file?: string | null
          title?: string | null
          tmdb_id?: number | null
          tvdb_id?: number | null
          user_id?: string
          watched_at?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "import_staging_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      movies: {
        Row: {
          added_at: string
          id: number
          overview: string | null
          poster_path: string | null
          rating: number | null
          release_date: string | null
          runtime: number | null
          status: string
          title: string
          updated_at: string
          user_id: string
          watched_at: string | null
        }
        Insert: {
          added_at?: string
          id: number
          overview?: string | null
          poster_path?: string | null
          rating?: number | null
          release_date?: string | null
          runtime?: number | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
          watched_at?: string | null
        }
        Update: {
          added_at?: string
          id?: number
          overview?: string | null
          poster_path?: string | null
          rating?: number | null
          release_date?: string | null
          runtime?: number | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
          watched_at?: string | null
        }
        Relationships: []
      }
      show_cache_meta: {
        Row: {
          next_air_date: string | null
          refreshed_at: string
          show_id: number
          tmdb_status: string | null
        }
        Insert: {
          next_air_date?: string | null
          refreshed_at?: string
          show_id: number
          tmdb_status?: string | null
        }
        Update: {
          next_air_date?: string | null
          refreshed_at?: string
          show_id?: number
          tmdb_status?: string | null
        }
        Relationships: []
      }
      show_ratings: {
        Row: {
          rated_at: string
          rating: number
          show_id: number
          user_id: string
        }
        Insert: {
          rated_at?: string
          rating: number
          show_id: number
          user_id: string
        }
        Update: {
          rated_at?: string
          rating?: number
          show_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "show_ratings_show_fk"
            columns: ["user_id", "show_id"]
            isOneToOne: true
            referencedRelation: "shows"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      shows: {
        Row: {
          added_at: string
          backdrop_path: string | null
          episode_runtime: number | null
          first_air: string | null
          id: number
          overview: string | null
          poster_path: string | null
          status: string
          title: string
          tmdb_status: string | null
          updated_at: string
          user_id: string
          watched_together: boolean
        }
        Insert: {
          added_at?: string
          backdrop_path?: string | null
          episode_runtime?: number | null
          first_air?: string | null
          id: number
          overview?: string | null
          poster_path?: string | null
          status?: string
          title: string
          tmdb_status?: string | null
          updated_at?: string
          user_id: string
          watched_together?: boolean
        }
        Update: {
          added_at?: string
          backdrop_path?: string | null
          episode_runtime?: number | null
          first_air?: string | null
          id?: number
          overview?: string | null
          poster_path?: string | null
          status?: string
          title?: string
          tmdb_status?: string | null
          updated_at?: string
          user_id?: string
          watched_together?: boolean
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          subscribed_providers: number[]
          updated_at: string
          user_id: string
          watch_region: string
        }
        Insert: {
          subscribed_providers?: number[]
          updated_at?: string
          user_id: string
          watch_region?: string
        }
        Update: {
          subscribed_providers?: number[]
          updated_at?: string
          user_id?: string
          watch_region?: string
        }
        Relationships: []
      }
      watch_provider_cache: {
        Row: {
          kind: string
          link: string | null
          providers: Json
          refreshed_at: string
          region: string
          tmdb_id: number
        }
        Insert: {
          kind: string
          link?: string | null
          providers?: Json
          refreshed_at?: string
          region: string
          tmdb_id: number
        }
        Update: {
          kind?: string
          link?: string | null
          providers?: Json
          refreshed_at?: string
          region?: string
          tmdb_id?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      household_partners: {
        Args: { p_user_id: string }
        Returns: {
          user_id: string
        }[]
      }
      set_watch_together: {
        Args: { p_enabled: boolean; p_show_id: number }
        Returns: undefined
      }
      up_next: {
        Args: never
        Returns: {
          air_date: string
          aired_count: number
          episode: number
          episode_name: string
          last_watched_at: string
          poster_path: string
          runtime: number
          season: number
          show_id: number
          still_path: string
          title: string
          tmdb_episode_id: number
          tmdb_status: string
          upcoming_air_date: string
          upcoming_episode: number
          upcoming_season: number
          watched_count: number
        }[]
      }
      upcoming: {
        Args: { days?: number }
        Returns: {
          air_date: string
          episode: number
          episode_name: string
          kind: string
          poster_path: string
          season: number
          show_id: number
          still_path: string
          title: string
        }[]
      }
      watch_stats: {
        Args: never
        Returns: {
          episodes: number
          minutes: number
          month: string
        }[]
      }
      watch_together_candidate: {
        Args: { p_show_id: number }
        Returns: {
          partner_has_show: boolean
          partner_id: string
          partner_watched_together: boolean
        }[]
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
