import type { MediaSource } from "@/lib/hiker/media";

/**
 * Normalized post + metric fields.
 * Invariant: a missing/unknown value is `null`, never `0`. `0` is a real zero.
 */
export interface NormalizedMetrics {
  shortcode: string | null;
  media_pk: string | null;
  owner_username: string | null;
  owner_pk: string | null;
  media_type: number | null;
  product_type: string | null;
  caption: string | null;
  /** ISO 8601 */
  taken_at: string | null;
  like_count: number | null;
  comment_count: number | null;
  play_count: number | null;
  ig_play_count: number | null;
  fb_play_count: number | null;
  reshare_count: number | null;
  /** From media_repost_count (v2). */
  repost_count: number | null;
  /** Only when the payload includes save_count (v2 does, v1 doesn't). Never derived or estimated. */
  save_count: number | null;
  likes_hidden: boolean;
  shares_disabled: boolean;
}

type Raw = Record<string, unknown>;

function obj(v: unknown): Raw | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Raw) : undefined;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** IDs may arrive as strings (safe_int / safe JSON parse) or numbers. Never lossy-convert. */
function id(v: unknown): string | null {
  if (typeof v === "string" && /^\d+$/.test(v)) return v;
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return String(v);
  return null;
}

function count(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.trunc(v);
  if (typeof v === "string" && /^\d+$/.test(v)) {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

function int(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

/** Accepts unix seconds (number or numeric string) or an ISO date string. */
function timestamp(v: unknown): string | null {
  let ms: number | null = null;
  if (typeof v === "number" && Number.isFinite(v)) ms = v * 1000;
  else if (typeof v === "string" && /^\d+$/.test(v)) ms = Number(v) * 1000;
  else if (typeof v === "string") {
    const parsed = Date.parse(v);
    ms = Number.isNaN(parsed) ? null : parsed;
  }
  if (ms === null || ms <= 0) return null;
  return new Date(ms).toISOString();
}

/** First argument that is not null/undefined — so a real 0 in `a` wins over `b`. */
function coalesce(...values: unknown[]): unknown {
  return values.find((v) => v !== undefined && v !== null);
}

export function mapV2Media(raw: Raw): NormalizedMetrics {
  const user = obj(raw.user);
  const caption = obj(raw.caption);
  return {
    shortcode: str(raw.code),
    media_pk: id(raw.pk),
    owner_username: str(user?.username),
    owner_pk: id(user?.pk),
    media_type: int(raw.media_type),
    product_type: str(raw.product_type),
    caption: str(caption?.text),
    taken_at: timestamp(raw.taken_at),
    like_count: count(raw.like_count),
    comment_count: count(raw.comment_count),
    play_count: count(coalesce(raw.play_count, raw.view_count)),
    ig_play_count: count(raw.ig_play_count),
    fb_play_count: count(raw.fb_play_count),
    reshare_count: count(raw.reshare_count),
    repost_count: count(raw.media_repost_count),
    save_count: count(raw.save_count),
    likes_hidden: raw.like_and_view_counts_disabled === true,
    shares_disabled: raw.share_count_disabled === true,
  };
}

/**
 * v1 returns the media object directly and may use flatter field names than v2.
 * Every field falls back to the v2 name so either shape maps correctly.
 */
export function mapV1Media(raw: Raw): NormalizedMetrics {
  const user = obj(raw.user);
  const caption = obj(raw.caption);
  return {
    shortcode: str(raw.code),
    media_pk: id(raw.pk),
    owner_username: str(user?.username),
    owner_pk: id(user?.pk),
    media_type: int(raw.media_type),
    product_type: str(raw.product_type),
    // Verified: v1 uses caption_text and an ISO taken_at (plus taken_at_ts); v2 names are fallbacks.
    caption: str(coalesce(raw.caption_text, caption?.text)),
    taken_at: timestamp(coalesce(raw.taken_at_ts, raw.taken_at)),
    like_count: count(raw.like_count),
    comment_count: count(raw.comment_count),
    // Verified: v1 sends view_count: 0 next to a real play_count, so a 0 view_count means "unknown".
    play_count: count(coalesce(raw.play_count, raw.view_count === 0 ? null : raw.view_count)),
    ig_play_count: count(raw.ig_play_count),
    fb_play_count: count(raw.fb_play_count),
    // Verified: v1 omits reshare_count, media_repost_count and save_count; these stay null.
    reshare_count: count(raw.reshare_count),
    repost_count: count(raw.media_repost_count),
    save_count: count(raw.save_count),
    likes_hidden: raw.like_and_view_counts_disabled === true,
    shares_disabled: raw.share_count_disabled === true,
  };
}

export function mapMedia(raw: Raw, source: MediaSource): NormalizedMetrics {
  return source === "v2_by_url" ? mapV2Media(raw) : mapV1Media(raw);
}
