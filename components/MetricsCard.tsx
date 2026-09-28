import Link from "next/link";
import type { ReactNode } from "react";
import type { PostRow, Snapshot } from "@/lib/api/types";
import { formatDate, formatPercent, timeAgo } from "@/lib/format";
import { engagementRate } from "@/lib/metrics/engagement";
import { nullReason, type MetricKey } from "@/lib/metrics/nullReason";
import { canonicalUrlFor } from "@/lib/instagram/parseUrl";
import { CompactNumber, InfoTip, NullDash, TypeBadge } from "./ui";

function Tile({
  label,
  value,
  metric,
  snapshot,
  sub,
}: {
  label: string;
  value: number | null;
  metric: MetricKey;
  snapshot: Snapshot;
  sub?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold">
        {value === null ? <NullDash reason={nullReason(metric, snapshot)} /> : <CompactNumber value={value} />}
      </p>
      {sub && <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{sub}</div>}
    </div>
  );
}

function ViewsSplit({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.play_count === null) return null;
  const part = (label: string, v: number | null, metric: MetricKey) => (
    <span>
      {label} {v === null ? <NullDash reason={nullReason(metric, snapshot)} /> : <CompactNumber value={v} />}
    </span>
  );
  return (
    <span className="flex gap-2">
      {part("IG", snapshot.ig_play_count, "ig_views")}
      <span aria-hidden>·</span>
      {part("FB", snapshot.fb_play_count, "fb_views")}
    </span>
  );
}

function Freshness({ fetchedAt, cached }: { fetchedAt: string; cached?: boolean }) {
  const ago = timeAgo(fetchedAt);
  if (cached === true) {
    return (
      <InfoTip text="Served from cache to save API calls. Tick “Force refresh” to fetch live numbers.">
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
          Cached · fetched {ago}
        </span>
      </InfoTip>
    );
  }
  return (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200">
      {cached === false ? "Live · fetched " : "Fetched "}
      {ago}
    </span>
  );
}

const COMPONENT_LABEL = { likes: "likes", comments: "comments", shares: "shares" } as const;

export function MetricsCard({
  post,
  snapshot,
  cached,
  showHistoryLink = true,
}: {
  post: PostRow;
  snapshot: Snapshot;
  /** true/false after a scrape; undefined when showing stored data. */
  cached?: boolean;
  showHistoryLink?: boolean;
}) {
  const er = engagementRate(snapshot);

  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6 dark:border-zinc-800 dark:bg-zinc-950">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold">
              {post.owner_username ? `@${post.owner_username}` : "Unknown account"}
            </h2>
            <TypeBadge mediaType={post.media_type} productType={post.product_type} />
          </div>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {post.taken_at ? `Posted ${formatDate(post.taken_at)}` : "Post date unknown"} ·{" "}
            <a
              href={canonicalUrlFor(post.shortcode)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              View on Instagram ↗
            </a>
          </p>
        </div>
        <Freshness fetchedAt={snapshot.fetched_at} cached={cached} />
      </header>

      {post.caption && (
        <p className="mt-3 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300" title={post.caption}>
          {post.caption}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile
          label="Views"
          value={snapshot.play_count}
          metric="views"
          snapshot={snapshot}
          sub={<ViewsSplit snapshot={snapshot} />}
        />
        <Tile label="Likes" value={snapshot.like_count} metric="likes" snapshot={snapshot} />
        <Tile label="Comments" value={snapshot.comment_count} metric="comments" snapshot={snapshot} />
        <Tile label="Shares" value={snapshot.reshare_count} metric="shares" snapshot={snapshot} />
        <Tile label="Reposts" value={snapshot.repost_count} metric="reposts" snapshot={snapshot} />
        <Tile label="Saves" value={snapshot.save_count} metric="saves" snapshot={snapshot} />
      </div>

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <div>
          {er ? (
            <p>
              <span className="text-zinc-500 dark:text-zinc-400">Engagement rate </span>
              <span className="font-semibold tabular-nums">{formatPercent(er.rate)}</span>
              <span className="text-zinc-500 dark:text-zinc-400">
                {" "}
                · ({er.included.map((c) => COMPONENT_LABEL[c]).join(" + ")}) / views
                {er.excluded.length > 0 && ` · excludes ${er.excluded.join(", ")} (not available)`}
              </span>
            </p>
          ) : (
            <p className="text-zinc-500 dark:text-zinc-400">
              Engagement rate needs a view count, which isn&apos;t available for this post.
            </p>
          )}
        </div>
        {showHistoryLink && (
          <Link href={`/posts/${post.shortcode}`} className="font-medium underline underline-offset-4">
            View history →
          </Link>
        )}
      </footer>
    </article>
  );
}
