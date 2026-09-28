import { describe, expect, it } from "vitest";
import { formatCompact, formatNumber, postTypeLabel, timeAgo } from "@/lib/format";
import { engagementRate } from "@/lib/metrics/engagement";

describe("number formatting", () => {
  it("formats compact values for tiles", () => {
    expect(formatCompact(999)).toBe("999");
    expect(formatCompact(1234)).toBe("1.2K");
    expect(formatCompact(3_412_000)).toBe("3.4M");
    expect(formatCompact(0)).toBe("0");
  });

  it("formats full values for tables", () => {
    expect(formatNumber(1234)).toBe("1,234");
    expect(formatNumber(4821345)).toBe("4,821,345");
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  it("reports minutes, hours, days", () => {
    expect(timeAgo("2026-01-01T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-01-01T11:48:00Z", now)).toBe("12 min ago");
    expect(timeAgo("2026-01-01T09:00:00Z", now)).toBe("3 hr ago");
    expect(timeAgo("2025-12-31T12:00:00Z", now)).toBe("1 day ago");
  });
});

describe("postTypeLabel", () => {
  it("labels by product/media type", () => {
    expect(postTypeLabel(2, "clips")).toBe("Reel");
    expect(postTypeLabel(1, "feed")).toBe("Photo");
    expect(postTypeLabel(8, "carousel_container")).toBe("Carousel");
    expect(postTypeLabel(2, "feed")).toBe("Video");
    expect(postTypeLabel(null, null)).toBe("Post");
  });
});

describe("engagementRate", () => {
  it("is null without views", () => {
    expect(engagementRate({ play_count: null, like_count: 10, comment_count: 1, reshare_count: 1 })).toBeNull();
    expect(engagementRate({ play_count: 0, like_count: 10, comment_count: 1, reshare_count: 1 })).toBeNull();
  });

  it("sums all components when present", () => {
    const r = engagementRate({ play_count: 1000, like_count: 80, comment_count: 15, reshare_count: 5 });
    expect(r).toEqual({ rate: 0.1, included: ["likes", "comments", "shares"], excluded: [] });
  });

  it("skips null components and reports them", () => {
    const r = engagementRate({ play_count: 1000, like_count: null, comment_count: 20, reshare_count: null });
    expect(r).toEqual({ rate: 0.02, included: ["comments"], excluded: ["likes", "shares"] });
  });

  it("counts a real zero as included", () => {
    const r = engagementRate({ play_count: 100, like_count: 0, comment_count: null, reshare_count: null });
    expect(r).toEqual({ rate: 0, included: ["likes"], excluded: ["comments", "shares"] });
  });

  it("is null when every component is unknown", () => {
    expect(engagementRate({ play_count: 100, like_count: null, comment_count: null, reshare_count: null })).toBeNull();
  });
});
