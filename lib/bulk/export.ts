import type { ScrapeResponse } from "@/lib/api/types";
import { postTypeLabel } from "@/lib/format";
import { canonicalUrlFor } from "@/lib/instagram/parseUrl";
import { engagementRate } from "@/lib/metrics/engagement";

/** One line of a bulk job, as tracked by the UI. */
export type BulkRow =
  | { url: string; shortcode: string; status: "pending" }
  | { url: string; shortcode: string; status: "done"; data: ScrapeResponse }
  | { url: string; shortcode: string; status: "error"; code: string; message: string };

type Kind = "text" | "url" | "int" | "percent" | "date" | "datetime";

export interface Column {
  key: keyof ExportRow;
  header: string;
  kind: Kind;
  /** Excel column width, in characters. */
  width: number;
}

/** Export values. `null` = unknown (written as an empty cell, never 0). */
export interface ExportRow {
  input_url: string;
  post_url: string;
  username: string | null;
  type: string | null;
  posted: Date | null;
  views: number | null;
  ig_views: number | null;
  fb_views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  reposts: number | null;
  saves: number | null;
  engagement_rate: number | null;
  fetched_at: Date | null;
  status: string;
  error: string | null;
  caption: string | null;
}

export const COLUMNS: Column[] = [
  { key: "input_url", header: "Input URL", kind: "url", width: 44 },
  { key: "post_url", header: "Post URL", kind: "url", width: 42 },
  { key: "username", header: "Username", kind: "text", width: 22 },
  { key: "type", header: "Type", kind: "text", width: 10 },
  { key: "posted", header: "Posted (UTC)", kind: "date", width: 13 },
  { key: "views", header: "Views", kind: "int", width: 13 },
  { key: "ig_views", header: "IG views", kind: "int", width: 13 },
  { key: "fb_views", header: "FB views", kind: "int", width: 13 },
  { key: "likes", header: "Likes", kind: "int", width: 12 },
  { key: "comments", header: "Comments", kind: "int", width: 11 },
  { key: "shares", header: "Shares", kind: "int", width: 11 },
  { key: "reposts", header: "Reposts", kind: "int", width: 10 },
  { key: "saves", header: "Saves", kind: "int", width: 10 },
  { key: "engagement_rate", header: "Engagement rate", kind: "percent", width: 16 },
  { key: "fetched_at", header: "Fetched at (UTC)", kind: "datetime", width: 18 },
  { key: "status", header: "Status", kind: "text", width: 10 },
  { key: "error", header: "Error", kind: "text", width: 40 },
  { key: "caption", header: "Caption", kind: "text", width: 60 },
];

export function toExportRows(rows: BulkRow[]): ExportRow[] {
  return rows.map((r) => {
    const base: ExportRow = {
      input_url: r.url,
      post_url: canonicalUrlFor(r.shortcode),
      username: null,
      type: null,
      posted: null,
      views: null,
      ig_views: null,
      fb_views: null,
      likes: null,
      comments: null,
      shares: null,
      reposts: null,
      saves: null,
      engagement_rate: null,
      fetched_at: null,
      status: r.status === "done" ? (r.data.cached ? "cached" : "fetched") : r.status,
      error: r.status === "error" ? r.message : null,
      caption: null,
    };
    if (r.status !== "done") return base;
    const { post, snapshot: s } = r.data;
    return {
      ...base,
      username: post.owner_username,
      type: postTypeLabel(post.media_type, post.product_type),
      posted: post.taken_at ? new Date(post.taken_at) : null,
      views: s.play_count,
      ig_views: s.ig_play_count,
      fb_views: s.fb_play_count,
      likes: s.like_count,
      comments: s.comment_count,
      shares: s.reshare_count,
      reposts: s.repost_count,
      saves: s.save_count,
      engagement_rate: engagementRate(s)?.rate ?? null,
      fetched_at: new Date(s.fetched_at),
      caption: post.caption,
    };
  });
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const isoDateTime = (d: Date) => `${isoDate(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

/** A cell as plain text. Unknown values are empty strings. */
export function cellText(row: ExportRow, col: Column): string {
  const v = row[col.key];
  if (v === null) return "";
  switch (col.kind) {
    case "date":
      return isoDate(v as Date);
    case "datetime":
      return isoDateTime(v as Date);
    case "percent":
      return `${((v as number) * 100).toFixed(2)}%`;
    default:
      return String(v);
  }
}

function csvEscape(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV with a UTF-8 BOM so Excel shows emoji / non-Latin captions correctly. */
export function toCsv(rows: ExportRow[], columns: Column[] = COLUMNS): string {
  const lines = [columns.map((c) => csvEscape(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvEscape(cellText(row, c))).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Tab-separated text for pasting straight into Google Sheets. Tabs/newlines inside values become spaces. */
export function toTsv(rows: ExportRow[], columns: Column[] = COLUMNS): string {
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ");
  const lines = [columns.map((c) => c.header).join("\t")];
  for (const row of rows) lines.push(columns.map((c) => clean(cellText(row, c))).join("\t"));
  return lines.join("\n");
}

export function exportFilename(ext: string, now = new Date()): string {
  return `instagram-metrics-${isoDate(now)}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}.${ext}`;
}
