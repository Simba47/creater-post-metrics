// Campaign-report model: the user's own sheet (NAME, FOLLOWERS, IG LINK, AVG. REACH, POSTED LINK, …)
// with the metric columns filled in and a totals row. Pure functions; no DOM or Excel here.
import type { ScrapeResponse } from "@/lib/api/types";
import { parseInstagramUrl } from "@/lib/instagram/parseUrl";

export type Cell = string | number | Date | null;
export type Grid = Cell[][];

export type MetricKey =
  | "posted_date"
  | "views"
  | "likes"
  | "comments"
  | "reposts"
  | "shares"
  | "saves"
  | "total_eng"
  | "eng_rate";

export interface MetricDef {
  key: MetricKey;
  /** Header used when the column has to be added. */
  header: string;
  /** Normalized header spellings that map to this metric (lowercase, letters/digits only). */
  aliases: string[];
  kind: "date" | "int" | "percent";
}

/** Filled columns, in the order they're added when missing. */
export const REPORT_METRICS: MetricDef[] = [
  { key: "posted_date", header: "POSTED DATE", aliases: ["posteddate", "postdate", "dateposted", "date"], kind: "date" },
  { key: "views", header: "VIEWS", aliases: ["views", "view", "plays", "playcount"], kind: "int" },
  { key: "likes", header: "LIKES", aliases: ["likes", "like"], kind: "int" },
  { key: "comments", header: "COMMENTS", aliases: ["comments", "comment"], kind: "int" },
  { key: "reposts", header: "REPOST", aliases: ["repost", "reposts"], kind: "int" },
  { key: "shares", header: "SHARE", aliases: ["share", "shares"], kind: "int" },
  { key: "saves", header: "SAVES", aliases: ["saves", "save"], kind: "int" },
  { key: "total_eng", header: "T. ENG", aliases: ["teng", "totaleng", "totalengagement", "totalengagements"], kind: "int" },
  { key: "eng_rate", header: "ENG. %", aliases: ["eng", "engrate", "engagementrate", "er", "engagement"], kind: "percent" },
];

const LINK_ALIASES = ["postedlink", "postlink", "reellink", "posturl", "postedurl", "contentlink", "link", "url"];

export function normalizeHeader(v: Cell): string {
  return typeof v === "string" ? v.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
}

export function cellString(v: Cell): string {
  if (v === null) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** Numbers, or numeric strings like "1,017,190" / "4.35%". "483K" is not a number. */
export function toNumber(v: Cell): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/,/g, "");
  if (/^-?\d+(\.\d+)?%$/.test(t)) return Number(t.slice(0, -1)) / 100;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

export interface ReportLayout {
  /** Row index of the header row. When the input had none, a header row is inserted at 0. */
  headerRow: number;
  insertedHeader: boolean;
  linkCol: number;
  /** Final column index for every metric (existing column or appended). */
  metricCols: Record<MetricKey, number>;
  /** Metric columns that didn't exist and are appended. */
  addedMetrics: MetricKey[];
  /** Header text of the link column, for display. */
  linkHeader: string;
  dataRows: Array<{ row: number; url: string; shortcode: string; canonicalUrl: string }>;
  /** Existing totals row, or null to append one after the last data row. */
  totalsRow: number | null;
  invalid: Array<{ row: number; url: string; message: string }>;
  /** Unique posts to fetch, in first-seen order. */
  posts: Array<{ url: string; shortcode: string }>;
  /** Rows that repeat a post already listed above. */
  duplicates: number;
}

export type AnalyzeResult = { ok: true; grid: Grid; layout: ReportLayout } | { ok: false; message: string };

function width(grid: Grid): number {
  return grid.reduce((w, r) => Math.max(w, r.length), 0);
}

function looksLikeIgLink(v: Cell): boolean {
  return typeof v === "string" && /instagram\.com\//i.test(v);
}

/**
 * Finds the header row, the post-link column and the metric columns in a sheet.
 * The link column is the one with the most valid post/reel URLs, so an "IG LINK" column of
 * profile URLs is never mistaken for it. Returns a (possibly header-inserted) copy of the grid.
 */
