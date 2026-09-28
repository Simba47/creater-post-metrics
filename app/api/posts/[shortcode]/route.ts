import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, handleError } from "@/lib/api/respond";
import type { PostDetailResponse } from "@/lib/api/types";
import { getPostWithSnapshots } from "@/lib/db/posts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHORTCODE_RE = /^[A-Za-z0-9_-]{5,64}$/;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ shortcode: string }> }) {
  const { shortcode } = await ctx.params;
  if (!SHORTCODE_RE.test(shortcode)) {
    return errorResponse("INVALID_URL", "That doesn't look like a valid post shortcode.");
  }

  try {
    const result = await getPostWithSnapshots(shortcode);
    if (!result) {
      return errorResponse("POST_NOT_FOUND", "This post isn't tracked yet. Fetch it from the home page first.");
    }
    return NextResponse.json<PostDetailResponse>(result);
  } catch (err) {
    return handleError(err, "GET /api/posts/[shortcode]");
  }
}
