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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      blocked_users: {
        Row: {
          blocked_user_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          blocked_user_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          blocked_user_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      clip_comments: {
        Row: {
          clip_id: string | null
          content: string
          created_at: string
          id: string
          user_id: string | null
          user_name: string
        }
        Insert: {
          clip_id?: string | null
          content: string
          created_at?: string
          id?: string
          user_id?: string | null
          user_name: string
        }
        Update: {
          clip_id?: string | null
          content?: string
          created_at?: string
          id?: string
          user_id?: string | null
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "clip_comments_clip_id_fkey"
            columns: ["clip_id"]
            isOneToOne: false
            referencedRelation: "clips"
            referencedColumns: ["id"]
          },
        ]
      }
      clip_likes: {
        Row: {
          clip_id: string | null
          created_at: string
          id: string
          user_id: string | null
        }
        Insert: {
          clip_id?: string | null
          created_at?: string
          id?: string
          user_id?: string | null
        }
        Update: {
          clip_id?: string | null
          created_at?: string
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clip_likes_clip_id_fkey"
            columns: ["clip_id"]
            isOneToOne: false
            referencedRelation: "clips"
            referencedColumns: ["id"]
          },
        ]
      }
      clips: {
        Row: {
          caption: string | null
          comments_enabled: boolean | null
          created_at: string
          description: string | null
          duration: number | null
          hide_likes: boolean | null
          id: string
          likes_count: number | null
          player_id: string | null
          thumbnail_url: string | null
          title: string
          user_id: string | null
          video_url: string
          views_count: number | null
          visibility: string
        }
        Insert: {
          caption?: string | null
          comments_enabled?: boolean | null
          created_at?: string
          description?: string | null
          duration?: number | null
          hide_likes?: boolean | null
          id?: string
          likes_count?: number | null
          player_id?: string | null
          thumbnail_url?: string | null
          title: string
          user_id?: string | null
          video_url: string
          views_count?: number | null
          visibility?: string
        }
        Update: {
          caption?: string | null
          comments_enabled?: boolean | null
          created_at?: string
          description?: string | null
          duration?: number | null
          hide_likes?: boolean | null
          id?: string
          likes_count?: number | null
          player_id?: string | null
          thumbnail_url?: string | null
          title?: string
          user_id?: string | null
          video_url?: string
          views_count?: number | null
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "clips_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      club_history: {
        Row: {
          club_name: string
          created_at: string
          id: string
          level: string
          player_id: string | null
          years: string
        }
        Insert: {
          club_name: string
          created_at?: string
          id?: string
          level: string
          player_id?: string | null
          years: string
        }
        Update: {
          club_name?: string
          created_at?: string
          id?: string
          level?: string
          player_id?: string | null
          years?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_history_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      leagues: {
        Row: {
          age_group: string | null
          country: string | null
          created_at: string
          id: string
          logo_url: string | null
          name: string
          season: string | null
        }
        Insert: {
          age_group?: string | null
          country?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          season?: string | null
        }
        Update: {
          age_group?: string | null
          country?: string | null
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          season?: string | null
        }
        Relationships: []
      }
      match_goals: {
        Row: {
          created_at: string
          id: string
          match_id: string | null
          minute: number
          scorer_name: string
          team: string
        }
        Insert: {
          created_at?: string
          id?: string
          match_id?: string | null
          minute: number
          scorer_name: string
          team: string
        }
        Update: {
          created_at?: string
          id?: string
          match_id?: string | null
          minute?: number
          scorer_name?: string
          team?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_goals_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
        ]
      }
      matches: {
        Row: {
          away_score: number | null
          away_team: string
          created_at: string
          home_score: number | null
          home_team: string
          id: string
          is_live: boolean | null
          league: string | null
          match_date: string | null
          match_time: string | null
        }
        Insert: {
          away_score?: number | null
          away_team: string
          created_at?: string
          home_score?: number | null
          home_team: string
          id?: string
          is_live?: boolean | null
          league?: string | null
          match_date?: string | null
          match_time?: string | null
        }
        Update: {
          away_score?: number | null
          away_team?: string
          created_at?: string
          home_score?: number | null
          home_team?: string
          id?: string
          is_live?: boolean | null
          league?: string | null
          match_date?: string | null
          match_time?: string | null
        }
        Relationships: []
      }
      parent_player_links: {
        Row: {
          created_at: string
          id: string
          parent_profile_id: string
          player_profile_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          parent_profile_id: string
          player_profile_id: string
        }
        Update: {
          created_at?: string
          id?: string
          parent_profile_id?: string
          player_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "parent_player_links_parent_profile_id_fkey"
            columns: ["parent_profile_id"]
            isOneToOne: false
            referencedRelation: "parent_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_player_links_player_profile_id_fkey"
            columns: ["player_profile_id"]
            isOneToOne: false
            referencedRelation: "player_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parent_player_links_player_profile_id_fkey"
            columns: ["player_profile_id"]
            isOneToOne: false
            referencedRelation: "player_profiles_public"
            referencedColumns: ["id"]
          },
        ]
      }
      parent_profiles: {
        Row: {
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          full_name: string
          id: string
          relationship_to_player: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          full_name: string
          id?: string
          relationship_to_player?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          full_name?: string
          id?: string
          relationship_to_player?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      player_profiles: {
        Row: {
          coach_email: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          date_of_birth: string | null
          full_name: string
          height: string | null
          id: string
          position: string | null
          preferred_foot: string | null
          profile_image_url: string | null
          school_grade: string | null
          team: string | null
          updated_at: string
          user_id: string
          weight: string | null
        }
        Insert: {
          coach_email?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          date_of_birth?: string | null
          full_name: string
          height?: string | null
          id?: string
          position?: string | null
          preferred_foot?: string | null
          profile_image_url?: string | null
          school_grade?: string | null
          team?: string | null
          updated_at?: string
          user_id: string
          weight?: string | null
        }
        Update: {
          coach_email?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          date_of_birth?: string | null
          full_name?: string
          height?: string | null
          id?: string
          position?: string | null
          preferred_foot?: string | null
          profile_image_url?: string | null
          school_grade?: string | null
          team?: string | null
          updated_at?: string
          user_id?: string
          weight?: string | null
        }
        Relationships: []
      }
      player_statistics: {
        Row: {
          appearances: number | null
          assists: number | null
          clean_sheets: number | null
          created_at: string
          goals: number | null
          id: string
          mvp_matches: number | null
          player_id: string | null
          season: string
          starts: number | null
        }
        Insert: {
          appearances?: number | null
          assists?: number | null
          clean_sheets?: number | null
          created_at?: string
          goals?: number | null
          id?: string
          mvp_matches?: number | null
          player_id?: string | null
          season: string
          starts?: number | null
        }
        Update: {
          appearances?: number | null
          assists?: number | null
          clean_sheets?: number | null
          created_at?: string
          goals?: number | null
          id?: string
          mvp_matches?: number | null
          player_id?: string | null
          season?: string
          starts?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "player_statistics_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          club: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          height: string | null
          id: string
          league: string
          name: string
          position: string | null
          profile_image_url: string | null
          team_id: string | null
          weight: string | null
        }
        Insert: {
          club: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          height?: string | null
          id?: string
          league: string
          name: string
          position?: string | null
          profile_image_url?: string | null
          team_id?: string | null
          weight?: string | null
        }
        Update: {
          club?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          height?: string | null
          id?: string
          league?: string
          name?: string
          position?: string | null
          profile_image_url?: string | null
          team_id?: string | null
          weight?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "players_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          age_birth_year: string | null
          avatar_url: string | null
          bio: string | null
          club_name: string | null
          created_at: string
          email: string | null
          full_name: string | null
          height: string | null
          id: string
          is_pro: boolean
          position: string | null
          role: Database["public"]["Enums"]["account_type"] | null
          team_name: string | null
          updated_at: string
          user_id: string | null
          username: string | null
          username_last_changed_at: string | null
          weight: string | null
        }
        Insert: {
          age_birth_year?: string | null
          avatar_url?: string | null
          bio?: string | null
          club_name?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          height?: string | null
          id?: string
          is_pro?: boolean
          position?: string | null
          role?: Database["public"]["Enums"]["account_type"] | null
          team_name?: string | null
          updated_at?: string
          user_id?: string | null
          username?: string | null
          username_last_changed_at?: string | null
          weight?: string | null
        }
        Update: {
          age_birth_year?: string | null
          avatar_url?: string | null
          bio?: string | null
          club_name?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          height?: string | null
          id?: string
          is_pro?: boolean
          position?: string | null
          role?: Database["public"]["Enums"]["account_type"] | null
          team_name?: string | null
          updated_at?: string
          user_id?: string | null
          username?: string | null
          username_last_changed_at?: string | null
          weight?: string | null
        }
        Relationships: []
      }
      staff_profiles: {
        Row: {
          age_groups_coached: string[] | null
          city: string | null
          coaching_level: Database["public"]["Enums"]["coaching_level"] | null
          coaching_licenses: string[] | null
          contact_email: string | null
          contact_phone: string | null
          country: string | null
          created_at: string
          full_name: string
          id: string
          notable_achievements: string | null
          previous_teams: string[] | null
          profile_image_url: string | null
          role: Database["public"]["Enums"]["account_type"]
          team_organization_name: string | null
          updated_at: string
          user_id: string
          years_experience: number | null
        }
        Insert: {
          age_groups_coached?: string[] | null
          city?: string | null
          coaching_level?: Database["public"]["Enums"]["coaching_level"] | null
          coaching_licenses?: string[] | null
          contact_email?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string
          full_name: string
          id?: string
          notable_achievements?: string | null
          previous_teams?: string[] | null
          profile_image_url?: string | null
          role: Database["public"]["Enums"]["account_type"]
          team_organization_name?: string | null
          updated_at?: string
          user_id: string
          years_experience?: number | null
        }
        Update: {
          age_groups_coached?: string[] | null
          city?: string | null
          coaching_level?: Database["public"]["Enums"]["coaching_level"] | null
          coaching_licenses?: string[] | null
          contact_email?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string
          full_name?: string
          id?: string
          notable_achievements?: string | null
          previous_teams?: string[] | null
          profile_image_url?: string | null
          role?: Database["public"]["Enums"]["account_type"]
          team_organization_name?: string | null
          updated_at?: string
          user_id?: string
          years_experience?: number | null
        }
        Relationships: []
      }
      team_profiles: {
        Row: {
          age_groups_offered: string[] | null
          city: string | null
          club_name: string
          contact_email: string | null
          contact_phone: string | null
          country: string | null
          created_at: string
          founded_year: number | null
          home_stadium: string | null
          id: string
          leagues_offered: string[] | null
          logo_url: string | null
          training_ground: string | null
          updated_at: string
          user_id: string
          verified_status: boolean | null
        }
        Insert: {
          age_groups_offered?: string[] | null
          city?: string | null
          club_name: string
          contact_email?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string
          founded_year?: number | null
          home_stadium?: string | null
          id?: string
          leagues_offered?: string[] | null
          logo_url?: string | null
          training_ground?: string | null
          updated_at?: string
          user_id: string
          verified_status?: boolean | null
        }
        Update: {
          age_groups_offered?: string[] | null
          city?: string | null
          club_name?: string
          contact_email?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string
          founded_year?: number | null
          home_stadium?: string | null
          id?: string
          leagues_offered?: string[] | null
          logo_url?: string | null
          training_ground?: string | null
          updated_at?: string
          user_id?: string
          verified_status?: boolean | null
        }
        Relationships: []
      }
      team_staff: {
        Row: {
          created_at: string
          id: string
          staff_name: string
          staff_role: string
          team_profile_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          staff_name: string
          staff_role: string
          team_profile_id: string
        }
        Update: {
          created_at?: string
          id?: string
          staff_name?: string
          staff_role?: string
          team_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_staff_team_profile_id_fkey"
            columns: ["team_profile_id"]
            isOneToOne: false
            referencedRelation: "team_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_contacts: {
        Row: {
          contact_type: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
          value: string
          visibility: string
        }
        Insert: {
          contact_type: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
          value: string
          visibility?: string
        }
        Update: {
          contact_type?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
          value?: string
          visibility?: string
        }
        Relationships: []
      }
      teams: {
        Row: {
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          draws: number | null
          founded_year: number | null
          goals_against: number | null
          goals_for: number | null
          id: string
          league_id: string | null
          logo_url: string | null
          losses: number | null
          name: string
          points: number | null
          sponsors: string[] | null
          sporting_director: string | null
          stadium: string | null
          wins: number | null
        }
        Insert: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          draws?: number | null
          founded_year?: number | null
          goals_against?: number | null
          goals_for?: number | null
          id?: string
          league_id?: string | null
          logo_url?: string | null
          losses?: number | null
          name: string
          points?: number | null
          sponsors?: string[] | null
          sporting_director?: string | null
          stadium?: string | null
          wins?: number | null
        }
        Update: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          draws?: number | null
          founded_year?: number | null
          goals_against?: number | null
          goals_for?: number | null
          id?: string
          league_id?: string | null
          logo_url?: string | null
          losses?: number | null
          name?: string
          points?: number | null
          sponsors?: string[] | null
          sporting_director?: string | null
          stadium?: string | null
          wins?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_league_id_fkey"
            columns: ["league_id"]
            isOneToOne: false
            referencedRelation: "leagues"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["account_type"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["account_type"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["account_type"]
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          allow_direct_messages: string
          allow_profile_views: boolean
          allow_tagging: boolean
          auto_download_clips: boolean
          autoplay_videos: boolean
          clip_notifications: boolean
          compact_view: boolean
          created_at: string
          dark_mode: boolean
          data_saver: boolean
          date_format: string
          email_digest: boolean
          email_notifications: boolean
          goal_notifications: boolean
          hd_video_wifi: boolean
          high_contrast: boolean
          id: string
          in_app_notifications: boolean
          language: string
          large_text: boolean
          live_commentary: boolean
          match_alerts: boolean
          message_notifications: boolean
          offline_mode: boolean
          profile_public: boolean
          profile_visibility: string
          push_notifications: boolean
          quiet_hours_enabled: boolean
          quiet_hours_end: string
          quiet_hours_start: string
          reduced_motion: boolean
          screen_reader_optimized: boolean
          show_activity_status: boolean
          show_animations: boolean
          show_contact_info: string
          show_in_search: boolean
          show_last_seen: boolean
          show_online_status: boolean
          show_profile_viewers: boolean
          show_score_spoilers: boolean
          sound_effects: boolean
          timezone: string
          updated_at: string
          user_id: string
          vibration: boolean
        }
        Insert: {
          allow_direct_messages?: string
          allow_profile_views?: boolean
          allow_tagging?: boolean
          auto_download_clips?: boolean
          autoplay_videos?: boolean
          clip_notifications?: boolean
          compact_view?: boolean
          created_at?: string
          dark_mode?: boolean
          data_saver?: boolean
          date_format?: string
          email_digest?: boolean
          email_notifications?: boolean
          goal_notifications?: boolean
          hd_video_wifi?: boolean
          high_contrast?: boolean
          id?: string
          in_app_notifications?: boolean
          language?: string
          large_text?: boolean
          live_commentary?: boolean
          match_alerts?: boolean
          message_notifications?: boolean
          offline_mode?: boolean
          profile_public?: boolean
          profile_visibility?: string
          push_notifications?: boolean
          quiet_hours_enabled?: boolean
          quiet_hours_end?: string
          quiet_hours_start?: string
          reduced_motion?: boolean
          screen_reader_optimized?: boolean
          show_activity_status?: boolean
          show_animations?: boolean
          show_contact_info?: string
          show_in_search?: boolean
          show_last_seen?: boolean
          show_online_status?: boolean
          show_profile_viewers?: boolean
          show_score_spoilers?: boolean
          sound_effects?: boolean
          timezone?: string
          updated_at?: string
          user_id: string
          vibration?: boolean
        }
        Update: {
          allow_direct_messages?: string
          allow_profile_views?: boolean
          allow_tagging?: boolean
          auto_download_clips?: boolean
          autoplay_videos?: boolean
          clip_notifications?: boolean
          compact_view?: boolean
          created_at?: string
          dark_mode?: boolean
          data_saver?: boolean
          date_format?: string
          email_digest?: boolean
          email_notifications?: boolean
          goal_notifications?: boolean
          hd_video_wifi?: boolean
          high_contrast?: boolean
          id?: string
          in_app_notifications?: boolean
          language?: string
          large_text?: boolean
          live_commentary?: boolean
          match_alerts?: boolean
          message_notifications?: boolean
          offline_mode?: boolean
          profile_public?: boolean
          profile_visibility?: string
          push_notifications?: boolean
          quiet_hours_enabled?: boolean
          quiet_hours_end?: string
          quiet_hours_start?: string
          reduced_motion?: boolean
          screen_reader_optimized?: boolean
          show_activity_status?: boolean
          show_animations?: boolean
          show_contact_info?: string
          show_in_search?: boolean
          show_last_seen?: boolean
          show_online_status?: boolean
          show_profile_viewers?: boolean
          show_score_spoilers?: boolean
          sound_effects?: boolean
          timezone?: string
          updated_at?: string
          user_id?: string
          vibration?: boolean
        }
        Relationships: []
      }
    }
    Views: {
      player_profiles_public: {
        Row: {
          age_birth_year: string | null
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          full_name: string | null
          height: string | null
          id: string | null
          is_pro: boolean | null
          position: string | null
          profile_image_url: string | null
          role: Database["public"]["Enums"]["account_type"] | null
          team: string | null
          team_name: string | null
          updated_at: string | null
          user_id: string | null
          username: string | null
          weight: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      complete_account_setup: {
        Args: { _profile: Json; _role: string }
        Returns: undefined
      }
      has_account_type: {
        Args: {
          _role: Database["public"]["Enums"]["account_type"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff_member: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      account_type:
        | "player"
        | "team"
        | "coach"
        | "scout"
        | "trainer"
        | "academy_director"
        | "parent"
      coaching_level: "grassroots" | "academy" | "semi_pro" | "pro"
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
    Enums: {
      account_type: [
        "player",
        "team",
        "coach",
        "scout",
        "trainer",
        "academy_director",
        "parent",
      ],
      coaching_level: ["grassroots", "academy", "semi_pro", "pro"],
    },
  },
} as const
