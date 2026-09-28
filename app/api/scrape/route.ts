import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, handleError } from "@/lib/api/respond";
import type { ScrapeResponse } from "@/lib/api/types";
import { parseInstagramUrl } from "@/lib/instagram/parseUrl";
import { clientIp, createRateLimiter } from "@/lib/rateLimit";
import { scrapePost } from "@/lib/scrape";

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
    return NextResponse.json<ScrapeResponse>(await scrapePost(shortcode, canonicalUrl, body.data.force));
  } catch (err) {
    return handleError(err, "POST /api/scrape");
  }
}
