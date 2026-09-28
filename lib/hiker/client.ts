export const HIKER_BASE_URL = "https://api.hikerapi.com";

const TIMEOUT_MS = 20_000;
const DEFAULT_BACKOFF_MS = 1_000;
const MAX_RETRY_AFTER_MS = 10_000;

export interface HikerCallLog {
  endpoint: string;
  shortcode: string | null;
  httpStatus: number | null;
  durationMs: number;
  error: string | null;
}

export interface HikerResponse {
  status: number;
  body: unknown;
}

export interface HikerClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  logCall?: (entry: HikerCallLog) => Promise<void> | void;
  sleep?: (ms: number) => Promise<void>;
  baseUrl?: string;
}

export interface HikerRequest {
  path: string;
  params: Record<string, string>;
  /** Stored on the call log only, to correlate calls with posts. */
  shortcode?: string;
}

export interface HikerClient {
  get(req: HikerRequest): Promise<HikerResponse>;
}

/** Thrown when no HTTP response was received at all (timeout / network failure). */
export class HikerNetworkError extends Error {
  constructor(
    message: string,
    public readonly timedOut: boolean,
  ) {
    super(message);
    this.name = "HikerNetworkError";
  }
}

/**
 * Parses JSON while keeping integers beyond Number.MAX_SAFE_INTEGER as exact strings.
 * v2 calls pass safe_int=true, but v1 has no such option and media pks exceed 2^53.
 * Relies on the reviver `context.source` argument (Node 21+); on older runtimes it
 * degrades to plain JSON.parse.
 */
export function parseJsonSafeInts(text: string): unknown {
  return JSON.parse(text, function (_key, value: unknown, context?: { source?: string }) {
    if (
      typeof value === "number" &&
      !Number.isSafeInteger(value) &&
      context?.source !== undefined &&
      /^-?\d+$/.test(context.source)
    ) {
      return context.source;
    }
    return value;
  } as (this: unknown, key: string, value: unknown) => unknown);
}

function retryDelayMs(res: Response): number {
  const header = res.headers.get("retry-after");
  if (!header) return DEFAULT_BACKOFF_MS;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  if (!Number.isFinite(ms) || ms < 0) return DEFAULT_BACKOFF_MS;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export function createHikerClient(opts: HikerClientOptions): HikerClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const baseUrl = opts.baseUrl ?? HIKER_BASE_URL;

  async function log(entry: HikerCallLog): Promise<void> {
    if (!opts.logCall) return;
    try {
      await opts.logCall(entry);
    } catch (err) {
      // Logging must never break a scrape.
      console.error("[hiker] failed to log call", err);
    }
  }

  async function attempt(req: HikerRequest): Promise<{ res: Response; body: unknown }> {
    const url = new URL(req.path, baseUrl);
    for (const [k, v] of Object.entries(req.params)) url.searchParams.set(k, v);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const started = Date.now();
    let res: Response;
    let body: unknown = null;
    try {
      res = await fetchImpl(url, {
        method: "GET",
        headers: { "x-access-key": opts.apiKey, accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      });
      const text = await res.text();
      if (text) {
        try {
          body = parseJsonSafeInts(text);
        } catch {
          body = text;
        }
      }
    } catch (err) {
      const timedOut = controller.signal.aborted;
      const message = timedOut
        ? `HikerAPI request timed out after ${TIMEOUT_MS}ms`
        : `HikerAPI request failed: ${err instanceof Error ? err.message : String(err)}`;
      await log({
        endpoint: req.path,
        shortcode: req.shortcode ?? null,
        httpStatus: null,
        durationMs: Date.now() - started,
        error: message,
      });
      throw new HikerNetworkError(message, timedOut);
    } finally {
      clearTimeout(timer);
    }

    await log({
      endpoint: req.path,
      shortcode: req.shortcode ?? null,
      httpStatus: res.status,
      durationMs: Date.now() - started,
      error: res.ok ? null : summarizeError(body),
    });
    return { res, body };
  }

  return {
    async get(req) {
      const first = await attempt(req);
      if (!isRetryable(first.res.status)) {
        return { status: first.res.status, body: first.body };
      }
      await sleep(retryDelayMs(first.res));
      const second = await attempt(req);
      return { status: second.res.status, body: second.body };
    },
  };
}

function summarizeError(body: unknown): string | null {
  if (body == null) return null;
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return text.slice(0, 500);
}
