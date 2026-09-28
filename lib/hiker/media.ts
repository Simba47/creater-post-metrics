import { AppError } from "@/lib/errors";
import { HikerNetworkError, type HikerClient, type HikerResponse } from "./client";

export type MediaSource = "v2_by_url" | "v1_by_url";

export interface MediaResult {
  raw: Record<string, unknown>;
  source: MediaSource;
}

export const V2_BY_URL = "/v2/media/info/by/url";
export const V1_BY_URL = "/v1/media/by/url";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function firstV2Item(body: unknown): Record<string, unknown> | null {
  if (!isObject(body) || !Array.isArray(body.items)) return null;
  const item: unknown = body.items[0];
  return isObject(item) ? item : null;
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
  // 401/402/5xx and anything else unexpected: our key, our balance, or their outage.
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

/**
 * Fetches a media object for a canonical Instagram URL.
 * v2 is primary; v1 is only tried when v2 says 404 (ads and some other posts are v1-only).
 * A v2 400 means the URL itself is bad, so v1 is not tried.
 */
export async function getMediaByUrl(
  client: HikerClient,
  url: string,
  shortcode?: string,
): Promise<MediaResult> {
  const v2 = await call(client, V2_BY_URL, { url, safe_int: "true" }, shortcode);

  if (v2.status === 200) {
    const item = firstV2Item(v2.body);
    if (item) return { raw: item, source: "v2_by_url" };
    // 200 with an empty items[] is treated like a 404 and falls through to v1.
    // TODO(verify with probe): confirm whether HikerAPI ever returns 200 with empty items.
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
