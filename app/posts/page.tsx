"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, ErrorState, NumberCell, Spinner, TypeBadge } from "@/components/ui";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import type { PostListResponse } from "@/lib/api/types";
import { formatDate, timeAgo } from "@/lib/format";
import { nullReason } from "@/lib/metrics/nullReason";

const PAGE_SIZE = 25;

type Sort = "recent" | "views" | "likes";
type Direction = "asc" | "desc";

function SortHeader({
  label,
  column,
  sort,
  direction,
  onSort,
}: {
  label: string;
  column: Sort;
  sort: Sort;
  direction: Direction;
  onSort: (column: Sort) => void;
}) {
  const active = sort === column;
  return (
    <th scope="col" className="px-3 py-2 text-right" aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}>
      <button
        onClick={() => onSort(column)}
        className={`inline-flex items-center gap-1 font-medium hover:text-zinc-900 dark:hover:text-zinc-100 ${active ? "text-zinc-900 dark:text-zinc-100" : ""}`}
      >
        {label}
        <span aria-hidden className="w-3">
          {active ? (direction === "desc" ? "↓" : "↑") : ""}
        </span>
      </button>
    </th>
  );
}

export default function PostsPage() {
  const [sort, setSort] = useState<Sort>("recent");
  const [direction, setDirection] = useState<Direction>("desc");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<PostListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ sort, direction, offset: String(offset), limit: String(PAGE_SIZE) });
      setData(await apiFetch<PostListResponse>(`/api/posts?${qs}`));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unexpected error.");
    } finally {
      setLoading(false);
    }
  }, [sort, direction, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  function onSort(column: Sort) {
    if (column === sort) {
      setDirection((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSort(column);
      setDirection("desc");
    }
    setOffset(0);
  }

  const headerProps = { sort, direction, onSort };
  const total = data?.total ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tracked posts</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Latest snapshot for every post you&apos;ve fetched.</p>
        </div>
        {data && total > 0 && <p className="text-sm text-zinc-500 dark:text-zinc-400">{total} posts</p>}
      </div>

      {error && <ErrorState title="Couldn't load posts" message={error} onRetry={() => void load()} />}
      {!error && loading && !data && <Spinner label="Loading posts…" />}
      {!error && data && data.items.length === 0 && (
        <EmptyState title="No posts tracked yet">
          <Link href="/" className="underline underline-offset-4">
            Fetch a post
          </Link>{" "}
          to start tracking it.
        </EmptyState>
      )}

      {!error && data && data.items.length > 0 && (
        <div className={`overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 ${loading ? "opacity-60" : ""}`}>
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">Post</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Posted</th>
                <SortHeader label="Views" column="views" {...headerProps} />
                <SortHeader label="Likes" column="likes" {...headerProps} />
                <th scope="col" className="px-3 py-2 text-right font-medium">Comments</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Shares</th>
                <SortHeader label="Last fetched" column="recent" {...headerProps} />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {data.items.map((p) => (
                <tr key={p.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
                  <td className="px-3 py-2">
                    <Link href={`/posts/${p.shortcode}`} className="font-medium underline-offset-4 hover:underline">
                      {p.owner_username ? `@${p.owner_username}` : p.shortcode}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                      <TypeBadge mediaType={p.media_type} productType={p.product_type} />
                      <span className="font-mono">{p.shortcode}</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-400">
                    {p.taken_at ? formatDate(p.taken_at) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <NumberCell value={p.play_count} reason={nullReason("views", p)} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <NumberCell value={p.like_count} reason={nullReason("likes", p)} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <NumberCell value={p.comment_count} reason={nullReason("comments", p)} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <NumberCell value={p.reshare_count} reason={nullReason("shares", p)} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-zinc-600 dark:text-zinc-400">
                    {p.last_fetched_at ? timeAgo(p.last_fetched_at) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm">
          <button
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            disabled={offset === 0 || loading}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700"
          >
            ← Previous
          </button>
          <span className="text-zinc-500">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <button
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total || loading}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 disabled:opacity-40 dark:border-zinc-700"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
