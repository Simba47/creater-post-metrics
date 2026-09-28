export type ApiErrorCode =
  | "INVALID_URL"
  | "POST_NOT_FOUND"
  | "PRIVATE_OR_UNAVAILABLE"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR";

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string };
}

export class AppError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const HTTP_STATUS_FOR_CODE: Record<ApiErrorCode, number> = {
  INVALID_URL: 400,
  POST_NOT_FOUND: 404,
  PRIVATE_OR_UNAVAILABLE: 404,
  RATE_LIMITED: 429,
  UPSTREAM_ERROR: 502,
};