export function analyzeSheet(input: Grid): AnalyzeResult {
  let grid: Grid = input.map((r) => [...r]);
  const w = width(grid);
  const allAliases = new Set([...LINK_ALIASES, ...REPORT_METRICS.flatMap((m) => m.aliases)]);

  // Header row: first of the top 30 rows that names at least two known columns.
  let headerRow = -1;
  for (let r = 0; r < Math.min(grid.length, 30); r++) {
    const hits = grid[r]!.filter((c) => allAliases.has(normalizeHeader(c))).length;
    if (hits >= 2 || (hits === 1 && grid[r]!.some((c) => LINK_ALIASES.includes(normalizeHeader(c))))) {
      headerRow = r;
      break;
    }
  }

  // Link column: most cells that parse as a post/reel URL.
  let linkCol = -1;
  let best = 0;
  for (let c = 0; c < w; c++) {
    let n = 0;
    for (let r = headerRow + 1; r < grid.length; r++) {
      const v = grid[r]![c] ?? null;
      if (typeof v === "string" && parseInstagramUrl(v).ok) n++;
    }
    if (n > best) {
      best = n;
      linkCol = c;
    }
  }
  if (linkCol === -1) {
    return { ok: false, message: "No Instagram post or reel links found. Put them in a column such as “POSTED LINK”." };
  }

  let insertedHeader = false;
  if (headerRow === -1) {
    const header: Cell[] = Array.from({ length: w }, () => null);
    header[linkCol] = "POSTED LINK";
    grid = [header, ...grid];
    headerRow = 0;
    insertedHeader = true;
  }
  const header = grid[headerRow]!;

  // Metric columns: match existing headers, append the rest after the last column.
  const used = new Set<number>([linkCol]);
  const metricCols = {} as Record<MetricKey, number>;
  const addedMetrics: MetricKey[] = [];
  let next = w;
  for (const m of REPORT_METRICS) {
    const idx = header.findIndex((c, i) => !used.has(i) && m.aliases.includes(normalizeHeader(c)));
    if (idx >= 0) {
      metricCols[m.key] = idx;
      used.add(idx);
    } else {
      metricCols[m.key] = next++;
      addedMetrics.push(m.key);
    }
  }

  const dataRows: ReportLayout["dataRows"] = [];
  const invalid: ReportLayout["invalid"] = [];
  const posts: ReportLayout["posts"] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (let r = headerRow + 1; r < grid.length; r++) {
    const v = grid[r]![linkCol] ?? null;
    if (!looksLikeIgLink(v)) continue;
    const url = (v as string).trim();
    const parsed = parseInstagramUrl(url);
    if (!parsed.ok) {
      invalid.push({ row: r, url, message: parsed.message });
      continue;
    }
    dataRows.push({ row: r, url, shortcode: parsed.shortcode, canonicalUrl: parsed.canonicalUrl });
    if (seen.has(parsed.shortcode)) duplicates++;
    else {
      seen.add(parsed.shortcode);
      posts.push({ url, shortcode: parsed.shortcode });
    }
  }
  if (dataRows.length === 0) {
    return { ok: false, message: "The links found aren't posts or reels (stories, profiles and share links can't be used)." };
  }

  // Existing totals row: first non-empty row after the last data row, if it has no link and has a
  // number in one of the metric columns.
  const last = dataRows[dataRows.length - 1]!.row;
  let totalsRow: number | null = null;
  for (let r = last + 1; r < grid.length; r++) {
    const row = grid[r]!;
    if (row.every((c) => c === null || cellString(c).trim() === "")) continue;
    const hasLink = looksLikeIgLink(row[linkCol] ?? null);
    const hasNumber = REPORT_METRICS.some((m) => toNumber(row[metricCols[m.key]] ?? null) !== null);
    if (!hasLink && hasNumber) totalsRow = r;
    break;
  }

  return {
    ok: true,
    grid,
    layout: {
      headerRow,
      insertedHeader,
      linkCol,
      metricCols,
      addedMetrics,
      linkHeader: cellString(header[linkCol] ?? null) || "POSTED LINK",
      dataRows,
      totalsRow,
      invalid,
      posts,
      duplicates,
    },
  };
}

