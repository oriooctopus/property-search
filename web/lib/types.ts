export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          bio: string | null;
          avatar_url: string | null;
          phone: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          bio?: string | null;
          avatar_url?: string | null;
          phone?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string | null;
          bio?: string | null;
          avatar_url?: string | null;
          phone?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      listings: {
        Row: {
          id: number;
          address: string;
          area: string;
          price: number;
          beds: number;
          baths: number | null;
          sqft: number | null;
          lat: number | null;
          lon: number | null;
          transit_summary: string | null;
          photos: number;
          photo_urls: string[];
          url: string;
          list_date: string | null;
          last_update_date: string | null;
          availability_date: string | null;
          source: string;
          year_built: number | null;
          created_at: string;
          external_id: string | null;
          last_seen_at: string | null;
          delisted_at: string | null;
        };
        Insert: {
          id?: number;
          address: string;
          area: string;
          price: number;
          beds: number;
          baths: number;
          sqft?: number | null;
          lat: number;
          lon: number;
          transit_summary?: string | null;
          photos: number;
          photo_urls?: string[];
          url: string;
          list_date?: string | null;
          last_update_date?: string | null;
          availability_date?: string | null;
          source?: string;
          year_built?: number | null;
          created_at?: string;
          external_id?: string | null;
          last_seen_at?: string | null;
          delisted_at?: string | null;
        };
        Update: {
          id?: number;
          address?: string;
          area?: string;
          price?: number;
          beds?: number;
          baths?: number;
          sqft?: number | null;
          lat?: number;
          lon?: number;
          transit_summary?: string | null;
          photos?: number;
          photo_urls?: string[];
          url?: string;
          list_date?: string | null;
          last_update_date?: string | null;
          availability_date?: string | null;
          source?: string;
          year_built?: number | null;
          created_at?: string;
          external_id?: string | null;
          last_seen_at?: string | null;
          delisted_at?: string | null;
        };
        Relationships: [];
      };
      would_live_there: {
        Row: {
          id: number;
          user_id: string;
          listing_id: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          user_id: string;
          listing_id: number;
          created_at?: string;
        };
        Update: {
          id?: number;
          user_id?: string;
          listing_id?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "would_live_there_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "would_live_there_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      favorites: {
        Row: {
          id: number;
          user_id: string;
          listing_id: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          user_id: string;
          listing_id: number;
          created_at?: string;
        };
        Update: {
          id?: number;
          user_id?: string;
          listing_id?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "favorites_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "favorites_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      pricing_tiers: {
        Row: {
          id: string;
          name: string;
          monthly_query_limit: number;
          price_monthly: number;
          features: Record<string, unknown>;
        };
        Insert: {
          id: string;
          name: string;
          monthly_query_limit: number;
          price_monthly?: number;
          features?: Record<string, unknown>;
        };
        Update: {
          id?: string;
          name?: string;
          monthly_query_limit?: number;
          price_monthly?: number;
          features?: Record<string, unknown>;
        };
        Relationships: [];
      };
      user_tiers: {
        Row: {
          id: number;
          user_id: string;
          tier_id: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          user_id: string;
          tier_id?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          user_id?: string;
          tier_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_tiers_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_tiers_tier_id_fkey";
            columns: ["tier_id"];
            isOneToOne: false;
            referencedRelation: "pricing_tiers";
            referencedColumns: ["id"];
          },
        ];
      };
      search_queries: {
        Row: {
          id: number;
          user_id: string;
          query_params: Record<string, unknown>;
          result_count: number;
          created_at: string;
        };
        Insert: {
          id?: number;
          user_id: string;
          query_params: Record<string, unknown>;
          result_count?: number;
          created_at?: string;
        };
        Update: {
          id?: number;
          user_id?: string;
          query_params?: Record<string, unknown>;
          result_count?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "search_queries_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      saved_searches: {
        Row: {
          id: number;
          user_id: string;
          name: string;
          filters: Record<string, unknown>;
          notify_sms: boolean;
          created_at: string;
        };
        Insert: {
          id?: number;
          user_id: string;
          name: string;
          filters: Record<string, unknown>;
          notify_sms?: boolean;
          created_at?: string;
        };
        Update: {
          id?: number;
          user_id?: string;
          name?: string;
          filters?: Record<string, unknown>;
          notify_sms?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "saved_searches_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          id: string;
          user_id: string;
          name: string | null;
          filters: Record<string, unknown>;
          is_saved: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name?: string | null;
          filters?: Record<string, unknown>;
          is_saved?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string | null;
          filters?: Record<string, unknown>;
          is_saved?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversations_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      conversation_messages: {
        Row: {
          id: number;
          conversation_id: string;
          role: string;
          content: string;
          parsed_filters: Record<string, unknown> | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          conversation_id: string;
          role: string;
          content: string;
          parsed_filters?: Record<string, unknown> | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          conversation_id?: string;
          role?: string;
          content?: string;
          parsed_filters?: Record<string, unknown> | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversation_messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      isochrones: {
        Row: {
          id: number;
          origin_name: string;
          origin_lat: number;
          origin_lon: number;
          origin_type: string;
          travel_mode: string;
          cutoff_minutes: number;
          polygon: unknown;
          generated_at: string;
          otp_params: Record<string, unknown> | null;
        };
        Insert: {
          id?: number;
          origin_name: string;
          origin_lat: number;
          origin_lon: number;
          origin_type: string;
          travel_mode: string;
          cutoff_minutes: number;
          polygon: unknown;
          generated_at?: string;
          otp_params?: Record<string, unknown> | null;
        };
        Update: {
          id?: number;
          origin_name?: string;
          origin_lat?: number;
          origin_lon?: number;
          origin_type?: string;
          travel_mode?: string;
          cutoff_minutes?: number;
          polygon?: unknown;
          generated_at?: string;
          otp_params?: Record<string, unknown> | null;
        };
        Relationships: [];
      };
      listing_isochrones: {
        Row: {
          listing_id: number;
          isochrone_id: number;
        };
        Insert: {
          listing_id: number;
          isochrone_id: number;
        };
        Update: {
          listing_id?: number;
          isochrone_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "listing_isochrones_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "listing_isochrones_isochrone_id_fkey";
            columns: ["isochrone_id"];
            isOneToOne: false;
            referencedRelation: "isochrones";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      find_containing_isochrones: {
        Args: {
          p_lat: number;
          p_lon: number;
          p_mode: string;
          p_max_minutes: number;
        };
        Returns: {
          station_stop_id: string;
          station_name: string;
          cutoff_minutes: number;
        }[];
      };
      get_listing_isochrones: {
        Args: {
          p_listing_id: number;
        };
        Returns: {
          isochrone_id: number;
          station_stop_id: string;
          station_name: string;
          cutoff_minutes: number;
          mode: string;
        }[];
      };
      get_listings_in_isochrone: {
        Args: {
          p_isochrone_id: number;
        };
        Returns: {
          listing_id: number;
        }[];
      };
      enrich_listing_isochrones: {
        Args: {
          p_listing_id: number;
          p_lat: number;
          p_lon: number;
        };
        Returns: undefined;
      };
      batch_enrich_listing_isochrones: {
        Args: {
          p_listings: Record<string, unknown>[];
        };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
