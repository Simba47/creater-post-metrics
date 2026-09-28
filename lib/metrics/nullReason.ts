export type MetricKey = "views" | "ig_views" | "fb_views" | "likes" | "comments" | "shares" | "reposts" | "saves";

const NOT_PUBLIC = "Not available publicly";
const HIDDEN = "Hidden by creator";
const NOT_IN_V1 = "Not returned by the fallback endpoint (v1). Force-refresh later to try the full endpoint.";

/** Tooltip text explaining why a metric is null. */
export function nullReason(
  metric: MetricKey,
  flags: { likes_hidden: boolean | null; shares_disabled: boolean | null; source_endpoint?: string | null },
): string {
  const fromV1 = flags.source_endpoint === "v1_by_url";
  switch (metric) {
    case "likes":
      // Hidden likes are normally recovered from the likers list; null means that lookup failed.
      return flags.likes_hidden ? `${HIDDEN}. Couldn't look up the real count this time. Try Force refresh later.` : NOT_PUBLIC;
    case "views":
      // like_and_view_counts_disabled hides views as well as likes.
      return flags.likes_hidden ? HIDDEN : `${NOT_PUBLIC} (photos and carousels don't report views)`;
    case "ig_views":
    case "fb_views":
      return flags.likes_hidden ? HIDDEN : fromV1 ? NOT_IN_V1 : NOT_PUBLIC;
    case "shares":
      return flags.shares_disabled ? HIDDEN : fromV1 ? NOT_IN_V1 : NOT_PUBLIC;
    case "reposts":
    case "saves":
      // v2 omits save_count / media_repost_count intermittently: observed missing on one fetch of a
      // reel and present on a later fetch of the same reel.
      return fromV1 ? NOT_IN_V1 : "Instagram didn't return this in this fetch. Try Force refresh later.";
    case "comments":
      return NOT_PUBLIC;
  }
}
