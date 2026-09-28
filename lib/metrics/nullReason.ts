export type MetricKey = "views" | "ig_views" | "fb_views" | "likes" | "comments" | "shares" | "saves";

const NOT_PUBLIC = "Not available publicly";
const HIDDEN = "Hidden by creator";

/** Tooltip text explaining why a metric is null. */
export function nullReason(
  metric: MetricKey,
  flags: { likes_hidden: boolean | null; shares_disabled: boolean | null },
): string {
  switch (metric) {
    case "saves":
      return `${NOT_PUBLIC} — Instagram only shows saves to the post's owner`;
    case "likes":
      return flags.likes_hidden ? HIDDEN : NOT_PUBLIC;
    case "views":
    case "ig_views":
    case "fb_views":
      // like_and_view_counts_disabled hides views as well as likes.
      return flags.likes_hidden ? HIDDEN : `${NOT_PUBLIC} (photos and carousels don't report views)`;
    case "shares":
      return flags.shares_disabled ? HIDDEN : NOT_PUBLIC;
    case "comments":
      return NOT_PUBLIC;
  }
}
