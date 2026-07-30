/**
 * GENERATED FILE — do not edit by hand.
 *
 * Regenerate after any migration:
 *     npm run db:types -- "postgresql://user:pass@host:5432/db"
 *
 * Produced by scripts/generate-db-types.mjs, which introspects a live
 * schema. Keeping this in step with supabase/migrations is what makes the
 * query layer type-safe.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      app_settings: {
        Row: {
          key: string
          value: Json
          description: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          key: string
          value: Json
          description?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          key?: string
          value?: Json
          description?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'app_settings_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      legal_updates: {
        Row: {
          id: string
          source_id: string
          content_hash: string
          source_url: string
          title_ar: string
          summary_ar: string
          country: Database['public']['Enums']['country_code']
          category: Database['public']['Enums']['legal_category']
          document_type: Database['public']['Enums']['document_type']
          legal_status: Database['public']['Enums']['legal_status']
          is_legal_update: boolean
          confidence: number
          effective_date: string | null
          publication_date: string
          affected_entities: string[]
          keywords: string[]
          raw_excerpt: string
          document_path: string | null
          ai_model: string
          created_at: string
          search_vector: unknown | null
        }
        Insert: {
          id?: string
          source_id: string
          content_hash: string
          source_url: string
          title_ar: string
          summary_ar: string
          country: Database['public']['Enums']['country_code']
          category: Database['public']['Enums']['legal_category']
          document_type: Database['public']['Enums']['document_type']
          legal_status: Database['public']['Enums']['legal_status']
          is_legal_update: boolean
          confidence: number
          effective_date?: string | null
          publication_date: string
          affected_entities?: string[]
          keywords?: string[]
          raw_excerpt: string
          document_path?: string | null
          ai_model: string
          created_at?: string
        }
        Update: {
          id?: string
          source_id?: string
          content_hash?: string
          source_url?: string
          title_ar?: string
          summary_ar?: string
          country?: Database['public']['Enums']['country_code']
          category?: Database['public']['Enums']['legal_category']
          document_type?: Database['public']['Enums']['document_type']
          legal_status?: Database['public']['Enums']['legal_status']
          is_legal_update?: boolean
          confidence?: number
          effective_date?: string | null
          publication_date?: string
          affected_entities?: string[]
          keywords?: string[]
          raw_excerpt?: string
          document_path?: string | null
          ai_model?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'legal_updates_source_id_fkey'
            columns: ['source_id']
            isOneToOne: false
            referencedRelation: 'sources'
            referencedColumns: ['id']
          },
        ]
      }
      newsletter_history: {
        Row: {
          id: string
          period_start: string
          period_end: string
          subject: string
          recipients: string[]
          recipient_count: number
          update_ids: string[]
          html_body: string | null
          status: Database['public']['Enums']['newsletter_status']
          error_message: string | null
          sent_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          period_start: string
          period_end: string
          subject: string
          recipients?: string[]
          recipient_count?: number
          update_ids?: string[]
          html_body?: string | null
          status: Database['public']['Enums']['newsletter_status']
          error_message?: string | null
          sent_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          period_start?: string
          period_end?: string
          subject?: string
          recipients?: string[]
          recipient_count?: number
          update_ids?: string[]
          html_body?: string | null
          status?: Database['public']['Enums']['newsletter_status']
          error_message?: string | null
          sent_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      sources: {
        Row: {
          id: string
          country: Database['public']['Enums']['country_code']
          authority_ar: string
          authority_en: string
          source_type: Database['public']['Enums']['source_type']
          base_url: string
          active: boolean
          parser_type: Database['public']['Enums']['parser_type']
          feed_url: string | null
          parser_config: Json
          allowed_domains: string[]
          priority: number
          poll_interval_minutes: number | null
          next_run_at: string | null
          health_status: Database['public']['Enums']['health_status']
          last_run_at: string | null
          last_success_at: string | null
          last_failure_at: string | null
          last_failure_reason: string | null
          last_duration_ms: number | null
          last_items_fetched: number
          last_items_published: number
          last_items_rejected: number
          consecutive_failures: number
          retry_attempt: number
          next_retry_at: string | null
          notes: string | null
          created_at: string
          updated_at: string
          config_status: Database['public']['Enums']['config_status']
          exclusion_group: string | null
          requires_authority_check: boolean
        }
        Insert: {
          id?: string
          country: Database['public']['Enums']['country_code']
          authority_ar: string
          authority_en: string
          source_type: Database['public']['Enums']['source_type']
          base_url: string
          active?: boolean
          parser_type: Database['public']['Enums']['parser_type']
          feed_url?: string | null
          parser_config?: Json
          allowed_domains: string[]
          priority: number
          poll_interval_minutes?: number | null
          next_run_at?: string | null
          health_status?: Database['public']['Enums']['health_status']
          last_run_at?: string | null
          last_success_at?: string | null
          last_failure_at?: string | null
          last_failure_reason?: string | null
          last_duration_ms?: number | null
          last_items_fetched?: number
          last_items_published?: number
          last_items_rejected?: number
          consecutive_failures?: number
          retry_attempt?: number
          next_retry_at?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
          config_status?: Database['public']['Enums']['config_status']
          exclusion_group?: string | null
          requires_authority_check?: boolean
        }
        Update: {
          id?: string
          country?: Database['public']['Enums']['country_code']
          authority_ar?: string
          authority_en?: string
          source_type?: Database['public']['Enums']['source_type']
          base_url?: string
          active?: boolean
          parser_type?: Database['public']['Enums']['parser_type']
          feed_url?: string | null
          parser_config?: Json
          allowed_domains?: string[]
          priority?: number
          poll_interval_minutes?: number | null
          next_run_at?: string | null
          health_status?: Database['public']['Enums']['health_status']
          last_run_at?: string | null
          last_success_at?: string | null
          last_failure_at?: string | null
          last_failure_reason?: string | null
          last_duration_ms?: number | null
          last_items_fetched?: number
          last_items_published?: number
          last_items_rejected?: number
          consecutive_failures?: number
          retry_attempt?: number
          next_retry_at?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
          config_status?: Database['public']['Enums']['config_status']
          exclusion_group?: string | null
          requires_authority_check?: boolean
        }
        Relationships: []
      }
      users: {
        Row: {
          id: string
          email: string
          full_name: string | null
          role: Database['public']['Enums']['user_role']
          active: boolean
          created_at: string
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          role?: Database['public']['Enums']['user_role']
          active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          role?: Database['public']['Enums']['user_role']
          active?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'users_id_fkey'
            columns: ['id']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
      workflow_logs: {
        Row: {
          id: string
          workflow_name: string
          execution_id: string | null
          source_id: string | null
          trigger_type: Database['public']['Enums']['trigger_type']
          status: Database['public']['Enums']['run_status']
          items_fetched: number
          items_published: number
          items_rejected: number
          rejection_reasons: Json
          error_message: string | null
          duration_ms: number | null
          retry_attempt: number
          triggered_by: string | null
          started_at: string
          finished_at: string | null
        }
        Insert: {
          id?: string
          workflow_name: string
          execution_id?: string | null
          source_id?: string | null
          trigger_type: Database['public']['Enums']['trigger_type']
          status: Database['public']['Enums']['run_status']
          items_fetched?: number
          items_published?: number
          items_rejected?: number
          rejection_reasons?: Json
          error_message?: string | null
          duration_ms?: number | null
          retry_attempt?: number
          triggered_by?: string | null
          started_at?: string
          finished_at?: string | null
        }
        Update: {
          id?: string
          workflow_name?: string
          execution_id?: string | null
          source_id?: string | null
          trigger_type?: Database['public']['Enums']['trigger_type']
          status?: Database['public']['Enums']['run_status']
          items_fetched?: number
          items_published?: number
          items_rejected?: number
          rejection_reasons?: Json
          error_message?: string | null
          duration_ms?: number | null
          retry_attempt?: number
          triggered_by?: string | null
          started_at?: string
          finished_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'workflow_logs_source_id_fkey'
            columns: ['source_id']
            isOneToOne: false
            referencedRelation: 'sources'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workflow_logs_triggered_by_fkey'
            columns: ['triggered_by']
            isOneToOne: false
            referencedRelation: 'users'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: Record<string, never>
    Functions: {
      current_user_role: {
        Args: Record<PropertyKey, never>
        Returns: Database['public']['Enums']['user_role']
      }
    }
    Enums: {
      config_status: 'pending_verification' | 'verified' | 'blocked_by_access' | 'requires_subscription'
      country_code: 'SA' | 'AE' | 'KW' | 'QA' | 'BH' | 'OM' | 'GCC'
      document_type: 'law' | 'royal_decree' | 'ministerial_decision' | 'executive_regulation' | 'circular' | 'regulatory_framework' | 'official_notice' | 'court_precedent' | 'consultation_draft' | 'other'
      health_status: 'never_run' | 'healthy' | 'degraded' | 'failing'
      legal_category: 'tax' | 'customs' | 'employment' | 'corporate' | 'financial' | 'capital_markets' | 'banking' | 'data_privacy' | 'cybersecurity' | 'competition' | 'intellectual_property' | 'litigation' | 'licensing' | 'real_estate' | 'energy' | 'healthcare' | 'trade' | 'general'
      legal_status: 'enacted' | 'effective' | 'draft' | 'amended' | 'repealed' | 'pending'
      newsletter_status: 'sent' | 'failed' | 'skipped'
      parser_type: 'rss' | 'html' | 'api' | 'pdf' | 'unknown'
      run_status: 'success' | 'partial' | 'failed'
      source_type: 'official_gazette' | 'government' | 'regulator' | 'approved_news' | 'gcc'
      trigger_type: 'scheduled' | 'manual' | 'retry'
      user_role: 'admin' | 'viewer'
    }
    CompositeTypes: Record<string, never>
  }
}

/* ---- convenience aliases ------------------------------------------------ */

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']

export type Enums<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T]
