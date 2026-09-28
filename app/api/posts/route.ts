import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, handleError } from "@/lib/api/respond";
import type { PostListResponse } from "@/lib/api/types";
import { listPosts } from "@/lib/db/posts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  sort: z.enum(["recent", "views", "likes"]).default("recent"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});

export async function GET(req: NextRequest) {
  const query = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!query.success) {
    const issue = query.error.issues[0];
    // The error-code set is fixed by the API contract; INVALID_URL covers malformed request input.
    return errorResponse("INVALID_URL", `Invalid query parameter "${issue?.path.join(".")}": ${issue?.message}`);
  }

  try {
    const { items, total } = await listPosts(query.data);
    return NextResponse.json<PostListResponse>({ items, total, limit: query.data.limit, offset: query.data.offset });
  } catch (err) {
    return handleError(err, "GET /api/posts");
  }
}
