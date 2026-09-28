import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, handleError } from "@/lib/api/respond";
import type { SheetFetchResponse } from "@/lib/api/types";
import { isAllowedSheetHost, sheetCsvExportUrl } from "@/lib/bulk/googleSheet";
import { AppError } from "@/lib/errors";
import { clientIp, createRateLimiter } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const NOT_PUBLIC =
  "Couldn't read that sheet. In Google Sheets click Share → General access → “Anyone with the link” (Viewer), then try again.";

// In-memory, per-instance: must move to Upstash/Redis before real production traffic.
const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

const bodySchema = z.object({ url: z.string().trim().min(1).max(2048) });

/**
 * Downloads a public Google Sheet as CSV. Redirects are followed manually and only through Google
 * hosts, so this can't be used to fetch arbitrary URLs.
 */
async function downloadSheetCsv(exportUrl: string): Promise<string> {
  let url = exportUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) break;
      const nextUrl = new URL(next, url);
      if (!isAllowedSheetHost(nextUrl.hostname)) throw new AppError("PRIVATE_OR_UNAVAILABLE", NOT_PUBLIC);
      url = nextUrl.toString();
      continue;
    }
    if (res.status === 404) throw new AppError("POST_NOT_FOUND", "That Google Sheet doesn't exist or was deleted.");
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/csv")) {
      // Private sheets answer with an HTML sign-in page rather than CSV.
      throw new AppError("PRIVATE_OR_UNAVAILABLE", NOT_PUBLIC);
    }
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) {
      throw new AppError("INVALID_URL", "That sheet is too large (over 5 MB).");
    }
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new AppError("INVALID_URL", "That sheet is too large (over 5 MB).");
    return text;
  }
  throw new AppError("PRIVATE_OR_UNAVAILABLE", NOT_PUBLIC);
}

/** POST { url: <Google Sheets link> } → { csv } */
export async function POST(req: NextRequest) {
  const rl = limiter.check(clientIp(req.headers));
  if (!rl.allowed) {
    return errorResponse("RATE_LIMITED", `Too many requests. Try again in ${rl.retryAfterSec}s.`, {
      headers: { "retry-after": String(rl.retryAfterSec) },
    });
  }

  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return errorResponse("INVALID_URL", "Send { url: <Google Sheets link> }.");

  const link = sheetCsvExportUrl(body.data.url);
  if (!link.ok) return errorResponse("INVALID_URL", link.message);

  try {
    return NextResponse.json<SheetFetchResponse>({ csv: await downloadSheetCsv(link.exportUrl) });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return errorResponse("UPSTREAM_ERROR", "Google Sheets took too long to respond. Try again.");
    }
    return handleError(err, "POST /api/bulk/sheet");
  }
}
