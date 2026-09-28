import "server-only";
import type { ScrapeResponse } from "@/lib/api/types";
import { getLatestSnapshot, getPostByShortcode, insertSnapshot, markFetched, upsertPost } from "@/lib/db/posts";
import { getEnv } from "@/lib/env";
import { getLikerCount, getMediaByUrl } from "@/lib/hiker/media";
import { getHikerClient } from "@/lib/hiker/server";
import { mapMedia } from "@/lib/metrics/mapper";

/**
 * Returns a cached snapshot if one is younger than CACHE_TTL_MINUTES (unless `force`), otherwise
 * fetches from HikerAPI and stores a new snapshot. Throws AppError for expected failures.
 */
export async function scrapePost(shortcode: string, canonicalUrl: string, force: boolean): Promise<ScrapeResponse> {
  if (!force) {
    const existing = await getPostByShortcode(shortcode);
    const latest = existing ? await getLatestSnapshot(existing.id) : null;
    if (existing && latest) {
      const ageMs = Date.now() - new Date(latest.fetched_at).getTime();
      // v2 omits saves/reposts at random, so an incomplete v2 snapshot is worth fetching again.
      // Hidden likes: null means the likers lookup failed; 3 or less is the placeholder that
      // snapshots stored before the lookup existed. Both are worth another try.
      const incomplete =
        (latest.source_endpoint === "v2_by_url" && (latest.save_count === null || latest.repost_count === null)) ||
        (latest.likes_hidden === true && (latest.like_count === null || latest.like_count <= 3));
      if (ageMs < getEnv().CACHE_TTL_MINUTES * 60_000 && !incomplete) {
        return { post: existing, snapshot: latest, cached: true };
      }
    }
  }

  const { raw, source } = await getMediaByUrl(getHikerClient(), canonicalUrl, shortcode);
  const metrics = mapMedia(raw, source);
  if (metrics.likes_hidden && metrics.media_pk) {
    metrics.like_count = await getLikerCount(getHikerClient(), metrics.media_pk, shortcode);
  }

  // Keyed by the shortcode from the user's URL so cache lookups stay consistent.
  const upserted = await upsertPost(shortcode, metrics);
  const snapshot = await insertSnapshot(upserted.id, source, metrics, raw);
  const post = await markFetched(upserted.id, snapshot.fetched_at);

  return { post, snapshot, cached: false };
}
