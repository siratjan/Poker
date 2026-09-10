/**
 * Database types for the Supabase schema of supabase/migrations/0001..0004.
 *
 * Hand written, but shaped exactly like the output of
 *   npx supabase gen types typescript --linked
 * (Database -> public -> Tables/Views/Functions/Enums, each table with
 * Row/Insert/Update/Relationships), so it can be replaced 1:1 by the generated
 * file as soon as the CLI is linked: `npm run types:gen`.
 *
 * Money is always integer cents. Keep in sync with the migrations by hand until
 * then — a mismatch here is a compile error, not a runtime surprise.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      app_users: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          avatar_url: string | null;
          role: Database['public']['Enums']['app_role'];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          display_name?: string | null;
          avatar_url?: string | null;
          role?: Database['public']['Enums']['app_role'];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          role?: Database['public']['Enums']['app_role'];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'app_users_id_fkey';
            columns: ['id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      audit_log: {
        Row: {
          id: number;
          at: string;
          user_id: string | null;
          user_email: string | null;
          table_name: string;
          row_id: string;
          action: string;
          old_data: Json | null;
          new_data: Json | null;
          session_id: string | null;
        };
        Insert: {
          id?: number;
          at?: string;
          user_id?: string | null;
          user_email?: string | null;
          table_name: string;
          row_id: string;
          action: string;
          old_data?: Json | null;
          new_data?: Json | null;
          session_id?: string | null;
        };
        Update: {
          id?: number;
          at?: string;
          user_id?: string | null;
          user_email?: string | null;
          table_name?: string;
          row_id?: string;
          action?: string;
          old_data?: Json | null;
          new_data?: Json | null;
          session_id?: string | null;
        };
        Relationships: [];
      };
      entries: {
        Row: {
          id: string;
          session_id: string;
          player_id: string;
          type: Database['public']['Enums']['entry_type'];
          amount_cents: number;
          payment: Database['public']['Enums']['payment_method'] | null;
          note: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          player_id: string;
          type: Database['public']['Enums']['entry_type'];
          amount_cents: number;
          payment?: Database['public']['Enums']['payment_method'] | null;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          player_id?: string;
          type?: Database['public']['Enums']['entry_type'];
          amount_cents?: number;
          payment?: Database['public']['Enums']['payment_method'] | null;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'entries_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'app_users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'entries_session_id_player_id_fkey';
            columns: ['session_id', 'player_id'];
            isOneToOne: false;
            referencedRelation: 'session_players';
            referencedColumns: ['session_id', 'player_id'];
          },
        ];
      };
      players: {
        Row: {
          id: string;
          name: string;
          name_normalized: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'players_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'app_users';
            referencedColumns: ['id'];
          },
        ];
      };
      role_whitelist: {
        Row: {
          email: string;
          role: Database['public']['Enums']['app_role'];
          note: string | null;
          created_at: string;
        };
        Insert: {
          email: string;
          role: Database['public']['Enums']['app_role'];
          note?: string | null;
          created_at?: string;
        };
        Update: {
          email?: string;
          role?: Database['public']['Enums']['app_role'];
          note?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      session_players: {
        Row: {
          session_id: string;
          player_id: string;
          position: number;
          added_by: string | null;
          added_at: string;
        };
        Insert: {
          session_id: string;
          player_id: string;
          position: number;
          added_by?: string | null;
          added_at?: string;
        };
        Update: {
          session_id?: string;
          player_id?: string;
          position?: number;
          added_by?: string | null;
          added_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'session_players_added_by_fkey';
            columns: ['added_by'];
            isOneToOne: false;
            referencedRelation: 'app_users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'session_players_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'players';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'session_players_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'sessions';
            referencedColumns: ['id'];
          },
        ];
      };
      sessions: {
        Row: {
          id: string;
          played_on: string;
          name: string | null;
          status: Database['public']['Enums']['session_status'];
          created_by: string | null;
          created_at: string;
          closed_at: string | null;
          closed_by: string | null;
          discrepancy_cents: number | null;
          close_note: string | null;
          reopened_at: string | null;
          reopened_by: string | null;
        };
        Insert: {
          id?: string;
          played_on?: string;
          name?: string | null;
          status?: Database['public']['Enums']['session_status'];
          created_by?: string | null;
          created_at?: string;
          closed_at?: string | null;
          closed_by?: string | null;
          discrepancy_cents?: number | null;
          close_note?: string | null;
          reopened_at?: string | null;
          reopened_by?: string | null;
        };
        Update: {
          id?: string;
          played_on?: string;
          name?: string | null;
          status?: Database['public']['Enums']['session_status'];
          created_by?: string | null;
          created_at?: string;
          closed_at?: string | null;
          closed_by?: string | null;
          discrepancy_cents?: number | null;
          close_note?: string | null;
          reopened_at?: string | null;
          reopened_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'sessions_closed_by_fkey';
            columns: ['closed_by'];
            isOneToOne: false;
            referencedRelation: 'app_users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sessions_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'app_users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sessions_reopened_by_fkey';
            columns: ['reopened_by'];
            isOneToOne: false;
            referencedRelation: 'app_users';
            referencedColumns: ['id'];
          },
        ];
      };
      settings: {
        Row: {
          key: string;
          value: Json;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          key: string;
          value: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          key?: string;
          value?: Json;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'settings_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'app_users';
            referencedColumns: ['id'];
          },
        ];
      };
      settlement_lines: {
        Row: {
          session_id: string;
          player_id: string;
          position: number;
          cash_in_cents: number;
          credit_in_cents: number;
          stack_cents: number;
          payout_cents: number;
          is_cash_player: boolean;
          claim_cents: number;
          cash_tier1_cents: number;
          cash_tier2_cents: number;
          cash_tier3_cents: number;
          cash_from_box_cents: number;
          net_result_cents: number;
          residual_cents: number;
        };
        Insert: {
          session_id: string;
          player_id: string;
          position: number;
          cash_in_cents: number;
          credit_in_cents: number;
          stack_cents: number;
          payout_cents: number;
          is_cash_player: boolean;
          claim_cents: number;
          cash_tier1_cents: number;
          cash_tier2_cents: number;
          cash_tier3_cents: number;
          cash_from_box_cents: number;
          net_result_cents: number;
          residual_cents: number;
        };
        Update: {
          session_id?: string;
          player_id?: string;
          position?: number;
          cash_in_cents?: number;
          credit_in_cents?: number;
          stack_cents?: number;
          payout_cents?: number;
          is_cash_player?: boolean;
          claim_cents?: number;
          cash_tier1_cents?: number;
          cash_tier2_cents?: number;
          cash_tier3_cents?: number;
          cash_from_box_cents?: number;
          net_result_cents?: number;
          residual_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'settlement_lines_player_id_fkey';
            columns: ['player_id'];
            isOneToOne: false;
            referencedRelation: 'players';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'settlement_lines_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'settlements';
            referencedColumns: ['session_id'];
          },
        ];
      };
      settlement_transfers: {
        Row: {
          id: string;
          session_id: string;
          position: number;
          from_player_id: string;
          to_player_id: string;
          amount_cents: number;
        };
        Insert: {
          id?: string;
          session_id: string;
          position: number;
          from_player_id: string;
          to_player_id: string;
          amount_cents: number;
        };
        Update: {
          id?: string;
          session_id?: string;
          position?: number;
          from_player_id?: string;
          to_player_id?: string;
          amount_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'settlement_transfers_from_player_id_fkey';
            columns: ['from_player_id'];
            isOneToOne: false;
            referencedRelation: 'players';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'settlement_transfers_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'settlements';
            referencedColumns: ['session_id'];
          },
          {
            foreignKeyName: 'settlement_transfers_to_player_id_fkey';
            columns: ['to_player_id'];
            isOneToOne: false;
            referencedRelation: 'players';
            referencedColumns: ['id'];
          },
        ];
      };
      settlements: {
        Row: {
          session_id: string;
          algorithm_version: number;
          computed_at: string;
          computed_by: string | null;
          total_buy_in_cents: number;
          total_stack_cents: number;
          discrepancy_cents: number;
          cash_box_start_cents: number;
          cash_box_after_payouts_cents: number;
          unallocated_cash_cents: number;
          uncovered_claims_cents: number;
          uncovered_debts_cents: number;
          is_manual: boolean;
        };
        Insert: {
          session_id: string;
          algorithm_version: number;
          computed_at?: string;
          computed_by?: string | null;
          total_buy_in_cents: number;
          total_stack_cents: number;
          discrepancy_cents: number;
          cash_box_start_cents: number;
          cash_box_after_payouts_cents: number;
          unallocated_cash_cents: number;
          uncovered_claims_cents: number;
          uncovered_debts_cents: number;
          is_manual?: boolean;
        };
        Update: {
          session_id?: string;
          algorithm_version?: number;
          computed_at?: string;
          computed_by?: string | null;
          total_buy_in_cents?: number;
          total_stack_cents?: number;
          discrepancy_cents?: number;
          cash_box_start_cents?: number;
          cash_box_after_payouts_cents?: number;
          unallocated_cash_cents?: number;
          uncovered_claims_cents?: number;
          uncovered_debts_cents?: number;
          is_manual?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'settlements_computed_by_fkey';
            columns: ['computed_by'];
            isOneToOne: false;
            referencedRelation: 'app_users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'settlements_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: true;
            referencedRelation: 'sessions';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      // Read view for the session list (supabase/migrations/0006_session_overview.sql).
      // security_invoker, so the querying user's RLS applies. Read-only.
      session_overview: {
        Row: {
          id: string;
          played_on: string;
          name: string | null;
          status: Database['public']['Enums']['session_status'];
          created_at: string;
          participant_count: number;
          total_buy_in_cents: number;
        };
        Relationships: [
          {
            foreignKeyName: 'sessions_id_fkey';
            columns: ['id'];
            isOneToOne: true;
            referencedRelation: 'sessions';
            referencedColumns: ['id'];
          },
        ];
      };
      // Read view for the player overview (supabase/migrations/0007_player_stats.sql).
      // security_invoker, so the querying user's RLS applies. Read-only.
      player_stats: {
        Row: {
          player_id: string;
          name: string;
          name_normalized: string;
          sessions_played: number;
          total_buy_in_cents: number;
          total_stack_cents: number;
          net_cents: number;
          /** `null` for a player who has never been added to a session. */
          last_played_on: string | null;
          open_sessions: number;
        };
        Relationships: [
          {
            foreignKeyName: 'players_id_fkey';
            columns: ['player_id'];
            isOneToOne: true;
            referencedRelation: 'players';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Functions: {
      close_session: {
        Args: {
          p_session_id: string;
          p_settlement: Json;
          p_note?: string | null;
        };
        Returns: undefined;
      };
      // Manual settlement override (WP11, supabase/migrations/0008_manual_settlement.sql).
      close_session_manual: {
        Args: {
          p_session_id: string;
          p_settlement: Json;
          p_note: string;
        };
        Returns: undefined;
      };
      current_app_role: {
        Args: Record<PropertyKey, never>;
        Returns: Database['public']['Enums']['app_role'];
      };
      is_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      is_editor: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      reopen_session: {
        Args: {
          p_session_id: string;
          p_reason: string;
        };
        Returns: undefined;
      };
      session_is_open: {
        Args: {
          p_session_id: string;
        };
        Returns: boolean;
      };
      settlement_input: {
        Args: {
          p_session_id: string;
        };
        Returns: {
          player_id: string;
          player_name: string;
          position: number;
          cash_in_cents: number;
          credit_in_cents: number;
          stack_cents: number;
          payout_cents: number;
          has_cash_out: boolean;
        }[];
      };
    };
    Enums: {
      app_role: 'admin' | 'editor' | 'viewer';
      entry_type: 'buy_in' | 'cash_out' | 'payout';
      payment_method: 'cash' | 'credit';
      session_status: 'open' | 'closed';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

// ---------------------------------------------------------------------------
// Convenience helpers (same names the generated file exposes)
// ---------------------------------------------------------------------------

type PublicSchema = Database['public'];

export type Tables<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Row'];

export type TablesInsert<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Insert'];

export type TablesUpdate<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Update'];

export type Enums<T extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][T];

export type FunctionArgs<T extends keyof PublicSchema['Functions']> =
  PublicSchema['Functions'][T]['Args'];

export type FunctionReturns<T extends keyof PublicSchema['Functions']> =
  PublicSchema['Functions'][T]['Returns'];

export const TABLE_NAMES = [
  'role_whitelist',
  'app_users',
  'players',
  'sessions',
  'session_players',
  'entries',
  'settlements',
  'settlement_lines',
  'settlement_transfers',
  'settings',
  'audit_log',
] as const satisfies readonly (keyof PublicSchema['Tables'])[];

export type TableName = (typeof TABLE_NAMES)[number];
