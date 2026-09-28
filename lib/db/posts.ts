import "server-only";
import type { MediaSource } from "@/lib/hiker/media";
import type { NormalizedMetrics } from "@/lib/metrics/mapper";
import { getSupabase } from "./supabase";
import type { PostRow, PostWithLatest, Snapshot, SnapshotRow } from "./types";

const SNAPSHOT_COLUMNS =
  "id, post_id, fetched_at, source_endpoint, like_count, comment_count, play_count, ig_play_count, fb_play_count, reshare_count, repost_count, save_count, likes_hidden, shares_disabled" as const;

const MAX_SNAPSHOTS = 500;

function dbError(op: string, err: { message: string }): Error {
  return new Error(`[db] ${op} failed: ${err.message}`);
}

export async function getPostByShortcode(shortcode: string): Promise<PostRow | null> {
  const { data, error } = await getSupabase().from("posts").select("*").eq("shortcode", shortcode).maybeSingle();
  if (error) throw dbError("getPostByShortcode", error);
  return data;
}

/**
 * Inserts or updates post metadata by shortcode. Null fields are left out of the payload so a
 * sparser response (e.g. a v1 fallback without a caption) doesn't wipe values we already have.
 */
export async function upsertPost(shortcode: string, m: NormalizedMetrics): Promise<PostRow> {
  const fields = {
    media_pk: m.media_pk,
    owner_username: m.owner_username,
    owner_pk: m.owner_pk,
    media_type: m.media_type,
    product_type: m.product_type,
    caption: m.caption,
    taken_at: m.taken_at,
  };
  const payload = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null));

  const { data, error } = await getSupabase()
    .from("posts")
    .upsert({ shortcode, ...payload }, { onConflict: "shortcode" })
    .select("*")
    .single();
  if (error) throw dbError("upsertPost", error);
  return data;
}

export async function insertSnapshot(
  postId: string,
  source: MediaSource,
  m: NormalizedMetrics,
  raw: Record<string, unknown>,
): Promise<Snapshot> {
  const row: Omit<SnapshotRow, "id" | "fetched_at"> = {
    post_id: postId,
    source_endpoint: source,
    like_count: m.like_count,
    comment_count: m.comment_count,
    play_count: m.play_count,
    ig_play_count: m.ig_play_count,
    fb_play_count: m.fb_play_count,
    reshare_count: m.reshare_count,
    repost_count: m.repost_count,
    save_count: m.save_count,
    likes_hidden: m.likes_hidden,
    shares_disabled: m.shares_disabled,
    raw_json: raw as SnapshotRow["raw_json"],
  };
  const { data, error } = await getSupabase()
    .from("post_metric_snapshots")
    .insert(row)
    .select(SNAPSHOT_COLUMNS)
    .single();
  if (error) throw dbError("insertSnapshot", error);
  return data;
}

export async function markFetched(postId: string, fetchedAt: string): Promise<PostRow> {
  const { data, error } = await getSupabase()
    .from("posts")
    .update({ last_fetched_at: fetchedAt })
    .eq("id", postId)
    .select("*")
    .single();
  if (error) throw dbError("markFetched", error);
  return data;
}

export async function getLatestSnapshot(postId: string): Promise<Snapshot | null> {
  const { data, error } = await getSupabase()
    .from("post_metric_snapshots")
    .select(SNAPSHOT_COLUMNS)
    .eq("post_id", postId)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw dbError("getLatestSnapshot", error);
  return data;
}

/** Post plus its snapshots, newest first (capped at MAX_SNAPSHOTS). */
export async function getPostWithSnapshots(
  shortcode: string,
): Promise<{ post: PostRow; snapshots: Snapshot[] } | null> {
  const post = await getPostByShortcode(shortcode);
  if (!post) return null;
  const { data, error } = await getSupabase()
    .from("post_metric_snapshots")
    .select(SNAPSHOT_COLUMNS)
    .eq("post_id", post.id)
    .order("fetched_at", { ascending: false })
    .limit(MAX_SNAPSHOTS);
  if (error) throw dbError("getPostWithSnapshots", error);
  return { post, snapshots: data };
}

export type PostSort = "recent" | "views" | "likes";

const SORT_COLUMN: Record<PostSort, "last_fetched_at" | "play_count" | "like_count"> = {
  recent: "last_fetched_at",
  views: "play_count",
  likes: "like_count",
};

export async function listPosts(opts: {
  limit: number;
  offset: number;
  sort: PostSort;
  direction: "asc" | "desc";
}): Promise<{ items: PostWithLatest[]; total: number }> {
  const { data, error, count } = await getSupabase()
    .from("post_latest_metrics")
    .select("*", { count: "exact" })
    .order(SORT_COLUMN[opts.sort], { ascending: opts.direction === "asc", nullsFirst: false })
    .order("first_seen_at", { ascending: false })
    .range(opts.offset, opts.offset + opts.limit - 1);
  if (error) throw dbError("listPosts", error);
  return { items: data, total: count ?? 0 };
}
