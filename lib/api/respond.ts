import "server-only";
import { NextResponse } from "next/server";
import { AppError, HTTP_STATUS_FOR_CODE, type ApiErrorBody, type ApiErrorCode } from "@/lib/errors";

export function errorResponse(
  code: ApiErrorCode,
  message: string,
  init?: { status?: number; headers?: HeadersInit },
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: { code, message } },
    { status: init?.status ?? HTTP_STATUS_FOR_CODE[code], headers: init?.headers },
  );
}

/** Converts any thrown value into a typed JSON error. Unknown errors are logged, not leaked. */
export function handleError(err: unknown, route: string): NextResponse<ApiErrorBody> {
  if (err instanceof AppError) return errorResponse(err.code, err.message);
  console.error(`[${route}] unexpected error`, err);
  return errorResponse("UPSTREAM_ERROR", "Something went wrong on our side. Please try again.", { status: 500 });
}
