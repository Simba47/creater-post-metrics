"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import type { PostDetailResponse, ScrapeResponse } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format";
import { canonicalUrlFor } from "@/lib/instagram/parseUrl";
import { nullReason } from "@/lib/metrics/nullReason";
import { MetricChart } from "./MetricChart";
import { MetricsCard } from "./MetricsCard";
import { EmptyState, ErrorState, NumberCell, Spinner } from "./ui";

export function PostDetail({ shortcode }: { shortcode: string }) {
  const [data, setData] = useState<PostDetailResponse | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiFetch<PostDetailResponse>(`/api/posts/${encodeURIComponent(shortcode)}`));
    } catch (err) {
      setError(
        err instanceof ApiClientError ? { code: err.code, message: err.message } : { code: "", message: "Unexpected error." },
      );
    } finally {
      setLoading(false);
    }
  }, [shortcode]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await apiFetch<ScrapeResponse>("/api/scrape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: canonicalUrlFor(shortcode), force: true }),
      });
      await load();
    } catch (err) {
      setRefreshError(err instanceof ApiClientError ? err.message : "Unexpected error.");
    } finally {
      setRefreshing(false);
    }
  }

  if (loading && !data) return <Spinner label="Loading post…" />;
  if (error?.code === "POST_NOT_FOUND") {
    return (
      <EmptyState title="This post isn't tracked yet">
        <Link href="/" className="underline underline-offset-4">
          Fetch it
        </Link>{" "}
        to start tracking its metrics.
      </EmptyState>
    );
  }
  if (error) return <ErrorState title="Couldn't load this post" message={error.message} onRetry={() => void load()} />;
  if (!data) return null;

  const { post, snapshots } = data;
  const latest = snapshots[0];
  const chronological = [...snapshots].reverse();
  const viewsSeries = chronological.map((s) => ({ t: Date.parse(s.fetched_at), value: s.play_count }));
  const likesSeries = chronological.map((s) => ({ t: Date.parse(s.fetched_at), value: s.like_count }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/posts" className="text-sm text-zinc-500 underline-offset-4 hover:underline dark:text-zinc-400">
          ← All tracked posts
        </Link>
        <button
          onClick={() => void refresh()}
          disabled={refreshing}
          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {refreshing ? "Refreshing…" : "Fetch new snapshot"}
        </button>
      </div>
      {refreshError && <ErrorState title="Refresh failed" message={refreshError} />}

      {latest ? (
        <MetricsCard post={post} snapshot={latest} showHistoryLink={false} />
      ) : (
        <EmptyState title="No snapshots yet">Use “Fetch new snapshot” to record this post&apos;s metrics.</EmptyState>
      )}

      {snapshots.length > 0 && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <MetricChart title="Views over time" metric="views" data={viewsSeries} slot={0} />
            <MetricChart title="Likes over time" metric="likes" data={likesSeries} slot={1} />
          </div>

          <section>
            <h2 className="mb-2 text-sm font-medium">Snapshot history ({snapshots.length})</h2>
            <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
              <table className="w-full min-w-[840px] text-sm">
                <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Fetched</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Views</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">IG / FB views</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Likes</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Comments</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Shares</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Reposts</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Saves</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                  {snapshots.map((s) => (
                    <tr key={s.id}>
                      <td className="whitespace-nowrap px-3 py-2">{formatDateTime(s.fetched_at)}</td>
                      <td className="px-3 py-2 text-right">
                        <NumberCell value={s.play_count} reason={nullReason("views", s)} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right text-zinc-600 dark:text-zinc-400">
                        <NumberCell value={s.ig_play_count} reason={nullReason("ig_views", s)} /> /{" "}
                        <NumberCell value={s.fb_play_count} reason={nullReason("fb_views", s)} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <NumberCell value={s.like_count} reason={nullReason("likes", s)} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <NumberCell value={s.comment_count} reason={nullReason("comments", s)} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <NumberCell value={s.reshare_count} reason={nullReason("shares", s)} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <NumberCell value={s.repost_count} reason={nullReason("reposts", s)} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <NumberCell value={s.save_count} reason={nullReason("saves", s)} />
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-zinc-500">{s.source_endpoint}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