/** A date whose UTC calendar day equals the viewer's local calendar day (what Excel will display). */
function localCalendarDate(iso: string): Date {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/** T. ENG = likes + comments + reposts + shares + saves (known parts only); null if none known. */
export function totalEngagement(parts: Array<number | null>): number | null {
  const known = parts.filter((p): p is number => p !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

/** Values to write for one fetched post. null = don't overwrite the cell. */
export function metricValues(res: ScrapeResponse): Record<MetricKey, Cell> {
  const s = res.snapshot;
  const tEng = totalEngagement([s.like_count, s.comment_count, s.repost_count, s.reshare_count, s.save_count]);
  return {
    posted_date: res.post.taken_at ? localCalendarDate(res.post.taken_at) : null,
    views: s.play_count,
    likes: s.like_count,
    comments: s.comment_count,
    reposts: s.repost_count,
    shares: s.reshare_count,
    saves: s.save_count,
    total_eng: tEng,
    eng_rate: tEng !== null && s.play_count ? tEng / s.play_count : null,
  };
}

export interface FilledReport {
  grid: Grid;
  /** Row index of the totals row in `grid`. */
  totalsRow: number;
  /** True when a new row was inserted for totals (rows below it shifted down by one). */
  insertedTotalsRow: boolean;
  /** Every cell this fill wrote (for styling in Excel). */
  written: Array<{ row: number; col: number; kind: MetricDef["kind"] | "header" }>;
}

/**
 * Writes fetched metrics into each data row and (re)computes the totals row.
 * Cells are only overwritten with real values: a failed fetch or a missing metric leaves the
 * existing cell untouched. Totals are computed from the final cell values.
 */
export function fillReport(grid0: Grid, layout: ReportLayout, results: Map<string, ScrapeResponse>): FilledReport {
  const grid: Grid = grid0.map((r) => [...r]);
  const written: FilledReport["written"] = [];
  const set = (row: number, col: number, v: Cell, kind: FilledReport["written"][number]["kind"]) => {
    const r = grid[row]!;
    while (r.length <= col) r.push(null);
    r[col] = v;
    written.push({ row, col, kind });
  };

  for (const key of layout.addedMetrics) {
    set(layout.headerRow, layout.metricCols[key], REPORT_METRICS.find((m) => m.key === key)!.header, "header");
  }

  for (const d of layout.dataRows) {
    const res = results.get(d.shortcode);
    if (!res) continue;
    const values = metricValues(res);
    for (const m of REPORT_METRICS) {
      const v = values[m.key];
      if (v !== null) set(d.row, layout.metricCols[m.key], v, m.kind);
    }
  }

  let totalsRow = layout.totalsRow;
  let insertedTotalsRow = false;
  if (totalsRow === null) {
    totalsRow = layout.dataRows[layout.dataRows.length - 1]!.row + 1;
    const row = grid[totalsRow];
    const empty = !row || row.every((c) => c === null || cellString(c).trim() === "");
    if (!empty) {
      grid.splice(totalsRow, 0, []);
      insertedTotalsRow = true;
    } else {
      grid[totalsRow] = row ?? [];
    }
  }

  const sum = (key: MetricKey) => {
    let total = 0;
    let any = false;
    for (const d of layout.dataRows) {
      const n = toNumber(grid[d.row]![layout.metricCols[key]] ?? null);
      if (n !== null) {
        total += n;
        any = true;
      }
    }
    return any ? total : null;
  };
  for (const m of REPORT_METRICS) {
    if (m.kind !== "int") continue;
    set(totalsRow, layout.metricCols[m.key], sum(m.key), "int");
  }
  const tEng = sum("total_eng");
  const views = sum("views");
  set(totalsRow, layout.metricCols.eng_rate, tEng !== null && views ? tEng / views : null, "percent");

  return { grid, totalsRow, insertedTotalsRow, written };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Display text for a cell: dates as dd/mm/yyyy, ratios in the ENG. % column as 4.35%. */
export function displayCell(v: Cell, kind?: MetricDef["kind"]): string {
  if (v === null) return "";
  if (v instanceof Date) return `${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
  if (typeof v === "number" && kind === "percent") return `${(v * 100).toFixed(2)}%`;
  return String(v);
}

/** Column index → metric kind, for formatting. */
export function kindsByColumn(layout: ReportLayout): Map<number, MetricDef["kind"]> {
  return new Map(REPORT_METRICS.map((m) => [layout.metricCols[m.key], m.kind]));
}

/** Rows from `fromRow` down, padded to a rectangle. */
export function rectangle(grid: Grid, fromRow = 0): Grid {
  const w = width(grid);
  return grid.slice(fromRow).map((r) => Array.from({ length: w }, (_, c) => r[c] ?? null));
}

/** CSV of the filled sheet (from the header row down), UTF-8 BOM for Excel. */
export function reportToCsv(filled: FilledReport, layout: ReportLayout): string {
  const kinds = kindsByColumn(layout);
  const esc = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = rectangle(filled.grid, layout.headerRow).map((r) => r.map((v, c) => esc(displayCell(v, kinds.get(c)))).join(","));
  return "﻿" + rows.join("\r\n") + "\r\n";
}

/** Tab-separated text for pasting into Google Sheets. */
export function reportToTsv(filled: FilledReport, layout: ReportLayout): string {
  const kinds = kindsByColumn(layout);
  return rectangle(filled.grid, layout.headerRow)
    .map((r) => r.map((v, c) => displayCell(v, kinds.get(c)).replace(/[\t\r\n]+/g, " ")).join("\t"))
    .join("\n");
}

export function exportFilename(ext: string, now = new Date()): string {
  const d = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `campaign-report-${d}-${pad(now.getHours())}${pad(now.getMinutes())}.${ext}`;
}
