// Generated from supabase/migrations by npm run db:types. Do not edit.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type Database = {
  public: {
    Tables: {
      app_errors: {
        Row: {
          fingerprint: string;
          source: string;
          route: string;
          message: string;
          stack: string | null;
          count: number;
          first_at: string;
          last_at: string;
          alerted_at: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
        };
        Insert: {
          fingerprint: string;
          source: string;
          route: string;
          message: string;
          stack?: string | null;
          count?: number;
          first_at?: string;
          last_at?: string;
          alerted_at?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
        };
        Update: {
          fingerprint?: string;
          source?: string;
          route?: string;
          message?: string;
          stack?: string | null;
          count?: number;
          first_at?: string;
          last_at?: string;
          alerted_at?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "app_errors_resolved_by_fkey";
            columns: ["resolved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      call_signals: {
        Row: {
          id: string;
          deal_id: string;
          call_id: string;
          from_user_id: string;
          to_user_id: string;
          kind: string;
          video: boolean;
          sdp: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          deal_id: string;
          call_id: string;
          from_user_id: string;
          to_user_id: string;
          kind: string;
          video?: boolean;
          sdp?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          deal_id?: string;
          call_id?: string;
          from_user_id?: string;
          to_user_id?: string;
          kind?: string;
          video?: boolean;
          sdp?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "call_signals_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: false;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "call_signals_from_user_id_fkey";
            columns: ["from_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "call_signals_to_user_id_fkey";
            columns: ["to_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      category_keywords: {
        Row: {
          category:
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly";
          word: string;
          created_at: string;
        };
        Insert: {
          category:
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly";
          word: string;
          created_at?: string;
        };
        Update: {
          category?:
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly";
          word?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      category_settings: {
        Row: {
          category:
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly";
          trust: string;
          live: boolean;
          updated_at: string;
          updated_by: string | null;
          cover_path: string | null;
          min_fee: number | null;
          min_hourly: number | null;
          default_minutes: number;
          check_hours: number | null;
        };
        Insert: {
          category:
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly";
          trust: string;
          live?: boolean;
          updated_at?: string;
          updated_by?: string | null;
          cover_path?: string | null;
          min_fee?: number | null;
          min_hourly?: number | null;
          default_minutes?: number;
          check_hours?: number | null;
        };
        Update: {
          category?:
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly";
          trust?: string;
          live?: boolean;
          updated_at?: string;
          updated_by?: string | null;
          cover_path?: string | null;
          min_fee?: number | null;
          min_hourly?: number | null;
          default_minutes?: number;
          check_hours?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "category_settings_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      deals: {
        Row: {
          id: string;
          version: number;
          type: "errand" | "goods";
          status:
            | "awaiting_payment"
            | "open"
            | "matched"
            | "in_progress"
            | "held"
            | "check"
            | "disputed"
            | "released"
            | "refunded"
            | "cancelled"
            | "expired";
          title: string;
          description: string;
          category:
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly"
            | null;
          mode: "now" | "schedule" | null;
          scheduled_at: string | null;
          address: string | null;
          lat: number | null;
          lng: number | null;
          item_budget: number | null;
          fee: number | null;
          service_fee: number | null;
          commission_bps: number | null;
          cancel_fee: number | null;
          max_applicants: number | null;
          match_window_minutes: number | null;
          customer_id: string | null;
          helper_id: string | null;
          match_by: string | null;
          receipt_amount: number | null;
          handover_proof_at: string | null;
          price: number | null;
          buyer_fee: number | null;
          seller_id: string | null;
          buyer_id: string | null;
          code: string | null;
          handed_over_at: string | null;
          held_amount: number;
          payment_ref: string | null;
          check_hours: number;
          check_until: string | null;
          created_at: string;
          updated_at: string;
          pickup_address: string | null;
          pay_by: string | null;
          details: Json;
          top_up: Json | null;
          posted_fee: number | null;
          pickup_lat: number | null;
          pickup_lng: number | null;
          price_change: Json | null;
          invited_helper_id: string | null;
          invite_until: string | null;
          invite_open_after: boolean;
          provider_refs: string[];
          payee_org_id: string | null;
          assigned_at: string | null;
          pay_mode: string;
          en_route_at: string | null;
          arrive_extend_minutes: number | null;
          absent_at: string | null;
        };
        Insert: {
          id?: string;
          version?: number;
          type: "errand" | "goods";
          status?:
            | "awaiting_payment"
            | "open"
            | "matched"
            | "in_progress"
            | "held"
            | "check"
            | "disputed"
            | "released"
            | "refunded"
            | "cancelled"
            | "expired";
          title: string;
          description?: string;
          category?:
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly"
            | null;
          mode?: "now" | "schedule" | null;
          scheduled_at?: string | null;
          address?: string | null;
          lat?: number | null;
          lng?: number | null;
          item_budget?: number | null;
          fee?: number | null;
          service_fee?: number | null;
          commission_bps?: number | null;
          cancel_fee?: number | null;
          max_applicants?: number | null;
          match_window_minutes?: number | null;
          customer_id?: string | null;
          helper_id?: string | null;
          match_by?: string | null;
          receipt_amount?: number | null;
          handover_proof_at?: string | null;
          price?: number | null;
          buyer_fee?: number | null;
          seller_id?: string | null;
          buyer_id?: string | null;
          code?: string | null;
          handed_over_at?: string | null;
          held_amount?: number;
          payment_ref?: string | null;
          check_hours: number;
          check_until?: string | null;
          created_at?: string;
          updated_at?: string;
          pickup_address?: string | null;
          pay_by?: string | null;
          details?: Json;
          top_up?: Json | null;
          posted_fee?: number | null;
          pickup_lat?: number | null;
          pickup_lng?: number | null;
          price_change?: Json | null;
          invited_helper_id?: string | null;
          invite_until?: string | null;
          invite_open_after?: boolean;
          provider_refs?: string[];
          payee_org_id?: string | null;
          assigned_at?: string | null;
          pay_mode?: string;
          en_route_at?: string | null;
          arrive_extend_minutes?: number | null;
          absent_at?: string | null;
        };
        Update: {
          id?: string;
          version?: number;
          type?: "errand" | "goods";
          status?:
            | "awaiting_payment"
            | "open"
            | "matched"
            | "in_progress"
            | "held"
            | "check"
            | "disputed"
            | "released"
            | "refunded"
            | "cancelled"
            | "expired";
          title?: string;
          description?: string;
          category?:
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly"
            | null;
          mode?: "now" | "schedule" | null;
          scheduled_at?: string | null;
          address?: string | null;
          lat?: number | null;
          lng?: number | null;
          item_budget?: number | null;
          fee?: number | null;
          service_fee?: number | null;
          commission_bps?: number | null;
          cancel_fee?: number | null;
          max_applicants?: number | null;
          match_window_minutes?: number | null;
          customer_id?: string | null;
          helper_id?: string | null;
          match_by?: string | null;
          receipt_amount?: number | null;
          handover_proof_at?: string | null;
          price?: number | null;
          buyer_fee?: number | null;
          seller_id?: string | null;
          buyer_id?: string | null;
          code?: string | null;
          handed_over_at?: string | null;
          held_amount?: number;
          payment_ref?: string | null;
          check_hours?: number;
          check_until?: string | null;
          created_at?: string;
          updated_at?: string;
          pickup_address?: string | null;
          pay_by?: string | null;
          details?: Json;
          top_up?: Json | null;
          posted_fee?: number | null;
          pickup_lat?: number | null;
          pickup_lng?: number | null;
          price_change?: Json | null;
          invited_helper_id?: string | null;
          invite_until?: string | null;
          invite_open_after?: boolean;
          provider_refs?: string[];
          payee_org_id?: string | null;
          assigned_at?: string | null;
          pay_mode?: string;
          en_route_at?: string | null;
          arrive_extend_minutes?: number | null;
          absent_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "deals_buyer_id_fkey";
            columns: ["buyer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deals_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deals_helper_id_fkey";
            columns: ["helper_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deals_invited_helper_id_fkey";
            columns: ["invited_helper_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deals_payee_org_id_fkey";
            columns: ["payee_org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deals_seller_id_fkey";
            columns: ["seller_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      desktop_work_notice_preferences: {
        Row: {
          user_id: string;
          hidden: boolean;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          hidden?: boolean;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          hidden?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "desktop_work_notice_preferences_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      direct_payments: {
        Row: {
          deal_id: string;
          amount: number;
          customer_paid_at: string | null;
          helper_received_at: string | null;
          unpaid_reported_at: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          note: string | null;
          updated_at: string;
        };
        Insert: {
          deal_id: string;
          amount: number;
          customer_paid_at?: string | null;
          helper_received_at?: string | null;
          unpaid_reported_at?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          note?: string | null;
          updated_at?: string;
        };
        Update: {
          deal_id?: string;
          amount?: number;
          customer_paid_at?: string | null;
          helper_received_at?: string | null;
          unpaid_reported_at?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          note?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "direct_payments_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: true;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "direct_payments_resolved_by_fkey";
            columns: ["resolved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      dispatch_offers: {
        Row: {
          deal_id: string;
          helper_id: string;
          wave: number;
          distance_km: number | null;
          score: number;
          status: string;
          sent_at: string;
          expires_at: string;
        };
        Insert: {
          deal_id: string;
          helper_id: string;
          wave: number;
          distance_km?: number | null;
          score: number;
          status?: string;
          sent_at?: string;
          expires_at: string;
        };
        Update: {
          deal_id?: string;
          helper_id?: string;
          wave?: number;
          distance_km?: number | null;
          score?: number;
          status?: string;
          sent_at?: string;
          expires_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "dispatch_offers_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: false;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dispatch_offers_helper_id_fkey";
            columns: ["helper_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      dispatch_state: {
        Row: {
          deal_id: string;
          wave: number;
          wave_started_at: string;
          notified: number;
        };
        Insert: {
          deal_id: string;
          wave: number;
          wave_started_at: string;
          notified?: number;
        };
        Update: {
          deal_id?: string;
          wave?: number;
          wave_started_at?: string;
          notified?: number;
        };
        Relationships: [
          {
            foreignKeyName: "dispatch_state_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: true;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
        ];
      };
      disputes: {
        Row: {
          id: string;
          deal_id: string;
          opened_by: string;
          reason: string;
          note: string;
          outcome: "release" | "refund" | null;
          decided_by: string | null;
          decided_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          deal_id: string;
          opened_by: string;
          reason: string;
          note?: string;
          outcome?: "release" | "refund" | null;
          decided_by?: string | null;
          decided_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          deal_id?: string;
          opened_by?: string;
          reason?: string;
          note?: string;
          outcome?: "release" | "refund" | null;
          decided_by?: string | null;
          decided_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "disputes_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: true;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "disputes_decided_by_fkey";
            columns: ["decided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "disputes_opened_by_fkey";
            columns: ["opened_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      handover_codes: {
        Row: {
          deal_id: string;
          code: string;
          verified_at: string | null;
          failed_attempts: number;
          locked_until: string | null;
        };
        Insert: {
          deal_id: string;
          code: string;
          verified_at?: string | null;
          failed_attempts?: number;
          locked_until?: string | null;
        };
        Update: {
          deal_id?: string;
          code?: string;
          verified_at?: string | null;
          failed_attempts?: number;
          locked_until?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "handover_codes_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: true;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
        ];
      };
      helper_applications: {
        Row: {
          id: string;
          user_id: string;
          status: string;
          legal_name: string;
          id_last4: string;
          birth_date: string | null;
          categories: (
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly"
          )[];
          id_front_path: string | null;
          id_back_path: string | null;
          selfie_path: string | null;
          record_path: string | null;
          consent_at: string;
          submitted_at: string;
          decided_at: string | null;
          decided_by: string | null;
          decision_note: string | null;
          files_purged_at: string | null;
          purpose: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          status?: string;
          legal_name: string;
          id_last4: string;
          birth_date?: string | null;
          categories: (
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly"
          )[];
          id_front_path?: string | null;
          id_back_path?: string | null;
          selfie_path?: string | null;
          record_path?: string | null;
          consent_at: string;
          submitted_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_note?: string | null;
          files_purged_at?: string | null;
          purpose?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          status?: string;
          legal_name?: string;
          id_last4?: string;
          birth_date?: string | null;
          categories?: (
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly"
          )[];
          id_front_path?: string | null;
          id_back_path?: string | null;
          selfie_path?: string | null;
          record_path?: string | null;
          consent_at?: string;
          submitted_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_note?: string | null;
          files_purged_at?: string | null;
          purpose?: string;
        };
        Relationships: [
          {
            foreignKeyName: "helper_applications_decided_by_fkey";
            columns: ["decided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "helper_applications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      helper_badges: {
        Row: {
          id: string;
          helper_id: string;
          kind: string;
          status: string;
          doc_path: string;
          info: Json;
          expires_on: string | null;
          review_note: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          helper_id: string;
          kind: string;
          status?: string;
          doc_path: string;
          info?: Json;
          expires_on?: string | null;
          review_note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          helper_id?: string;
          kind?: string;
          status?: string;
          doc_path?: string;
          info?: Json;
          expires_on?: string | null;
          review_note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "helper_badges_helper_id_fkey";
            columns: ["helper_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "helper_badges_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      helper_certificates: {
        Row: {
          id: string;
          helper_id: string;
          category:
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly";
          number: string | null;
          issuer: string;
          expires_on: string | null;
          doc_path: string;
          status: string;
          review_note: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
          first_aid: boolean;
        };
        Insert: {
          id?: string;
          helper_id: string;
          category:
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly";
          number?: string | null;
          issuer: string;
          expires_on?: string | null;
          doc_path: string;
          status?: string;
          review_note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
          first_aid?: boolean;
        };
        Update: {
          id?: string;
          helper_id?: string;
          category?:
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly";
          number?: string | null;
          issuer?: string;
          expires_on?: string | null;
          doc_path?: string;
          status?: string;
          review_note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
          first_aid?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "helper_certificates_helper_id_fkey";
            columns: ["helper_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "helper_certificates_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      helper_marks: {
        Row: {
          id: string;
          helper_id: string;
          deal_id: string;
          kind: string;
          created_at: string;
          appeal_note: string | null;
          appealed_at: string | null;
          voided_at: string | null;
          voided_by: string | null;
        };
        Insert: {
          id?: string;
          helper_id: string;
          deal_id: string;
          kind: string;
          created_at?: string;
          appeal_note?: string | null;
          appealed_at?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          id?: string;
          helper_id?: string;
          deal_id?: string;
          kind?: string;
          created_at?: string;
          appeal_note?: string | null;
          appealed_at?: string | null;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "helper_marks_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: false;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "helper_marks_helper_id_fkey";
            columns: ["helper_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "helper_marks_voided_by_fkey";
            columns: ["voided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      helper_penalties: {
        Row: {
          id: string;
          helper_id: string;
          deal_id: string;
          pause_days: number;
          nth_in_30d: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          helper_id: string;
          deal_id: string;
          pause_days: number;
          nth_in_30d: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          helper_id?: string;
          deal_id?: string;
          pause_days?: number;
          nth_in_30d?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "helper_penalties_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: false;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "helper_penalties_helper_id_fkey";
            columns: ["helper_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      helper_presence: {
        Row: {
          user_id: string;
          online: boolean;
          lat: number | null;
          lng: number | null;
          radius_km: number;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          online?: boolean;
          lat?: number | null;
          lng?: number | null;
          radius_km?: number;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          online?: boolean;
          lat?: number | null;
          lng?: number | null;
          radius_km?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "helper_presence_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      incidents: {
        Row: {
          id: string;
          deal_id: string;
          reporter_id: string;
          subject_id: string | null;
          kind: "sos" | "unsafe" | "harassment" | "theft" | "damage" | "scam" | "other";
          note: string;
          lat: number | null;
          lng: number | null;
          accuracy_m: number | null;
          status: "open" | "acknowledged" | "resolved";
          ops_note: string | null;
          handled_by: string | null;
          alerts: number;
          last_alert_at: string;
          ops_pinged_at: string | null;
          acknowledged_at: string | null;
          resolved_at: string | null;
          location_purged_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          deal_id: string;
          reporter_id: string;
          subject_id?: string | null;
          kind: "sos" | "unsafe" | "harassment" | "theft" | "damage" | "scam" | "other";
          note?: string;
          lat?: number | null;
          lng?: number | null;
          accuracy_m?: number | null;
          status?: "open" | "acknowledged" | "resolved";
          ops_note?: string | null;
          handled_by?: string | null;
          alerts?: number;
          last_alert_at?: string;
          ops_pinged_at?: string | null;
          acknowledged_at?: string | null;
          resolved_at?: string | null;
          location_purged_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          deal_id?: string;
          reporter_id?: string;
          subject_id?: string | null;
          kind?: "sos" | "unsafe" | "harassment" | "theft" | "damage" | "scam" | "other";
          note?: string;
          lat?: number | null;
          lng?: number | null;
          accuracy_m?: number | null;
          status?: "open" | "acknowledged" | "resolved";
          ops_note?: string | null;
          handled_by?: string | null;
          alerts?: number;
          last_alert_at?: string;
          ops_pinged_at?: string | null;
          acknowledged_at?: string | null;
          resolved_at?: string | null;
          location_purged_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "incidents_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: false;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incidents_handled_by_fkey";
            columns: ["handled_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incidents_reporter_id_fkey";
            columns: ["reporter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incidents_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      job_location_points: {
        Row: {
          id: number;
          deal_id: string;
          helper_id: string;
          lat: number;
          lng: number;
          recorded_at: string;
        };
        Insert: {
          id?: never;
          deal_id: string;
          helper_id: string;
          lat: number;
          lng: number;
          recorded_at?: string;
        };
        Update: {
          id?: never;
          deal_id?: string;
          helper_id?: string;
          lat?: number;
          lng?: number;
          recorded_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_location_points_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: false;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_location_points_helper_id_fkey";
            columns: ["helper_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      job_locations: {
        Row: {
          deal_id: string;
          helper_id: string;
          lat: number | null;
          lng: number | null;
          updated_at: string;
          nudged_at: string | null;
        };
        Insert: {
          deal_id: string;
          helper_id: string;
          lat?: number | null;
          lng?: number | null;
          updated_at?: string;
          nudged_at?: string | null;
        };
        Update: {
          deal_id?: string;
          helper_id?: string;
          lat?: number | null;
          lng?: number | null;
          updated_at?: string;
          nudged_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "job_locations_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: true;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_locations_helper_id_fkey";
            columns: ["helper_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      ledger_entries: {
        Row: {
          id: number;
          deal_id: string | null;
          kind:
            | "pay_in"
            | "release_fee"
            | "item_reimburse"
            | "budget_refund"
            | "platform_fee"
            | "release_seller"
            | "cancel_fee"
            | "refund"
            | "withdrawal";
          amount: number;
          from_account: string;
          to_account: string;
          provider_ref: string | null;
          created_at: string;
        };
        Insert: {
          id?: never;
          deal_id?: string | null;
          kind:
            | "pay_in"
            | "release_fee"
            | "item_reimburse"
            | "budget_refund"
            | "platform_fee"
            | "release_seller"
            | "cancel_fee"
            | "refund"
            | "withdrawal";
          amount: number;
          from_account: string;
          to_account: string;
          provider_ref?: string | null;
          created_at?: string;
        };
        Update: {
          id?: never;
          deal_id?: string | null;
          kind?:
            | "pay_in"
            | "release_fee"
            | "item_reimburse"
            | "budget_refund"
            | "platform_fee"
            | "release_seller"
            | "cancel_fee"
            | "refund"
            | "withdrawal";
          amount?: number;
          from_account?: string;
          to_account?: string;
          provider_ref?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ledger_entries_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: false;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
        ];
      };
      legal_acceptances: {
        Row: {
          user_id: string;
          document: string;
          version: string;
          accepted_at: string;
        };
        Insert: {
          user_id: string;
          document: string;
          version: string;
          accepted_at?: string;
        };
        Update: {
          user_id?: string;
          document?: string;
          version?: string;
          accepted_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "legal_acceptances_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          id: string;
          deal_id: string;
          from_user_id: string | null;
          text: string;
          is_system: boolean;
          created_at: string;
          helper_id: string | null;
          image_path: string | null;
          flags: string[];
          seen_at: string | null;
          audio_path: string | null;
          audio_seconds: number | null;
        };
        Insert: {
          id?: string;
          deal_id: string;
          from_user_id?: string | null;
          text: string;
          is_system?: boolean;
          created_at?: string;
          helper_id?: string | null;
          image_path?: string | null;
          flags?: string[];
          seen_at?: string | null;
          audio_path?: string | null;
          audio_seconds?: number | null;
        };
        Update: {
          id?: string;
          deal_id?: string;
          from_user_id?: string | null;
          text?: string;
          is_system?: boolean;
          created_at?: string;
          helper_id?: string | null;
          image_path?: string | null;
          flags?: string[];
          seen_at?: string | null;
          audio_path?: string | null;
          audio_seconds?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "messages_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: false;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_from_user_id_fkey";
            columns: ["from_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_helper_id_fkey";
            columns: ["helper_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      offers: {
        Row: {
          id: string;
          deal_id: string;
          helper_id: string;
          note: string;
          created_at: string;
          price: number | null;
          proposed_by: string;
          org_id: string | null;
        };
        Insert: {
          id?: string;
          deal_id: string;
          helper_id: string;
          note?: string;
          created_at?: string;
          price?: number | null;
          proposed_by?: string;
          org_id?: string | null;
        };
        Update: {
          id?: string;
          deal_id?: string;
          helper_id?: string;
          note?: string;
          created_at?: string;
          price?: number | null;
          proposed_by?: string;
          org_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "offers_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: false;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "offers_helper_id_fkey";
            columns: ["helper_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "offers_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      ops_audit_log: {
        Row: {
          id: number;
          actor_id: string;
          action: string;
          target: string | null;
          data: Json;
          created_at: string;
        };
        Insert: {
          id?: never;
          actor_id: string;
          action: string;
          target?: string | null;
          data?: Json;
          created_at?: string;
        };
        Update: {
          id?: never;
          actor_id?: string;
          action?: string;
          target?: string | null;
          data?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ops_audit_log_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      org_members: {
        Row: {
          org_id: string;
          helper_id: string;
          role: string;
          categories: (
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly"
          )[];
          status: string;
          invited_by: string | null;
          created_at: string;
          decided_at: string | null;
        };
        Insert: {
          org_id: string;
          helper_id: string;
          role?: string;
          categories?: (
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly"
          )[];
          status?: string;
          invited_by?: string | null;
          created_at?: string;
          decided_at?: string | null;
        };
        Update: {
          org_id?: string;
          helper_id?: string;
          role?: string;
          categories?: (
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly"
          )[];
          status?: string;
          invited_by?: string | null;
          created_at?: string;
          decided_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "org_members_helper_id_fkey";
            columns: ["helper_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "org_members_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "org_members_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_payout_accounts: {
        Row: {
          org_id: string;
          bank: string;
          account_number: string;
          holder_name: string;
          updated_at: string;
        };
        Insert: {
          org_id: string;
          bank: string;
          account_number: string;
          holder_name: string;
          updated_at?: string;
        };
        Update: {
          org_id?: string;
          bank?: string;
          account_number?: string;
          holder_name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_payout_accounts_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          id: string;
          name: string;
          reg_number: string;
          kind: string;
          description: string | null;
          area: string | null;
          owner_id: string;
          requested_categories: (
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly"
          )[];
          categories: (
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly"
          )[];
          status: string;
          doc_path: string | null;
          review_note: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          reg_number: string;
          kind: string;
          description?: string | null;
          area?: string | null;
          owner_id: string;
          requested_categories?: (
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly"
          )[];
          categories?: (
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly"
          )[];
          status?: string;
          doc_path?: string | null;
          review_note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          reg_number?: string;
          kind?: string;
          description?: string | null;
          area?: string | null;
          owner_id?: string;
          requested_categories?: (
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly"
          )[];
          categories?: (
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly"
          )[];
          status?: string;
          doc_path?: string | null;
          review_note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organizations_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organizations_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      payout_accounts: {
        Row: {
          user_id: string;
          bank: string;
          account_number: string;
          holder_name: string;
          verified_at: string | null;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          bank: string;
          account_number: string;
          holder_name: string;
          verified_at?: string | null;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          bank?: string;
          account_number?: string;
          holder_name?: string;
          verified_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payout_accounts_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_controls: {
        Row: {
          id: boolean;
          posting_paused: boolean;
          payments_paused: boolean;
          pause_note: string | null;
          max_deal_amount: number;
          max_customer_daily: number;
          max_total_held: number;
          max_open_tasks: number;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          id?: boolean;
          posting_paused?: boolean;
          payments_paused?: boolean;
          pause_note?: string | null;
          max_deal_amount?: number;
          max_customer_daily?: number;
          max_total_held?: number;
          max_open_tasks?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          id?: boolean;
          posting_paused?: boolean;
          payments_paused?: boolean;
          pause_note?: string | null;
          max_deal_amount?: number;
          max_customer_daily?: number;
          max_total_held?: number;
          max_open_tasks?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "platform_controls_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_rules: {
        Row: {
          id: boolean;
          payment_window_minutes: number;
          back_out_grace_minutes: number;
          now_match_window_minutes: number;
          schedule_match_window_hours: number;
          application_minutes: number;
          auto_pick_minutes: number;
          invite_minutes: number;
          invite_minutes_scheduled: number;
          max_applicants: number;
          check_hours: number;
          pause_days_first: number;
          pause_days_second: number;
          pause_days_more: number;
          care_pause_days: number;
          care_day_start_hour: number;
          care_day_end_hour: number;
          care_max_minutes: number;
          care_call_min_seconds: number;
          dispatch_waves: Json;
          updated_at: string;
          updated_by: string | null;
          pay_mode: string;
          payment_window_booked_minutes: number;
          withdraw_min: number;
          withdrawals_per_day: number;
          auto_payout_days: number;
          dayjob_pair_month_cap: number;
          arrive_minutes: number;
          late_grace_minutes: number;
          arrive_radius_m: number;
          position_max_age_seconds: number;
          location_stale_minutes: number;
          route_retention_days: number;
          marks_window_days: number;
          marks_rank_lower: number;
          marks_pause: number;
          marks_pause_days: number;
          marks_review: number;
          nudge_after_minutes: number;
          max_pending_applications: number;
          ready_position_minutes: number;
          sos_reping_minutes: number;
          sos_reping_for_minutes: number;
          chat_retention_days: number;
          settle_hours: number;
          absent_grace_minutes: number;
          max_delay_minutes: number;
        };
        Insert: {
          id?: boolean;
          payment_window_minutes?: number;
          back_out_grace_minutes?: number;
          now_match_window_minutes?: number;
          schedule_match_window_hours?: number;
          application_minutes?: number;
          auto_pick_minutes?: number;
          invite_minutes?: number;
          invite_minutes_scheduled?: number;
          max_applicants?: number;
          check_hours?: number;
          pause_days_first?: number;
          pause_days_second?: number;
          pause_days_more?: number;
          care_pause_days?: number;
          care_day_start_hour?: number;
          care_day_end_hour?: number;
          care_max_minutes?: number;
          care_call_min_seconds?: number;
          dispatch_waves?: Json;
          updated_at?: string;
          updated_by?: string | null;
          pay_mode?: string;
          payment_window_booked_minutes?: number;
          withdraw_min?: number;
          withdrawals_per_day?: number;
          auto_payout_days?: number;
          dayjob_pair_month_cap?: number;
          arrive_minutes?: number;
          late_grace_minutes?: number;
          arrive_radius_m?: number;
          position_max_age_seconds?: number;
          location_stale_minutes?: number;
          route_retention_days?: number;
          marks_window_days?: number;
          marks_rank_lower?: number;
          marks_pause?: number;
          marks_pause_days?: number;
          marks_review?: number;
          nudge_after_minutes?: number;
          max_pending_applications?: number;
          ready_position_minutes?: number;
          sos_reping_minutes?: number;
          sos_reping_for_minutes?: number;
          chat_retention_days?: number;
          settle_hours?: number;
          absent_grace_minutes?: number;
          max_delay_minutes?: number;
        };
        Update: {
          id?: boolean;
          payment_window_minutes?: number;
          back_out_grace_minutes?: number;
          now_match_window_minutes?: number;
          schedule_match_window_hours?: number;
          application_minutes?: number;
          auto_pick_minutes?: number;
          invite_minutes?: number;
          invite_minutes_scheduled?: number;
          max_applicants?: number;
          check_hours?: number;
          pause_days_first?: number;
          pause_days_second?: number;
          pause_days_more?: number;
          care_pause_days?: number;
          care_day_start_hour?: number;
          care_day_end_hour?: number;
          care_max_minutes?: number;
          care_call_min_seconds?: number;
          dispatch_waves?: Json;
          updated_at?: string;
          updated_by?: string | null;
          pay_mode?: string;
          payment_window_booked_minutes?: number;
          withdraw_min?: number;
          withdrawals_per_day?: number;
          auto_payout_days?: number;
          dayjob_pair_month_cap?: number;
          arrive_minutes?: number;
          late_grace_minutes?: number;
          arrive_radius_m?: number;
          position_max_age_seconds?: number;
          location_stale_minutes?: number;
          route_retention_days?: number;
          marks_window_days?: number;
          marks_rank_lower?: number;
          marks_pause?: number;
          marks_pause_days?: number;
          marks_review?: number;
          nudge_after_minutes?: number;
          max_pending_applications?: number;
          ready_position_minutes?: number;
          sos_reping_minutes?: number;
          sos_reping_for_minutes?: number;
          chat_retention_days?: number;
          settle_hours?: number;
          absent_grace_minutes?: number;
          max_delay_minutes?: number;
        };
        Relationships: [
          {
            foreignKeyName: "platform_rules_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      pricing_settings: {
        Row: {
          id: boolean;
          base_fee: number;
          included_minutes: number;
          included_km: number;
          per_half_hour: number;
          per_km: number;
          heavy_fee: number;
          per_floor: number;
          tools_fee: number;
          night_fee: number;
          round_trip_bps: number;
          price_down_bps: number;
          price_up_bps: number;
          counter_up_bps: number;
          service_fee_tiers: Json;
          updated_at: string;
          updated_by: string | null;
          travel_min_per_km: number;
          cancel_fee: number;
          free_open_tasks: number;
          extra_task_fee: number;
          suggest_bps: number;
          max_job_total: number;
          service_fee_bps: number;
          service_fee_min: number;
          service_fee_max: number;
          first_task_free: boolean;
          night_start_hour: number;
          night_end_hour: number;
        };
        Insert: {
          id?: boolean;
          base_fee?: number;
          included_minutes?: number;
          included_km?: number;
          per_half_hour?: number;
          per_km?: number;
          heavy_fee?: number;
          per_floor?: number;
          tools_fee?: number;
          night_fee?: number;
          round_trip_bps?: number;
          price_down_bps?: number;
          price_up_bps?: number;
          counter_up_bps?: number;
          service_fee_tiers?: Json;
          updated_at?: string;
          updated_by?: string | null;
          travel_min_per_km?: number;
          cancel_fee?: number;
          free_open_tasks?: number;
          extra_task_fee?: number;
          suggest_bps?: number;
          max_job_total?: number;
          service_fee_bps?: number;
          service_fee_min?: number;
          service_fee_max?: number;
          first_task_free?: boolean;
          night_start_hour?: number;
          night_end_hour?: number;
        };
        Update: {
          id?: boolean;
          base_fee?: number;
          included_minutes?: number;
          included_km?: number;
          per_half_hour?: number;
          per_km?: number;
          heavy_fee?: number;
          per_floor?: number;
          tools_fee?: number;
          night_fee?: number;
          round_trip_bps?: number;
          price_down_bps?: number;
          price_up_bps?: number;
          counter_up_bps?: number;
          service_fee_tiers?: Json;
          updated_at?: string;
          updated_by?: string | null;
          travel_min_per_km?: number;
          cancel_fee?: number;
          free_open_tasks?: number;
          extra_task_fee?: number;
          suggest_bps?: number;
          max_job_total?: number;
          service_fee_bps?: number;
          service_fee_min?: number;
          service_fee_max?: number;
          first_task_free?: boolean;
          night_start_hour?: number;
          night_end_hour?: number;
        };
        Relationships: [
          {
            foreignKeyName: "pricing_settings_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          id: string;
          name: string;
          phone: string | null;
          role: "customer" | "helper" | "admin";
          kyc_level: number;
          helper_status: "pending" | "approved" | "rejected" | null;
          verified_name: string | null;
          categories: (
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly"
          )[];
          area: string | null;
          rating_sum: number;
          rating_count: number;
          completed_count: number;
          payout_bank: string | null;
          payout_account_last4: string | null;
          payout_holder_name: string | null;
          suspended_until: string | null;
          created_at: string;
          bio: string | null;
          from_price: number | null;
          languages: string[];
          terms_version: string | null;
          privacy_version: string | null;
          helper_terms_version: string | null;
          deleted_at: string | null;
          age_confirmed_at: string | null;
          test_helper: boolean;
          desktop_work_enabled: boolean;
          customer_rating_sum: number;
          customer_rating_count: number;
          experience_years: number | null;
          transport: string[];
          age_band: number | null;
          show_age_band: boolean;
        };
        Insert: {
          id: string;
          name?: string;
          phone?: string | null;
          role?: "customer" | "helper" | "admin";
          kyc_level?: number;
          helper_status?: "pending" | "approved" | "rejected" | null;
          verified_name?: string | null;
          categories?: (
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly"
          )[];
          area?: string | null;
          rating_sum?: number;
          rating_count?: number;
          completed_count?: number;
          payout_bank?: string | null;
          payout_account_last4?: string | null;
          payout_holder_name?: string | null;
          suspended_until?: string | null;
          created_at?: string;
          bio?: string | null;
          from_price?: number | null;
          languages?: string[];
          terms_version?: string | null;
          privacy_version?: string | null;
          helper_terms_version?: string | null;
          deleted_at?: string | null;
          age_confirmed_at?: string | null;
          test_helper?: boolean;
          desktop_work_enabled?: boolean;
          customer_rating_sum?: number;
          customer_rating_count?: number;
          experience_years?: number | null;
          transport?: string[];
          age_band?: number | null;
          show_age_band?: boolean;
        };
        Update: {
          id?: string;
          name?: string;
          phone?: string | null;
          role?: "customer" | "helper" | "admin";
          kyc_level?: number;
          helper_status?: "pending" | "approved" | "rejected" | null;
          verified_name?: string | null;
          categories?: (
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly"
          )[];
          area?: string | null;
          rating_sum?: number;
          rating_count?: number;
          completed_count?: number;
          payout_bank?: string | null;
          payout_account_last4?: string | null;
          payout_holder_name?: string | null;
          suspended_until?: string | null;
          created_at?: string;
          bio?: string | null;
          from_price?: number | null;
          languages?: string[];
          terms_version?: string | null;
          privacy_version?: string | null;
          helper_terms_version?: string | null;
          deleted_at?: string | null;
          age_confirmed_at?: string | null;
          test_helper?: boolean;
          desktop_work_enabled?: boolean;
          customer_rating_sum?: number;
          customer_rating_count?: number;
          experience_years?: number | null;
          transport?: string[];
          age_band?: number | null;
          show_age_band?: boolean;
        };
        Relationships: [];
      };
      proofs: {
        Row: {
          id: string;
          deal_id: string;
          kind: "receipt" | "handover" | "start" | "progress";
          file_path: string | null;
          amount: number | null;
          lat: number | null;
          lng: number | null;
          taken_at: string | null;
          uploaded_by: string;
          created_at: string;
          mime: string | null;
          bytes: number | null;
          sha256: string | null;
          dhash: string | null;
          flags: string[];
          ai: Json | null;
          note: string | null;
          removed_at: string | null;
          removed_by: string | null;
        };
        Insert: {
          id?: string;
          deal_id: string;
          kind: "receipt" | "handover" | "start" | "progress";
          file_path?: string | null;
          amount?: number | null;
          lat?: number | null;
          lng?: number | null;
          taken_at?: string | null;
          uploaded_by: string;
          created_at?: string;
          mime?: string | null;
          bytes?: number | null;
          sha256?: string | null;
          dhash?: string | null;
          flags?: string[];
          ai?: Json | null;
          note?: string | null;
          removed_at?: string | null;
          removed_by?: string | null;
        };
        Update: {
          id?: string;
          deal_id?: string;
          kind?: "receipt" | "handover" | "start" | "progress";
          file_path?: string | null;
          amount?: number | null;
          lat?: number | null;
          lng?: number | null;
          taken_at?: string | null;
          uploaded_by?: string;
          created_at?: string;
          mime?: string | null;
          bytes?: number | null;
          sha256?: string | null;
          dhash?: string | null;
          flags?: string[];
          ai?: Json | null;
          note?: string | null;
          removed_at?: string | null;
          removed_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "proofs_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: false;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proofs_removed_by_fkey";
            columns: ["removed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "proofs_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_events: {
        Row: {
          id: string;
          type: string;
          received_at: string;
        };
        Insert: {
          id: string;
          type: string;
          received_at?: string;
        };
        Update: {
          id?: string;
          type?: string;
          received_at?: string;
        };
        Relationships: [];
      };
      provider_payments: {
        Row: {
          id: string;
          provider: string;
          deal_id: string;
          purpose: string;
          amount: number;
          status: string;
          checkout_url: string | null;
          charge_id: string | null;
          created_at: string;
          updated_at: string;
          succeeded_at: string | null;
          needs_reconciliation: boolean;
        };
        Insert: {
          id: string;
          provider: string;
          deal_id: string;
          purpose: string;
          amount: number;
          status?: string;
          checkout_url?: string | null;
          charge_id?: string | null;
          created_at?: string;
          updated_at?: string;
          succeeded_at?: string | null;
          needs_reconciliation?: boolean;
        };
        Update: {
          id?: string;
          provider?: string;
          deal_id?: string;
          purpose?: string;
          amount?: number;
          status?: string;
          checkout_url?: string | null;
          charge_id?: string | null;
          created_at?: string;
          updated_at?: string;
          succeeded_at?: string | null;
          needs_reconciliation?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "provider_payments_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: false;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
        ];
      };
      provider_refunds: {
        Row: {
          id: string;
          deal_id: string;
          payment_id: string;
          amount: number;
          status: string;
          provider_ref: string | null;
          reason: string | null;
          error: string | null;
          attempts: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          deal_id: string;
          payment_id: string;
          amount: number;
          status?: string;
          provider_ref?: string | null;
          reason?: string | null;
          error?: string | null;
          attempts?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          deal_id?: string;
          payment_id?: string;
          amount?: number;
          status?: string;
          provider_ref?: string | null;
          reason?: string | null;
          error?: string | null;
          attempts?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "provider_refunds_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: false;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "provider_refunds_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "provider_payments";
            referencedColumns: ["id"];
          },
        ];
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          locale: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          locale?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          endpoint?: string;
          p256dh?: string;
          auth?: string;
          locale?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      quick_starts: {
        Row: {
          id: string;
          kind: string;
          category:
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly";
          title_mn: string;
          title_en: string;
          months: number[];
          sort: number;
          active: boolean;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          id?: string;
          kind: string;
          category:
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly";
          title_mn: string;
          title_en: string;
          months?: number[];
          sort?: number;
          active?: boolean;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          id?: string;
          kind?: string;
          category?:
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly";
          title_mn?: string;
          title_en?: string;
          months?: number[];
          sort?: number;
          active?: boolean;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "quick_starts_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      ratings: {
        Row: {
          id: string;
          deal_id: string;
          from_user_id: string;
          to_user_id: string;
          stars: number;
          tags: string[];
          created_at: string;
          note: string | null;
          about: string;
        };
        Insert: {
          id?: string;
          deal_id: string;
          from_user_id: string;
          to_user_id: string;
          stars: number;
          tags?: string[];
          created_at?: string;
          note?: string | null;
          about?: string;
        };
        Update: {
          id?: string;
          deal_id?: string;
          from_user_id?: string;
          to_user_id?: string;
          stars?: number;
          tags?: string[];
          created_at?: string;
          note?: string | null;
          about?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ratings_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: false;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ratings_from_user_id_fkey";
            columns: ["from_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ratings_to_user_id_fkey";
            columns: ["to_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      recipient_verifications: {
        Row: {
          deal_id: string;
          owner_id: string;
          phone: string;
          share_token_hash: string;
          status: string;
          session_attempts: number;
          provider_session_id: string | null;
          sms_uri: string | null;
          display_instruction: string | null;
          session_expires_at: string | null;
          verified_at: string | null;
          invite_expires_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          deal_id: string;
          owner_id: string;
          phone: string;
          share_token_hash: string;
          status?: string;
          session_attempts?: number;
          provider_session_id?: string | null;
          sms_uri?: string | null;
          display_instruction?: string | null;
          session_expires_at?: string | null;
          verified_at?: string | null;
          invite_expires_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          deal_id?: string;
          owner_id?: string;
          phone?: string;
          share_token_hash?: string;
          status?: string;
          session_attempts?: number;
          provider_session_id?: string | null;
          sms_uri?: string | null;
          display_instruction?: string | null;
          session_expires_at?: string | null;
          verified_at?: string | null;
          invite_expires_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recipient_verifications_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: true;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recipient_verifications_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      saved_addresses: {
        Row: {
          id: string;
          user_id: string;
          kind: string;
          label: string | null;
          address: string;
          entrance: string | null;
          floor: number | null;
          unit: string | null;
          lift: string | null;
          note: string | null;
          created_at: string;
          updated_at: string;
          lat: number | null;
          lng: number | null;
        };
        Insert: {
          id?: string;
          user_id?: string;
          kind: string;
          label?: string | null;
          address: string;
          entrance?: string | null;
          floor?: number | null;
          unit?: string | null;
          lift?: string | null;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
          lat?: number | null;
          lng?: number | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          kind?: string;
          label?: string | null;
          address?: string;
          entrance?: string | null;
          floor?: number | null;
          unit?: string | null;
          lift?: string | null;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
          lat?: number | null;
          lng?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "saved_addresses_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      saved_helpers: {
        Row: {
          customer_id: string;
          helper_id: string;
          created_at: string;
        };
        Insert: {
          customer_id: string;
          helper_id: string;
          created_at?: string;
        };
        Update: {
          customer_id?: string;
          helper_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "saved_helpers_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "saved_helpers_helper_id_fkey";
            columns: ["helper_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      support_requests: {
        Row: {
          id: string;
          user_id: string;
          topic: string;
          message: string;
          status: string;
          ops_note: string | null;
          created_at: string;
          handled_at: string | null;
          handled_by: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          topic: string;
          message: string;
          status?: string;
          ops_note?: string | null;
          created_at?: string;
          handled_at?: string | null;
          handled_by?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          topic?: string;
          message?: string;
          status?: string;
          ops_note?: string | null;
          created_at?: string;
          handled_at?: string | null;
          handled_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "support_requests_handled_by_fkey";
            columns: ["handled_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_requests_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      support_settings: {
        Row: {
          id: boolean;
          phone: string | null;
          email: string | null;
          facebook: string | null;
          hours: string | null;
          updated_at: string;
          updated_by: string | null;
          company_name: string | null;
          company_reg_no: string | null;
          company_address: string | null;
        };
        Insert: {
          id?: boolean;
          phone?: string | null;
          email?: string | null;
          facebook?: string | null;
          hours?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          company_name?: string | null;
          company_reg_no?: string | null;
          company_address?: string | null;
        };
        Update: {
          id?: boolean;
          phone?: string | null;
          email?: string | null;
          facebook?: string | null;
          hours?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          company_name?: string | null;
          company_reg_no?: string | null;
          company_address?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "support_settings_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      system_heartbeats: {
        Row: {
          name: string;
          last_run_at: string;
          last_ok_at: string | null;
          last_error: string | null;
          last_result: Json | null;
        };
        Insert: {
          name: string;
          last_run_at: string;
          last_ok_at?: string | null;
          last_error?: string | null;
          last_result?: Json | null;
        };
        Update: {
          name?: string;
          last_run_at?: string;
          last_ok_at?: string | null;
          last_error?: string | null;
          last_result?: Json | null;
        };
        Relationships: [];
      };
      task_photos: {
        Row: {
          id: string;
          deal_id: string | null;
          file_path: string;
          bytes: number;
          uploaded_by: string;
          created_at: string;
          attached_at: string | null;
        };
        Insert: {
          id?: string;
          deal_id?: string | null;
          file_path: string;
          bytes: number;
          uploaded_by: string;
          created_at?: string;
          attached_at?: string | null;
        };
        Update: {
          id?: string;
          deal_id?: string | null;
          file_path?: string;
          bytes?: number;
          uploaded_by?: string;
          created_at?: string;
          attached_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "task_photos_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: false;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_photos_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      timeline_events: {
        Row: {
          id: number;
          deal_id: string;
          code: string;
          data: Json;
          created_at: string;
        };
        Insert: {
          id?: never;
          deal_id: string;
          code: string;
          data?: Json;
          created_at?: string;
        };
        Update: {
          id?: never;
          deal_id?: string;
          code?: string;
          data?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "timeline_events_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: false;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
        ];
      };
      verify_mn_sessions: {
        Row: {
          id: string;
          provider_session_id: string;
          user_id: string;
          phone: string;
          sms_uri: string;
          display_instruction: string;
          status: string;
          expires_at: string;
          verified_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          provider_session_id: string;
          user_id: string;
          phone: string;
          sms_uri: string;
          display_instruction: string;
          status?: string;
          expires_at: string;
          verified_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          provider_session_id?: string;
          user_id?: string;
          phone?: string;
          sms_uri?: string;
          display_instruction?: string;
          status?: string;
          expires_at?: string;
          verified_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "verify_mn_sessions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      withdrawals: {
        Row: {
          id: string;
          helper_id: string;
          amount: number;
          reference: string;
          bank: string;
          account_number: string;
          holder_name: string;
          status: string;
          auto: boolean;
          requested_at: string;
          decided_at: string | null;
          decided_by: string | null;
          note: string | null;
        };
        Insert: {
          id?: string;
          helper_id: string;
          amount: number;
          reference: string;
          bank: string;
          account_number: string;
          holder_name: string;
          status?: string;
          auto?: boolean;
          requested_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          note?: string | null;
        };
        Update: {
          id?: string;
          helper_id?: string;
          amount?: number;
          reference?: string;
          bank?: string;
          account_number?: string;
          holder_name?: string;
          status?: string;
          auto?: boolean;
          requested_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "withdrawals_decided_by_fkey";
            columns: ["decided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "withdrawals_helper_id_fkey";
            columns: ["helper_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      work_photo_reports: {
        Row: {
          photo_id: string;
          reporter_id: string;
          reason: string;
          created_at: string;
        };
        Insert: {
          photo_id: string;
          reporter_id: string;
          reason: string;
          created_at?: string;
        };
        Update: {
          photo_id?: string;
          reporter_id?: string;
          reason?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_photo_reports_photo_id_fkey";
            columns: ["photo_id"];
            isOneToOne: false;
            referencedRelation: "work_photos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_photo_reports_reporter_id_fkey";
            columns: ["reporter_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      work_photos: {
        Row: {
          id: string;
          deal_id: string;
          helper_id: string;
          source: string;
          uploaded_by: string;
          proof_id: string | null;
          staging_path: string | null;
          file_path: string | null;
          status: string;
          in_portfolio: boolean;
          reports: number;
          decided_at: string | null;
          removed_by: string | null;
          hide_reason: string | null;
          created_at: string;
          show_price: boolean;
        };
        Insert: {
          id?: string;
          deal_id: string;
          helper_id: string;
          source: string;
          uploaded_by: string;
          proof_id?: string | null;
          staging_path?: string | null;
          file_path?: string | null;
          status: string;
          in_portfolio?: boolean;
          reports?: number;
          decided_at?: string | null;
          removed_by?: string | null;
          hide_reason?: string | null;
          created_at?: string;
          show_price?: boolean;
        };
        Update: {
          id?: string;
          deal_id?: string;
          helper_id?: string;
          source?: string;
          uploaded_by?: string;
          proof_id?: string | null;
          staging_path?: string | null;
          file_path?: string | null;
          status?: string;
          in_portfolio?: boolean;
          reports?: number;
          decided_at?: string | null;
          removed_by?: string | null;
          hide_reason?: string | null;
          created_at?: string;
          show_price?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "work_photos_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: false;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_photos_helper_id_fkey";
            columns: ["helper_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_photos_proof_id_fkey";
            columns: ["proof_id"];
            isOneToOne: true;
            referencedRelation: "proofs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_photos_removed_by_fkey";
            columns: ["removed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_photos_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      public_profiles: {
        Row: {
          id: string | null;
          name: string | null;
          role: "customer" | "helper" | "admin" | null;
          helper_status: "pending" | "approved" | "rejected" | null;
          kyc_level: number | null;
          categories:
            | (
                | "shop"
                | "carry"
                | "queue"
                | "deliver"
                | "repair"
                | "other"
                | "plumbing"
                | "electrical"
                | "cleaning"
                | "childcare"
                | "eldercare"
                | "dayjob"
                | "trash"
                | "escort"
                | "assembly"
              )[]
            | null;
          area: string | null;
          rating_count: number | null;
          completed_count: number | null;
          rating: number | null;
        };
        Insert: {
          id?: string | null;
          name?: string | null;
          role?: "customer" | "helper" | "admin" | null;
          helper_status?: "pending" | "approved" | "rejected" | null;
          kyc_level?: number | null;
          categories?:
            | (
                | "shop"
                | "carry"
                | "queue"
                | "deliver"
                | "repair"
                | "other"
                | "plumbing"
                | "electrical"
                | "cleaning"
                | "childcare"
                | "eldercare"
                | "dayjob"
                | "trash"
                | "escort"
                | "assembly"
              )[]
            | null;
          area?: string | null;
          rating_count?: number | null;
          completed_count?: number | null;
          rating?: number | null;
        };
        Update: {
          id?: string | null;
          name?: string | null;
          role?: "customer" | "helper" | "admin" | null;
          helper_status?: "pending" | "approved" | "rejected" | null;
          kyc_level?: number | null;
          categories?:
            | (
                | "shop"
                | "carry"
                | "queue"
                | "deliver"
                | "repair"
                | "other"
                | "plumbing"
                | "electrical"
                | "cleaning"
                | "childcare"
                | "eldercare"
                | "dayjob"
                | "trash"
                | "escort"
                | "assembly"
              )[]
            | null;
          area?: string | null;
          rating_count?: number | null;
          completed_count?: number | null;
          rating?: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      account_balance: {
        Args: {
          p_account: string | null;
          p_deal_id?: string | null;
        };
        Returns: number;
      };
      active_marks: {
        Args: {
          p_helper: string | null;
        };
        Returns: number;
      };
      apply_transition: {
        Args: {
          p_deal_id: string | null;
          p_expected_version: number | null;
          p_deal: Json | null;
          p_new_offers?: Json | null;
          p_removed_offers?: Json | null;
          p_dispute?: Json | null;
          p_events?: Json | null;
          p_ledger?: Json | null;
          p_suspend?: Json | null;
        };
        Returns: number;
      };
      check_handover_code: {
        Args: {
          p_deal: string | null;
          p_helper: string | null;
          p_attempt: string | null;
        };
        Returns: string;
      };
      configure_scheduler: {
        Args: {
          p_url: string | null;
          p_secret: string | null;
        };
        Returns: undefined;
      };
      deal_status_allowed: {
        Args: {
          t: "errand" | "goods" | null;
          s_from:
            | "awaiting_payment"
            | "open"
            | "matched"
            | "in_progress"
            | "held"
            | "check"
            | "disputed"
            | "released"
            | "refunded"
            | "cancelled"
            | "expired"
            | null;
          s_to:
            | "awaiting_payment"
            | "open"
            | "matched"
            | "in_progress"
            | "held"
            | "check"
            | "disputed"
            | "released"
            | "refunded"
            | "cancelled"
            | "expired"
            | null;
        };
        Returns: boolean;
      };
      deals_count_completed: {
        Args: Record<PropertyKey, never>;
        Returns: never;
      };
      deals_guard: {
        Args: Record<PropertyKey, never>;
        Returns: never;
      };
      decide_withdrawal: {
        Args: {
          p_id: string | null;
          p_ops: string | null;
          p_sent: boolean | null;
          p_note?: string | null;
        };
        Returns: Database["public"]["Tables"]["withdrawals"]["Row"];
      };
      dev_latest_sms_code: {
        Args: {
          p_phone: string | null;
        };
        Returns: string;
      };
      dispatch_candidates: {
        Args: {
          p_deal_id: string | null;
          p_max_km: number | null;
          p_now?: string | null;
        };
        Returns: {
          helper_id: string | null;
          distance_km: number | null;
          rating_sum: number | null;
          rating_count: number | null;
          completed_count: number | null;
          offers_30d: number | null;
          won_30d: number | null;
        }[];
      };
      due_auto_payouts: {
        Args: {
          p_days: number | null;
        };
        Returns: {
          helper_id: string | null;
        }[];
      };
      handle_new_user: {
        Args: Record<PropertyKey, never>;
        Returns: never;
      };
      helper_on_time: {
        Args: {
          p_helper: string | null;
        };
        Returns: {
          jobs: number | null;
          on_time: number | null;
        }[];
      };
      insert_deal: {
        Args: {
          p_deal: Json | null;
          p_events: Json | null;
        };
        Returns: string;
      };
      ledger_append_only: {
        Args: Record<PropertyKey, never>;
        Returns: never;
      };
      ledger_invariant_violations: {
        Args: Record<PropertyKey, never>;
        Returns: {
          deal_id: string | null;
          held_amount: number | null;
          ledger_hold: number | null;
        }[];
      };
      mn_iban: {
        Args: {
          p_bank: string | null;
          p_account: string | null;
        };
        Returns: string;
      };
      nearby_open_deals: {
        Args: {
          p_helper_id: string | null;
          p_now?: string | null;
        };
        Returns: {
          deal_id: string | null;
          distance_km: number | null;
        }[];
      };
      payable_balance: {
        Args: {
          p_user: string | null;
        };
        Returns: number;
      };
      payin_check: {
        Args: {
          p_deal_id: string | null;
          p_payer: string | null;
          p_amount: number | null;
        };
        Returns: string;
      };
      public_stats: {
        Args: Record<PropertyKey, never>;
        Returns: {
          done: number | null;
          helpers: number | null;
          reviews: number | null;
          avg_stars: number | null;
        }[];
      };
      purge_job_routes: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      qualified_helper_ids: {
        Args: {
          p_category:
            | "shop"
            | "carry"
            | "queue"
            | "deliver"
            | "repair"
            | "other"
            | "plumbing"
            | "electrical"
            | "cleaning"
            | "childcare"
            | "eldercare"
            | "dayjob"
            | "trash"
            | "escort"
            | "assembly"
            | null;
        };
        Returns: {
          helper_id: string | null;
        }[];
      };
      queue_wire_refunds: {
        Args: {
          p_deal: string | null;
        };
        Returns: undefined;
      };
      rate_customer: {
        Args: {
          p_deal_id: string | null;
          p_helper: string | null;
          p_stars: number | null;
          p_tags?: string[] | null;
          p_note?: string | null;
        };
        Returns: undefined;
      };
      rate_deal: {
        Args: {
          p_deal_id: string | null;
          p_from: string | null;
          p_stars: number | null;
          p_tags?: string[] | null;
          p_note?: string | null;
        };
        Returns: undefined;
      };
      record_app_error: {
        Args: {
          p_fingerprint: string | null;
          p_source: string | null;
          p_route: string | null;
          p_message: string | null;
          p_stack: string | null;
        };
        Returns: boolean;
      };
      record_job_position: {
        Args: {
          p_helper: string | null;
          p_lat: number | null;
          p_lng: number | null;
        };
        Returns: number;
      };
      register_organization: {
        Args: {
          p_org: Json | null;
          p_payout: Json | null;
        };
        Returns: string;
      };
      release_lease: {
        Args: {
          p_name: string | null;
        };
        Returns: undefined;
      };
      request_withdrawal: {
        Args: {
          p_helper: string | null;
          p_auto?: boolean | null;
        };
        Returns: Database["public"]["Tables"]["withdrawals"]["Row"];
      };
      scheduler_status: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      send_sms_hook: {
        Args: {
          event: Json | null;
        };
        Returns: Json;
      };
      set_job_location_sharing: {
        Args: {
          p_deal: string | null;
          p_helper: string | null;
          p_enabled: boolean | null;
        };
        Returns: boolean;
      };
      settle_wire_payment: {
        Args: {
          p_intent: string | null;
          p_amount: number | null;
          p_charge: string | null;
          p_version: number | null;
          p_transition: Json | null;
        };
        Returns: string;
      };
      try_lease: {
        Args: {
          p_name: string | null;
          p_seconds: number | null;
        };
        Returns: boolean;
      };
      usage_status: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      wire_refund_work: {
        Args: {
          p_limit?: number;
        };
        Returns: string[];
      };
    };
    Enums: {
      category:
        | "shop"
        | "carry"
        | "queue"
        | "deliver"
        | "repair"
        | "other"
        | "plumbing"
        | "electrical"
        | "cleaning"
        | "childcare"
        | "eldercare"
        | "dayjob"
        | "trash"
        | "escort"
        | "assembly";
      deal_mode: "now" | "schedule";
      deal_status:
        | "awaiting_payment"
        | "open"
        | "matched"
        | "in_progress"
        | "held"
        | "check"
        | "disputed"
        | "released"
        | "refunded"
        | "cancelled"
        | "expired";
      deal_type: "errand" | "goods";
      dispute_outcome: "release" | "refund";
      helper_status: "pending" | "approved" | "rejected";
      incident_kind: "sos" | "unsafe" | "harassment" | "theft" | "damage" | "scam" | "other";
      incident_status: "open" | "acknowledged" | "resolved";
      ledger_kind:
        | "pay_in"
        | "release_fee"
        | "item_reimburse"
        | "budget_refund"
        | "platform_fee"
        | "release_seller"
        | "cancel_fee"
        | "refund"
        | "withdrawal";
      proof_kind: "receipt" | "handover" | "start" | "progress";
      user_role: "customer" | "helper" | "admin";
    };
    CompositeTypes: Record<never, never>;
  };
};
export type Tables<Name extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][Name]["Row"];
