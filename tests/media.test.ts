import { describe, expect, it, vi } from "vitest";
import { createHikerClient, parseJsonSafeInts, type HikerCallLog } from "@/lib/hiker/client";
import { getMediaByUrl, V1_BY_URL, V2_BY_URL } from "@/lib/hiker/media";
import { AppError } from "@/lib/errors";

const URL_IN = "https://www.instagram.com/p/C8xYz12AbCd/";

type Route = { status: number; body?: unknown; headers?: Record<string, string> };

/** Builds a fetch mock that returns queued responses per endpoint path. */
function mockFetch(routes: Record<string, Route[]>) {
  const calls: URL[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    calls.push(url);
    const queue = routes[url.pathname];
    const next = queue?.shift();
    if (!next) throw new Error(`unexpected call to ${url.pathname}`);
    const text = next.body === undefined ? "" : JSON.stringify(next.body);
    return new Response(text, { status: next.status, headers: next.headers });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function makeClient(routes: Record<string, Route[]>) {
  const { fetchImpl, calls } = mockFetch(routes);
  const logs: HikerCallLog[] = [];
  const sleep = vi.fn(async () => {});
  const client = createHikerClient({
    apiKey: "test-key",
    fetchImpl,
    sleep,
    logCall: (e) => {
      logs.push(e);
    },
  });
  return { client, calls, logs, sleep, fetchImpl };
}

const v2Item = { pk: "3312345678901234567", code: "C8xYz12AbCd", like_count: 10 };
const v1Item = { pk: "3312345678901234567", code: "C8xYz12AbCd", like_count: 12, product_type: "ad" };

describe("getMediaByUrl", () => {
  it("returns items[0] from v2 on 200", async () => {
    const { client, calls } = makeClient({
      [V2_BY_URL]: [{ status: 200, body: { items: [v2Item], status: "ok" } }],
    });
    const result = await getMediaByUrl(client, URL_IN);
    expect(result).toEqual({ raw: v2Item, source: "v2_by_url" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.searchParams.get("url")).toBe(URL_IN);
    expect(calls[0]!.searchParams.get("safe_int")).toBe("true");
  });

  it("sends the access key header", async () => {
    const { client, fetchImpl } = makeClient({
      [V2_BY_URL]: [{ status: 200, body: { items: [v2Item], status: "ok" } }],
    });
    await getMediaByUrl(client, URL_IN);
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)["x-access-key"]).toBe("test-key");
  });

  it("falls back to v1 when v2 returns 404", async () => {
    const { client, calls } = makeClient({
      [V2_BY_URL]: [{ status: 404, body: { detail: "Not found" } }],
      [V1_BY_URL]: [{ status: 200, body: v1Item }],
    });
    const result = await getMediaByUrl(client, URL_IN);
    expect(result).toEqual({ raw: v1Item, source: "v1_by_url" });
    expect(calls.map((c) => c.pathname)).toEqual([V2_BY_URL, V1_BY_URL]);
    expect(calls[1]!.searchParams.has("safe_int")).toBe(false);
  });

  it("falls back to v1 when v2 returns 200 with empty items", async () => {
    const { client } = makeClient({
      [V2_BY_URL]: [{ status: 200, body: { items: [], status: "ok" } }],
      [V1_BY_URL]: [{ status: 200, body: v1Item }],
    });
    const result = await getMediaByUrl(client, URL_IN);
    expect(result.source).toBe("v1_by_url");
  });

  it("does NOT fall back to v1 when v2 returns 400", async () => {
    const { client, calls } = makeClient({
      [V2_BY_URL]: [{ status: 400, body: { detail: "bad url" } }],
    });
    await expect(getMediaByUrl(client, URL_IN)).rejects.toMatchObject({ code: "INVALID_URL" });
    expect(calls).toHaveLength(1);
  });

  it("returns POST_NOT_FOUND when both v2 and v1 return 404", async () => {
    const { client } = makeClient({
      [V2_BY_URL]: [{ status: 404 }],
      [V1_BY_URL]: [{ status: 404 }],
    });
    const err = await getMediaByUrl(client, URL_IN).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("POST_NOT_FOUND");
  });

  it("retries once on 429 respecting Retry-After, then succeeds", async () => {
    const { client, calls, sleep } = makeClient({
      [V2_BY_URL]: [
        { status: 429, headers: { "retry-after": "2" } },
        { status: 200, body: { items: [v2Item], status: "ok" } },
      ],
    });
    const result = await getMediaByUrl(client, URL_IN);
    expect(result.source).toBe("v2_by_url");
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("returns RATE_LIMITED when 429 persists after the retry", async () => {
    const { client, calls } = makeClient({
      [V2_BY_URL]: [{ status: 429 }, { status: 429 }],
    });
    await expect(getMediaByUrl(client, URL_IN)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(calls).toHaveLength(2);
  });

  it("retries once on 5xx and returns UPSTREAM_ERROR if it persists", async () => {
    const { client, calls, sleep } = makeClient({
      [V2_BY_URL]: [{ status: 503 }, { status: 502 }],
    });
    await expect(getMediaByUrl(client, URL_IN)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("does not retry 4xx other than 429", async () => {
    const { client, calls } = makeClient({
      [V2_BY_URL]: [{ status: 401 }],
    });
    await expect(getMediaByUrl(client, URL_IN)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    expect(calls).toHaveLength(1);
  });

  it("logs every HTTP attempt", async () => {
    const { client, logs } = makeClient({
      [V2_BY_URL]: [{ status: 500 }, { status: 404 }],
      [V1_BY_URL]: [{ status: 200, body: v1Item }],
    });
    await getMediaByUrl(client, URL_IN, "C8xYz12AbCd");
    expect(logs.map((l) => [l.endpoint, l.httpStatus])).toEqual([
      [V2_BY_URL, 500],
      [V2_BY_URL, 404],
      [V1_BY_URL, 200],
    ]);
    expect(logs.every((l) => l.shortcode === "C8xYz12AbCd")).toBe(true);
    expect(logs[2]!.error).toBeNull();
  });

  it("maps network failures to UPSTREAM_ERROR and logs them", async () => {
    const logs: HikerCallLog[] = [];
    const client = createHikerClient({
      apiKey: "k",
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
      logCall: (e) => {
        logs.push(e);
      },
    });
    await expect(getMediaByUrl(client, URL_IN)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.httpStatus).toBeNull();
    expect(logs[0]!.error).toMatch(/fetch failed/);
  });

  it("does not fail the request when logging throws", async () => {
    const { fetchImpl } = mockFetch({
      [V2_BY_URL]: [{ status: 200, body: { items: [v2Item], status: "ok" } }],
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = createHikerClient({
      apiKey: "k",
      fetchImpl,
      logCall: async () => {
        throw new Error("db down");
      },
    });
    await expect(getMediaByUrl(client, URL_IN)).resolves.toMatchObject({ source: "v2_by_url" });
    errSpy.mockRestore();
  });
});

describe("parseJsonSafeInts", () => {
  it("keeps unsafe integers as exact strings and leaves safe numbers alone", () => {
    const parsed = parseJsonSafeInts('{"pk":3312345678901234567,"like_count":42,"ratio":1.5}') as Record<
      string,
      unknown
    >;
    expect(parsed.pk).toBe("3312345678901234567");
    expect(parsed.like_count).toBe(42);
    expect(parsed.ratio).toBe(1.5);
  });
});
