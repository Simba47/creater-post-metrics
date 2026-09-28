import { describe, expect, it } from "vitest";
import type { ScrapeResponse } from "@/lib/api/types";
import { parseCsv } from "@/lib/bulk/csv";
import { analyzeSheet, fillReport, reportToCsv, reportToTsv, toNumber, type Grid } from "@/lib/bulk/report";
import { extractInstagramUrls } from "@/lib/bulk/extractUrls";
import { isAllowedSheetHost, sheetCsvExportUrl } from "@/lib/bulk/googleSheet";

describe("extractInstagramUrls", () => {
  it("finds links in any column of a CSV, de-dupes by shortcode, and reports bad links", () => {
    const csv = [
      "name,link,notes",
      'Reel A,https://www.instagram.com/reel/Dd0S2thT7Ni/?igsh=abc,"great, viral"',
      "Same reel,https://instagram.com/p/Dd0S2thT7Ni,",
      "Photo,www.instagram.com/p/BsOGulcndj-/.,",
      "Story,https://www.instagram.com/stories/natgeo/123/,",
      "Profile,https://www.instagram.com/natgeo/,",
      "Other site,https://www.tiktok.com/@x/video/1,",
    ].join("\n");
    const r = extractInstagramUrls(csv);
    expect(r.valid.map((v) => v.shortcode)).toEqual(["Dd0S2thT7Ni", "BsOGulcndj-"]);
    expect(r.duplicates).toBe(1);
    expect(r.invalid.map((x) => x.url)).toEqual([
      "https://www.instagram.com/stories/natgeo/123/",
      "https://www.instagram.com/natgeo/",
    ]);
    expect(r.valid[0]!.canonicalUrl).toBe("https://www.instagram.com/p/Dd0S2thT7Ni/");
  });

  it("handles links pasted on one line or separated by spaces/semicolons", () => {
    const r = extractInstagramUrls(
      "https://www.instagram.com/p/AAAAAAAAAA1/ https://www.instagram.com/reel/BBBBBBBBBB2/;https://www.instagram.com/tv/CCCCCCCCCC3/",
    );
    expect(r.valid).toHaveLength(3);
  });

  it("returns nothing for text without Instagram links", () => {
    expect(extractInstagramUrls("just some words")).toEqual({ valid: [], invalid: [], duplicates: 0 });
  });
});

describe("sheetCsvExportUrl", () => {
  it("builds an export URL from a share link and keeps the tab", () => {
    expect(sheetCsvExportUrl("https://docs.google.com/spreadsheets/d/1AbC_d-EF/edit#gid=12345")).toEqual({
      ok: true,
      exportUrl: "https://docs.google.com/spreadsheets/d/1AbC_d-EF/export?format=csv&gid=12345",
    });
    expect(sheetCsvExportUrl("https://docs.google.com/spreadsheets/d/1AbC/edit?usp=sharing")).toEqual({
      ok: true,
      exportUrl: "https://docs.google.com/spreadsheets/d/1AbC/export?format=csv",
    });
  });

  it("supports publish-to-web links", () => {
    expect(sheetCsvExportUrl("https://docs.google.com/spreadsheets/d/e/2PACX-1vQ/pubhtml?gid=7")).toEqual({
      ok: true,
      exportUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ/pub?output=csv&gid=7",
    });
  });

  it("rejects non-Google-Sheets links", () => {
    expect(sheetCsvExportUrl("https://evil.example/spreadsheets/d/abc").ok).toBe(false);
    expect(sheetCsvExportUrl("https://docs.google.com/document/d/abc/edit").ok).toBe(false);
    expect(sheetCsvExportUrl("not a url").ok).toBe(false);
  });

  it("only allows Google hosts for redirects", () => {
    expect(isAllowedSheetHost("docs.google.com")).toBe(true);
    expect(isAllowedSheetHost("doc-0s-4c-sheets.googleusercontent.com")).toBe(true);
    expect(isAllowedSheetHost("accounts.google.com")).toBe(false);
    expect(isAllowedSheetHost("evilgoogleusercontent.com")).toBe(false);
  });
});


// The user's campaign-report layout, with their real numbers.
const HEADER = ["NAME", "FOLLOWERS", "IG LINK", "AVG. REACH", "POSTED LINK", "POSTED DATE", "VIEWS", "LIKES", "COMMENTS", "REPOST", "SHARE", "SAVES", "T. ENG", "ENG. %"];
const sheet = (): Grid => [
  HEADER,
  ["HAPA", "483K", "https://www.instagram.com/_sridhar_chapa_/", 250000, "https://www.instagram.com/reel/DdoTsLzOEQk/", null, null, null, null, null, null, null, null, null],
  ["VENKY", "186K", "https://www.instagram.com/they_call_him_vv/", 100000, "https://www.instagram.com/reel/DdoMPyCzssa/", null, null, null, null, null, null, null, null, null],
  ["", "27.3K", "https://www.instagram.com/karthik.explores/", 70000, "https://www.instagram.com/reel/DdoPlOpzuS7/", null, null, null, null, null, null, null, null, null],
];

