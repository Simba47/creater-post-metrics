// Response shapes shared by the API routes and the UI.
import type { PostRow, PostWithLatest, Snapshot } from "@/lib/db/types";

export type { ApiErrorBody, ApiErrorCode } from "@/lib/errors";
export type { PostRow, PostWithLatest, Snapshot };

export interface ScrapeResponse {
  post: PostRow;
  snapshot: Snapshot;
  cached: boolean;
}

export interface PostDetailResponse {
  post: PostRow;
  /** Newest first. */
  snapshots: Snapshot[];
}

export interface PostListResponse {
  items: PostWithLatest[];
  total: number;
  limit: number;
  offset: number;
}
