// Browser-side fetch helper for our own API routes.
import type { ApiErrorBody } from "./types";

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiClientError("NETWORK", "Network error — check your connection and try again.", 0);
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as Partial<ApiErrorBody> | null)?.error;
    throw new ApiClientError(err?.code ?? "UPSTREAM_ERROR", err?.message ?? `Request failed (HTTP ${res.status}).`, res.status);
  }
  return body as T;
}
