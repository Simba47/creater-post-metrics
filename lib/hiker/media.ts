import { AppError } from "@/lib/errors";
import { HikerNetworkError, type HikerClient, type HikerResponse } from "./client";

export type MediaSource = "v2_by_url" | "v1_by_url";

export interface MediaResult {
  raw: Record<string, unknown>;
  source: MediaSource;
}

export const V2_BY_URL = "/v2/media/info/by/url";
export const V1_BY_URL = "/v1/media/by/url";
export const V2_LIKERS = "/v2/media/likers";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Extracts the media object from a v2 by/url body.
 * Observed shape (verified with probe): { media_or_ad: { ...media }, status: "ok" }.
 * The documented { items: [media] } shape is still accepted in case other v2 variants use it.
 */
export function extractV2Media(body: unknown): Record<string, unknown> | null {
  if (!isObject(body)) return null;
  if (isObject(body.media_or_ad)) return body.media_or_ad;
  if (Array.isArray(body.items)) {
    const item: unknown = body.items[0];
    return isObject(item) ? item : null;
  }
  return null;
}

/** Maps a non-success status (after the client's retry) to a typed error. */
function errorForStatus(res: HikerResponse, endpoint: string): AppError {
  const { status } = res;
  if (status === 400) {
    return new AppError(
      "INVALID_URL",
      "Instagram couldn't resolve that link. Make sure it's a post or reel URL, not a story, audio, or share link.",
    );
  }
  if (status === 404) {
    return new AppError(
      "POST_NOT_FOUND",
      "Post not found. It may have been deleted, or it's private or restricted.",
    );
  }
  if (status === 403) {
    // TODO(verify with probe): confirm what HikerAPI returns for private accounts / age-restricted posts.
    return new AppError("PRIVATE_OR_UNAVAILABLE", "This post is private or otherwise unavailable.");
  }
  if (status === 429) {
    return new AppError("RATE_LIMITED", "The metrics provider is rate limiting us. Try again in a minute.");
  }
  if (status === 402) {
    // Observed: { state: false, error: "Top up your account…", exc_type: "InsufficientFunds" }
    return new AppError("UPSTREAM_ERROR", "The metrics provider account is out of credits. Top up the HikerAPI balance.");
  }
  if (status === 401) {
    // Observed: { state: false, error: "Unauthorized request: pass access_key or login via …" }
    return new AppError("UPSTREAM_ERROR", "The metrics provider rejected our API key. Check HIKER_API_KEY.");
  }
  // 5xx and anything else unexpected: their outage.
  return new AppError("UPSTREAM_ERROR", `The metrics provider returned an error (HTTP ${status} from ${endpoint}).`);
}

async function call(client: HikerClient, path: string, params: Record<string, string>, shortcode?: string) {
  try {
    return await client.get({ path, params, shortcode });
  } catch (err) {
    if (err instanceof HikerNetworkError) {
      throw new AppError(
        "UPSTREAM_ERROR",
        err.timedOut ? "The metrics provider timed out. Try again." : "Couldn't reach the metrics provider.",
      );
    }
    throw err;
  }
}

/** Extra v2 fetches when save_count / media_repost_count are missing. */
export const COMPLETENESS_RETRIES = 2;

/** How many of the intermittently-omitted fields (saves, reposts) a v2 media object has. */
export function completeness(media: Record<string, unknown>): number {
  return Number("save_count" in media) + Number("media_repost_count" in media);
}

/**
 * Fetches a media object for a canonical Instagram URL.
 * v2 is primary; v1 is only tried when v2 says 404 (ads and some other posts are v1-only).
 * A v2 400 means the URL itself is bad, so v1 is not tried.
 *
 * v2 omits save_count / media_repost_count on a large share of responses at random (observed
 * ~40%; the same post returns them on a later call). When either is missing, v2 is called again up
 * to `completenessRetries` times and the most complete response is kept.
 */
export async function getMediaByUrl(
  client: HikerClient,
  url: string,
  shortcode?: string,
  opts: { completenessRetries?: number } = {},
): Promise<MediaResult> {
  const params = { url, safe_int: "true" };
  const v2 = await call(client, V2_BY_URL, params, shortcode);

  if (v2.status === 200) {
    let item = extractV2Media(v2.body);
    if (item) {
      const retries = opts.completenessRetries ?? COMPLETENESS_RETRIES;
      for (let i = 0; i < retries && completeness(item) < 2; i++) {
        // A failed retry isn't fatal: we already have a usable response.
        const again = await call(client, V2_BY_URL, params, shortcode).catch(() => null);
        const next = again?.status === 200 ? extractV2Media(again.body) : null;
        if (next && completeness(next) >= completeness(item)) item = next;
      }
      return { raw: item, source: "v2_by_url" };
    }
    // A 200 without a media object is treated like a 404 and falls through to v1.
    console.warn("[hiker] v2 returned 200 without a media object; falling back to v1");
  } else if (v2.status !== 404) {
    throw errorForStatus(v2, V2_BY_URL);
  }

  const v1 = await call(client, V1_BY_URL, { url }, shortcode);
  if (v1.status === 200) {
    if (isObject(v1.body)) return { raw: v1.body, source: "v1_by_url" };
    throw new AppError("UPSTREAM_ERROR", "The metrics provider returned an unexpected response.");
  }
  throw errorForStatus(v1, V1_BY_URL);
}

/**
 * The real like count of a post whose creator hid likes, or null if it can't be had.
 * The media payload only carries a placeholder (2 or 3) then, but the likers endpoint's user_count
 * is the true total (verified: it equals like_count exactly on posts with visible likes).
 * Never throws: a missing count isn't worth failing the whole fetch over.
 */
export async function getLikerCount(client: HikerClient, mediaPk: string, shortcode?: string): Promise<number | null> {
  const res = await call(client, V2_LIKERS, { id: mediaPk, safe_int: "true" }, shortcode).catch(() => null);
  if (res?.status !== 200 || !isObject(res.body)) return null;
  const n = res.body.user_count;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
}
