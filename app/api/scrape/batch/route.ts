import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api/respond";
import { BATCH_MAX } from "@/lib/bulk/constants";
import type { BatchItemResult, BatchScrapeResponse } from "@/lib/api/types";
import { AppError } from "@/lib/errors";
import { parseInstagramUrl } from "@/lib/instagram/parseUrl";
import { clientIp, createRateLimiter } from "@/lib/rateLimit";
import { scrapePost } from "@/lib/scrape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Up to BATCH_MAX HikerAPI fetches run in parallel; each can take several seconds (20s timeout + retry).
export const maxDuration = 60;

// Counts URLs, not requests. In-memory, per-instance: must move to Upstash/Redis before real
// production traffic.
const limiter = createRateLimiter({ limit: 120, windowMs: 60_000 });

const bodySchema = z.object({
  urls: z.array(z.string().trim().min(1).max(2048)).min(1).max(BATCH_MAX),
  force: z.boolean().optional().default(false),
});

async function scrapeOne(url: string, force: boolean): Promise<BatchItemResult> {
  const parsed = parseInstagramUrl(url);
  if (!parsed.ok) return { url, ok: false, error: { code: "INVALID_URL", message: parsed.message } };
  try {
    return { url, ok: true, data: await scrapePost(parsed.shortcode, parsed.canonicalUrl, force) };
  } catch (err) {
    if (err instanceof AppError) return { url, ok: false, error: { code: err.code, message: err.message } };
    console.error("[POST /api/scrape/batch] unexpected error", url, err);
    return { url, ok: false, error: { code: "UPSTREAM_ERROR", message: "Something went wrong on our side." } };
  }
}

/** POST { urls: string[] (1–5), force? } → per-URL results. One bad URL doesn't fail the batch. */
export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return errorResponse("INVALID_URL", "Request body must be JSON: { urls, force? }.");
  }
  const body = bodySchema.safeParse(json);
  if (!body.success) {
    return errorResponse("INVALID_URL", `Send between 1 and ${BATCH_MAX} URLs as { urls: string[] }.`);
  }

  const rl = limiter.check(clientIp(req.headers), Date.now(), body.data.urls.length);
  if (!rl.allowed) {
    return errorResponse("RATE_LIMITED", `Too many URLs this minute. Try again in ${rl.retryAfterSec}s.`, {
      headers: { "retry-after": String(rl.retryAfterSec) },
    });
  }

  const results = await Promise.all(body.data.urls.map((u) => scrapeOne(u, body.data.force)));
  return NextResponse.json<BatchScrapeResponse>({ results });
}
