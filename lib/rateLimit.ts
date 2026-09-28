/**
 * Fixed-window, in-memory rate limiter keyed by client IP.
 *
 * NOTE: This must move to Upstash/Redis (or similar) before real production traffic. On Vercel each
 * serverless instance has its own memory, so limits are per-instance and reset on cold starts.
 */
export interface RateLimiter {
  /** `cost` lets one request consume several units (e.g. a batch of URLs). */
  check(key: string, now?: number, cost?: number): { allowed: boolean; retryAfterSec: number };
}

export function createRateLimiter(opts: { limit: number; windowMs: number }): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();

  return {
    check(key, now = Date.now(), cost = 1) {
      // Opportunistic cleanup so the map can't grow without bound.
      if (windows.size > 10_000) {
        for (const [k, w] of windows) if (now - w.start >= opts.windowMs) windows.delete(k);
      }

      const w = windows.get(key);
      if (!w || now - w.start >= opts.windowMs) {
        if (cost > opts.limit) return { allowed: false, retryAfterSec: 0 };
        windows.set(key, { start: now, count: cost });
        return { allowed: true, retryAfterSec: 0 };
      }
      if (w.count + cost > opts.limit) {
        return { allowed: false, retryAfterSec: Math.ceil((w.start + opts.windowMs - now) / 1000) };
      }
      w.count += cost;
      return { allowed: true, retryAfterSec: 0 };
    },
  };
}

export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}
