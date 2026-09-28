import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, handleError } from "@/lib/api/respond";
import type { ScrapeResponse } from "@/lib/api/types";
import { getLatestSnapshot, getPostByShortcode, insertSnapshot, markFetched, upsertPost } from "@/lib/db/posts";
import { getEnv } from "@/lib/env";
import { getMediaByUrl } from "@/lib/hiker/media";
import { getHikerClient } from "@/lib/hiker/server";
import { parseInstagramUrl } from "@/lib/instagram/parseUrl";
import { mapMedia } from "@/lib/metrics/mapper";
import { clientIp, createRateLimiter } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// In-memory, per-instance: must move to Upstash/Redis before real production traffic.
const limiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

const bodySchema = z.object({
  url: z.string().trim().min(1, "Paste an Instagram post or reel URL.").max(2048),
  force: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  const rl = limiter.check(clientIp(req.headers));
  if (!rl.allowed) {
    return errorResponse("RATE_LIMITED", `Too many requests. Try again in ${rl.retryAfterSec}s.`, {
      headers: { "retry-after": String(rl.retryAfterSec) },
    });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return errorResponse("INVALID_URL", "Request body must be JSON: { url, force? }.");
  }
  const body = bodySchema.safeParse(json);
  if (!body.success) {
    return errorResponse("INVALID_URL", body.error.issues[0]?.message ?? "Invalid request body.");
  }

  const parsed = parseInstagramUrl(body.data.url);
  if (!parsed.ok) return errorResponse("INVALID_URL", parsed.message);
  const { shortcode, canonicalUrl } = parsed;

  try {
    if (!body.data.force) {
      const existing = await getPostByShortcode(shortcode);
      const latest = existing ? await getLatestSnapshot(existing.id) : null;
      if (existing && latest) {
        const ageMs = Date.now() - new Date(latest.fetched_at).getTime();
        if (ageMs < getEnv().CACHE_TTL_MINUTES * 60_000) {
          return NextResponse.json<ScrapeResponse>({ post: existing, snapshot: latest, cached: true });
        }
      }
    }

    const { raw, source } = await getMediaByUrl(getHikerClient(), canonicalUrl, shortcode);
    const metrics = mapMedia(raw, source);

    // Keyed by the shortcode from the user's URL so cache lookups stay consistent.
    const upserted = await upsertPost(shortcode, metrics);
    const snapshot = await insertSnapshot(upserted.id, source, metrics, raw);
    const post = await markFetched(upserted.id, snapshot.fetched_at);

    return NextResponse.json<ScrapeResponse>({ post, snapshot, cached: false });
  } catch (err) {
    return handleError(err, "POST /api/scrape");
  }
}