function result(shortcode: string, m: { views: number | null; likes: number | null; comments: number | null; reposts: number | null; shares: number | null; saves: number | null }): ScrapeResponse {
  return {
    cached: false,
    post: { id: shortcode, shortcode, media_pk: "1", owner_username: "x", owner_pk: "2", media_type: 2, product_type: "clips", caption: null, taken_at: "2026-09-23T06:00:00Z", first_seen_at: "", last_fetched_at: "" },
    snapshot: {
      id: "s", post_id: shortcode, fetched_at: "2026-09-28T09:00:00Z", source_endpoint: "v2_by_url",
      play_count: m.views, like_count: m.likes, comment_count: m.comments, repost_count: m.reposts, reshare_count: m.shares, save_count: m.saves,
      ig_play_count: null, fb_play_count: null, likes_hidden: false, shares_disabled: false,
    },
  };
}

const RESULTS = new Map<string, ScrapeResponse>([
  ["DdoTsLzOEQk", result("DdoTsLzOEQk", { views: 691647, likes: 29257, comments: 5, reposts: 97, shares: 404, saves: 291 })],
  ["DdoMPyCzssa", result("DdoMPyCzssa", { views: 199188, likes: 4900, comments: 7, reposts: 306, shares: 4048, saves: 13 })],
  ["DdoPlOpzuS7", result("DdoPlOpzuS7", { views: 126355, likes: 603, comments: 2, reposts: 4, shares: 10, saves: 10 })],
]);

function analyze(grid: Grid) {
  const a = analyzeSheet(grid);
  if (!a.ok) throw new Error(a.message);
  return a;
}

describe("analyzeSheet", () => {
  it("finds the POSTED LINK column (not the IG LINK profile column) and the existing metric columns", () => {
    const { layout } = analyze(sheet());
    expect(layout.headerRow).toBe(0);
    expect(layout.linkCol).toBe(4);
    expect(layout.linkHeader).toBe("POSTED LINK");
    expect(layout.addedMetrics).toEqual([]);
    expect(layout.metricCols).toMatchObject({ posted_date: 5, views: 6, likes: 7, comments: 8, reposts: 9, shares: 10, saves: 11, total_eng: 12, eng_rate: 13 });
    expect(layout.posts.map((p) => p.shortcode)).toEqual(["DdoTsLzOEQk", "DdoMPyCzssa", "DdoPlOpzuS7"]);
    expect(layout.totalsRow).toBeNull();
  });

  it("appends missing metric columns after the last column", () => {
    const grid: Grid = [["NAME", "POSTED LINK", "VIEWS"], ["A", "https://www.instagram.com/reel/DdoTsLzOEQk/", null]];
    const { layout } = analyze(grid);
    expect(layout.metricCols.views).toBe(2);
    expect(layout.metricCols.posted_date).toBe(3);
    expect(layout.addedMetrics).toEqual(["posted_date", "likes", "comments", "reposts", "shares", "saves", "total_eng", "eng_rate"]);
  });

  it("detects an existing totals row and a title row above the header", () => {
    const grid: Grid = [["Campaign X"], [], ...sheet(), [null, null, null, null, null, null, "1,017,190", 34760]];
    const { layout } = analyze(grid);
    expect(layout.headerRow).toBe(2);
    expect(layout.totalsRow).toBe(6);
  });

  it("inserts a header when the sheet has none", () => {
    const { grid, layout } = analyze([["https://www.instagram.com/p/DdoTsLzOEQk/"], ["https://www.instagram.com/p/DdoMPyCzssa/"]]);
    expect(layout.insertedHeader).toBe(true);
    expect(grid[0]).toEqual(["POSTED LINK"]);
    expect(layout.dataRows.map((d) => d.row)).toEqual([1, 2]);
  });

  it("counts repeated posts once and reports unusable links", () => {
    const grid = sheet();
    grid.push(["DUP", "", "", "", "https://instagram.com/reel/DdoTsLzOEQk", null]);
    grid.push(["BAD", "", "", "", "https://www.instagram.com/stories/x/1/", null]);
    const { layout } = analyze(grid);
    expect(layout.dataRows).toHaveLength(4);
    expect(layout.posts).toHaveLength(3);
    expect(layout.duplicates).toBe(1);
    expect(layout.invalid).toHaveLength(1);
  });

  it("fails clearly when there are no post links", () => {
    expect(analyzeSheet([["NAME", "IG LINK"], ["A", "https://www.instagram.com/natgeo/"]]).ok).toBe(false);
  });
});

