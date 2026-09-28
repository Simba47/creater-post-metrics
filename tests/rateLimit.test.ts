import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter } from "@/lib/rateLimit";

describe("createRateLimiter", () => {
  it("allows up to the limit per window, then blocks with a retry hint", () => {
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000 });
    const t0 = 1_000_000;
    expect(rl.check("a", t0).allowed).toBe(true);
    expect(rl.check("a", t0 + 1).allowed).toBe(true);
    expect(rl.check("a", t0 + 2).allowed).toBe(true);
    expect(rl.check("a", t0 + 30_000)).toEqual({ allowed: false, retryAfterSec: 30 });
    expect(rl.check("b", t0 + 30_000).allowed).toBe(true);
    expect(rl.check("a", t0 + 60_000).allowed).toBe(true);
  });
});

describe("clientIp", () => {
  it("uses the first x-forwarded-for entry", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
