import { describe, expect, it } from "vitest";
import type { ScrapeResponse } from "@/lib/api/types";
import { COLUMNS, exportFilename, toCsv, toExportRows, toTsv, type BulkRow } from "@/lib/bulk/export";
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

const scrape: ScrapeResponse = {
  cached: false,
  post: {
    id: "p1",
    shortcode: "Dd0S2thT7Ni",
    media_pk: "1",
    owner_username: "creator",
    owner_pk: "2",
    media_type: 2,
    product_type: "clips",
    caption: 'Line one\nwith "quotes", commas\tand tabs',
    taken_at: "2026-09-28T04:11:56Z",
    first_seen_at: "2026-09-28T09:00:00Z",
    last_fetched_at: "2026-09-28T09:40:40Z",
  },
  snapshot: {
    id: "s1",
    post_id: "p1",
    fetched_at: "2026-09-28T09:40:40Z",
    source_endpoint: "v2_by_url",
    like_count: 38947,
    comment_count: 396,
    play_count: 391610,
    ig_play_count: 361514,
    fb_play_count: 30096,
    reshare_count: 1345,
    repost_count: null,
    save_count: 0,
    likes_hidden: false,
    shares_disabled: false,
  },
};

const rows: BulkRow[] = [
  { url: "https://www.instagram.com/reel/Dd0S2thT7Ni/", shortcode: "Dd0S2thT7Ni", status: "done", data: scrape },
  { url: "https://www.instagram.com/p/GoneGone123/", shortcode: "GoneGone123", status: "error", code: "POST_NOT_FOUND", message: "Post not found." },
];

describe("export", () => {
  const data = toExportRows(rows);

  it("maps results, keeping unknown values null and real zeros as 0", () => {
    expect(data[0]).toMatchObject({ username: "creator", type: "Reel", views: 391610, reposts: null, saves: 0, status: "fetched" });
    expect(data[0]!.engagement_rate).toBeCloseTo((38947 + 396 + 1345) / 391610);
    expect(data[1]).toMatchObject({ status: "error", error: "Post not found.", views: null, post_url: "https://www.instagram.com/p/GoneGone123/" });
  });

  it("writes CSV with a BOM, escaped fields, empty cells for unknowns and 0 for real zeros", () => {
    const csv = toCsv(data);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(COLUMNS.map((c) => c.header).join(","));
    expect(lines[1]).toContain(",391610,361514,30096,38947,396,1345,,0,");
    expect(lines[1]).toContain(',2026-09-28,');
    expect(lines[1]).toContain(',2026-09-28 09:40,fetched,,');
    expect(csv).toContain('"Line one\nwith ""quotes"", commas\tand tabs"');
  });

  it("writes TSV without tabs or newlines inside values", () => {
    const tsv = toTsv(data).split("\n");
    expect(tsv).toHaveLength(3);
    for (const line of tsv) expect(line.split("\t")).toHaveLength(COLUMNS.length);
    expect(tsv[1]).toContain('Line one with "quotes", commas and tabs');
  });

  it("names files with a UTC timestamp", () => {
    expect(exportFilename("xlsx", new Date("2026-09-28T09:05:00Z"))).toBe("instagram-metrics-2026-09-28-0905.xlsx");
  });
});
