// Hand-written to match supabase/migrations/001_init.sql. Keep in sync when the schema changes.
import type { MediaSource } from "@/lib/hiker/media";

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type PostRow = {
  id: string;
  shortcode: string;
  media_pk: string | null;
  owner_username: string | null;
  owner_pk: string | null;
  media_type: number | null;
  product_type: string | null;
  caption: string | null;
  taken_at: string | null;
  first_seen_at: string;
  last_fetched_at: string | null;
};

export type SnapshotMetrics = {
  like_count: number | null;
  comment_count: number | null;
  play_count: number | null;
  ig_play_count: number | null;
  fb_play_count: number | null;
  reshare_count: number | null;
  save_count: number | null;
  likes_hidden: boolean | null;
  shares_disabled: boolean | null;
};

export type SnapshotRow = SnapshotMetrics & {
  id: string;
  post_id: string;
  fetched_at: string;
  source_endpoint: MediaSource;
  raw_json: Json;
};

/** Snapshot as returned by the API (raw_json omitted — it can be large). */
export type Snapshot = Omit<SnapshotRow, "raw_json">;

/** Row of the post_latest_metrics view. Snapshot columns are null when a post has no snapshot. */
export type PostWithLatest = PostRow &
  SnapshotMetrics & {
    snapshot_id: string | null;
    fetched_at: string | null;
    source_endpoint: MediaSource | null;
  };

export type HikerApiCallRow = {
  id: string;
  called_at: string;
  endpoint: string;
  shortcode: string | null;
  http_status: number | null;
  duration_ms: number | null;
  error: string | null;
};

type Insert<Row, Required extends keyof Row> = Pick<Row, Required> & Partial<Omit<Row, Required>>;

export interface Database {
  public: {
    Tables: {
      posts: {
        Row: PostRow;
        Insert: Insert<PostRow, "shortcode">;
        Update: Partial<PostRow>;
        Relationships: [];
      };
      post_metric_snapshots: {
        Row: SnapshotRow;
        Insert: Insert<SnapshotRow, "post_id" | "source_endpoint" | "raw_json">;
        Update: Partial<SnapshotRow>;
        Relationships: [
          {
            foreignKeyName: "post_metric_snapshots_post_id_fkey";
            columns: ["post_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id"];
          },
        ];
      };
      hiker_api_calls: {
        Row: HikerApiCallRow;
        Insert: Insert<HikerApiCallRow, "endpoint">;
        Update: Partial<HikerApiCallRow>;
        Relationships: [];
      };
    };
    Views: {
      post_latest_metrics: {
        Row: PostWithLatest;
        Relationships: [];
      };
    };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}
