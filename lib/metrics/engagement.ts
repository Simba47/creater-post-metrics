export type EngagementComponent = "likes" | "comments" | "shares";

export interface EngagementRate {
  rate: number;
  included: EngagementComponent[];
  excluded: EngagementComponent[];
}

/**
 * (likes + comments + shares) / views, skipping null components.
 * Returns null when views are unknown or zero, or when no component is known.
 */
export function engagementRate(m: {
  play_count: number | null;
  like_count: number | null;
  comment_count: number | null;
  reshare_count: number | null;
}): EngagementRate | null {
  if (m.play_count === null || m.play_count <= 0) return null;

  const parts: Array<[EngagementComponent, number | null]> = [
    ["likes", m.like_count],
    ["comments", m.comment_count],
    ["shares", m.reshare_count],
  ];
  const included = parts.filter(([, v]) => v !== null).map(([k]) => k);
  const excluded = parts.filter(([, v]) => v === null).map(([k]) => k);
  if (included.length === 0) return null;

  const sum = parts.reduce((acc, [, v]) => acc + (v ?? 0), 0);
  return { rate: sum / m.play_count, included, excluded };
}
