"use client";

import { useState, type FormEvent } from "react";
import { MetricsCard } from "@/components/MetricsCard";
import { EmptyState, ErrorState, Spinner } from "@/components/ui";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import type { ScrapeResponse } from "@/lib/api/types";

const ERROR_TITLES: Record<string, string> = {
  INVALID_URL: "That link won't work",
  POST_NOT_FOUND: "Post not found",
  PRIVATE_OR_UNAVAILABLE: "Post unavailable",
  RATE_LIMITED: "Slow down a little",
  UPSTREAM_ERROR: "Couldn't fetch metrics",
  NETWORK: "Network error",
};

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; code: string; message: string }
  | { status: "success"; data: ScrapeResponse };

export default function HomePage() {
  const [url, setUrl] = useState("");
  const [force, setForce] = useState(false);
  const [state, setState] = useState<State>({ status: "idle" });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setState({ status: "loading" });
    try {
      const data = await apiFetch<ScrapeResponse>("/api/scrape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, force }),
      });
      setState({ status: "success", data });
    } catch (err) {
      const e = err instanceof ApiClientError ? err : new ApiClientError("UPSTREAM_ERROR", "Unexpected error.", 0);
      setState({ status: "error", code: e.code, message: e.message });
    }
  }

  const loading = state.status === "loading";

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Instagram post metrics</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Paste a public post or reel URL to fetch its likes, comments, views, and shares. Each fetch is saved, so
          you can watch a post grow over time.
        </p>
      </section>

      <form onSubmit={onSubmit} className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="url" className="sr-only">
            Instagram URL
          </label>
          <input
            id="url"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://www.instagram.com/reel/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {loading ? "Fetching…" : "Fetch metrics"}
          </button>
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} className="h-4 w-4" />
          Force refresh (skip the cache and call the API)
        </label>
      </form>

      {state.status === "idle" && (
        <EmptyState title="No post yet">
          Supports <code>/p/</code>, <code>/reel/</code>, <code>/reels/</code>, and <code>/tv/</code> links. Stories,
          profiles, audio pages, and <code>/share/</code> links aren&apos;t supported.
        </EmptyState>
      )}
      {state.status === "loading" && <Spinner label="Fetching metrics…" />}
      {state.status === "error" && (
        <ErrorState title={ERROR_TITLES[state.code] ?? "Something went wrong"} message={state.message} />
      )}
      {state.status === "success" && (
        <MetricsCard post={state.data.post} snapshot={state.data.snapshot} cached={state.data.cached} />
      )}
    </div>
  );
}