describe("fillReport", () => {
  it("reproduces the campaign sheet: per-row T. ENG / ENG. % and the totals row", () => {
    const { grid, layout } = analyze(sheet());
    const filled = fillReport(grid, layout, RESULTS);
    const row = (r: number) => filled.grid[r]!;

    expect(row(1).slice(0, 5)).toEqual(sheet()[1]!.slice(0, 5)); // user's own columns untouched
    expect(row(1).slice(6, 13)).toEqual([691647, 29257, 5, 97, 404, 291, 30054]);
    expect(row(1)[13]).toBeCloseTo(0.04345, 4); // 4.35%
    expect(row(2)[12]).toBe(9274);
    expect(row(2)[13]).toBeCloseTo(0.04656, 4); // 4.66%
    expect(row(3)[12]).toBe(629);
    expect(row(3)[13]).toBeCloseTo(0.00498, 4); // 0.50%
    expect((row(1)[5] as Date).toISOString().slice(0, 10)).toBe("2026-09-23");

    expect(filled.totalsRow).toBe(4);
    expect(row(4).slice(6, 13)).toEqual([1017190, 34760, 14, 407, 4462, 314, 39957]);
    expect(row(4)[13]).toBeCloseTo(0.03928, 4); // 3.93%
  });

  it("never overwrites a cell with an unknown value, and keeps the sheet's values for failed rows", () => {
    const grid = sheet();
    grid[2]![11] = 99; // a SAVES value typed in by hand
    grid[3]![6] = 5000; // VIEWS for a row whose fetch failed
    const { grid: g, layout } = analyze(grid);
    const partial = new Map(RESULTS);
    partial.set("DdoMPyCzssa", result("DdoMPyCzssa", { views: 199188, likes: 4900, comments: 7, reposts: null, shares: 4048, saves: null }));
    partial.delete("DdoPlOpzuS7");
    const filled = fillReport(g, layout, partial);
    expect(filled.grid[2]![11]).toBe(99);
    expect(filled.grid[2]![9]).toBeNull();
    expect(filled.grid[2]![12]).toBe(4900 + 7 + 4048); // T. ENG from known parts only
    expect(filled.grid[3]![6]).toBe(5000);
    expect(filled.grid[4]![6]).toBe(691647 + 199188 + 5000);
  });

  it("fills an existing totals row in place instead of adding another", () => {
    const grid: Grid = [...sheet(), [null, null, null, null, null, null, 1, 2]];
    const { grid: g, layout } = analyze(grid);
    const filled = fillReport(g, layout, RESULTS);
    expect(filled.totalsRow).toBe(4);
    expect(filled.insertedTotalsRow).toBe(false);
    expect(filled.grid).toHaveLength(5);
    expect(filled.grid[4]![6]).toBe(1017190);
  });

  it("inserts a totals row when the next row is used, shifting it down", () => {
    const grid: Grid = [...sheet(), ["Notes: paid collab", null]];
    const { grid: g, layout } = analyze(grid);
    const filled = fillReport(g, layout, RESULTS);
    expect(filled.insertedTotalsRow).toBe(true);
    expect(filled.grid[4]![6]).toBe(1017190);
    expect(filled.grid[5]![0]).toBe("Notes: paid collab");
  });
});

describe("report CSV / TSV", () => {
  const { grid, layout } = analyze(sheet());
  const filled = fillReport(grid, layout, RESULTS);

  it("formats dates as dd/mm/yyyy and ENG. % as a percentage; round-trips through the CSV parser", () => {
    const csv = reportToCsv(filled, layout);
    expect(csv.startsWith("﻿")).toBe(true);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(HEADER);
    expect(rows[1]).toEqual([
      "HAPA", "483K", "https://www.instagram.com/_sridhar_chapa_/", "250000", "https://www.instagram.com/reel/DdoTsLzOEQk/",
      "23/09/2026", "691647", "29257", "5", "97", "404", "291", "30054", "4.35%",
    ]);
    expect(rows[4]!.slice(6)).toEqual(["1017190", "34760", "14", "407", "4462", "314", "39957", "3.93%"]);
  });

  it("TSV has one line per row and the same number of columns everywhere", () => {
    const lines = reportToTsv(filled, layout).split("\n");
    expect(lines).toHaveLength(5);
    for (const l of lines) expect(l.split("\t")).toHaveLength(HEADER.length);
  });
});

describe("helpers", () => {
  it("toNumber reads numeric strings but not abbreviations", () => {
    expect(toNumber("1,017,190")).toBe(1017190);
    expect(toNumber("3.93%")).toBeCloseTo(0.0393);
    expect(toNumber("483K")).toBeNull();
    expect(toNumber(null)).toBeNull();
  });

  it("parseCsv handles quotes, commas and newlines in fields", () => {
    expect(parseCsv('a,"b, c","d ""e""\nf"\r\n1,2,3')).toEqual([["a", "b, c", 'd "e"\nf'], ["1", "2", "3"]]);
  });
});
