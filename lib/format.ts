const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const fullFmt = new Intl.NumberFormat("en-US");

/** 1.2K / 3.4M — for metric tiles. */
export function formatCompact(n: number): string {
  return compactFmt.format(n);
}

/** 1,234 — for tables. */
export function formatNumber(n: number): string {
  return fullFmt.format(n);
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(ratio < 0.001 ? 3 : 2)}%`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function timeAgo(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function postTypeLabel(mediaType: number | null, productType: string | null): string {
  if (productType === "clips") return "Reel";
  if (mediaType === 8 || productType === "carousel_container") return "Carousel";
  if (productType === "igtv") return "IGTV";
  if (mediaType === 2) return "Video";
  if (mediaType === 1) return "Photo";
  return "Post";
}
