"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { ErrorState, InfoTip, NumberCell, Spinner } from "@/components/ui";
import { apiFetch, ApiClientError } from "@/lib/api/client";
import type { BatchScrapeResponse, SheetFetchResponse } from "@/lib/api/types";
import { BATCH_MAX, BULK_MAX_URLS } from "@/lib/bulk/constants";
import type { ScrapeResponse } from "@/lib/api/types";
import { parseCsv } from "@/lib/bulk/csv";
import { extractInstagramUrls } from "@/lib/bulk/extractUrls";
import { ACCEPTED_FILE_TYPES, FileReadError, readSheetSource, type SheetSource, type SheetTab } from "@/lib/bulk/readFile";
import {
  analyzeSheet,
  exportFilename,
  fillReport,
  REPORT_METRICS,
  reportToCsv,
  reportToTsv,
  type Grid,
  type ReportLayout,
} from "@/lib/bulk/report";
import { nullReason } from "@/lib/metrics/nullReason";

type Mode = "file" | "sheet" | "paste";

const MODES: Array<{ id: Mode; label: string }> = [
  { id: "file", label: "Upload Excel / CSV" },
  { id: "sheet", label: "Google Sheet link" },
  { id: "paste", label: "Paste URLs" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One unique post in a run. */
type BulkRow =
  | { url: string; shortcode: string; status: "pending" }
  | { url: string; shortcode: string; status: "done"; data: ScrapeResponse }
  | { url: string; shortcode: string; status: "error"; code: string; message: string };

interface Loaded {
  grid: Grid;
  layout: ReportLayout;
  xlsx: SheetSource["xlsx"];
}

function Button({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        primary
          ? "rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          : "rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
      }
    >
      {children}
    </button>
  );
}

function StatusBadge({ row }: { row: BulkRow }) {
  const base = "inline-flex rounded-full px-2 py-0.5 text-xs font-medium";
  if (row.status === "pending") return <span className={`${base} text-zinc-500`}>Waiting</span>;
  if (row.status === "error") {
    return (
      <InfoTip text={row.message}>
        <span className={`${base} cursor-help bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200`}>Failed</span>
      </InfoTip>
    );
  }
  return row.data.cached ? (
    <span className={`${base} bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200`}>Cached</span>
  ) : (
    <span className={`${base} bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200`}>Fetched</span>
  );
}

export default function BulkPage() {
  const [mode, setMode] = useState<Mode>("file");
  const [pasteText, setPasteText] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [currentTab, setCurrentTab] = useState("");
  const [loadingInput, setLoadingInput] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [showInvalid, setShowInvalid] = useState(false);

  const [force, setForce] = useState(false);
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [running, setRunning] = useState(false);
  const [waitNote, setWaitNote] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const cancelRef = useRef(false);
  // Bumped on every new input so a slow read of an earlier file can't overwrite a newer one.
  const loadIdRef = useRef(0);
  // The uploaded workbook, kept so the user can switch tabs (even from one without links).
  const xlsxBufferRef = useRef<ArrayBuffer | null>(null);

  const toFetch = loaded ? loaded.layout.posts.slice(0, BULK_MAX_URLS) : [];

  const counts = useMemo(() => {
    let fetched = 0, cached = 0, failed = 0, pending = 0;
    for (const r of rows) {
      if (r.status === "pending") pending++;
      else if (r.status === "error") failed++;
      else if (r.data.cached) cached++;
      else fetched++;
    }
    return { fetched, cached, failed, pending, done: rows.length - pending };
  }, [rows]);

  function resetInput() {
    loadIdRef.current++;
    setLoaded(null);
    setTabs([]);
    setRows([]);
    setInputError(null);
    setShowInvalid(false);
  }

  function applySource(source: SheetSource) {
    setTabs(source.tabs ?? []);
    setCurrentTab(source.xlsx?.sheetName ?? "");
    setInputError(null);
    const analysis = analyzeSheet(source.grid);
    if (!analysis.ok) {
      setLoaded(null);
      setInputError(analysis.message);
      return;
    }
    setLoaded({ grid: analysis.grid, layout: analysis.layout, xlsx: source.xlsx });
  }

  function selectTab(name: string) {
    const tab = tabs.find((t) => t.name === name);
    const buffer = xlsxBufferRef.current;
    if (!tab || !buffer) return;
    setRows([]);
    setShowInvalid(false);
    applySource({ grid: tab.grid, xlsx: { buffer, sheetName: tab.name }, tabs });
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    resetInput();
    const loadId = loadIdRef.current;
    setFileName(file.name);
    setLoadingInput(true);
    try {
      const source = await readSheetSource(file);
      if (loadId === loadIdRef.current) {
        xlsxBufferRef.current = source.xlsx?.buffer ?? null;
        applySource(source);
      }
    } catch (err) {
      if (loadId === loadIdRef.current) setInputError(err instanceof FileReadError ? err.message : "Couldn't read that file.");
    } finally {
      if (loadId === loadIdRef.current) setLoadingInput(false);
    }
  }

  function clearFile() {
    resetInput();
    setFileName(null);
    setLoadingInput(false);
  }

  async function onLoadSheet() {
    resetInput();
    setLoadingInput(true);
    try {
      const { csv } = await apiFetch<SheetFetchResponse>("/api/bulk/sheet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: sheetUrl }),
      });
      applySource({ grid: parseCsv(csv), xlsx: null });
    } catch (err) {
      setInputError(err instanceof ApiClientError ? err.message : "Couldn't load that sheet.");
    } finally {
      setLoadingInput(false);
    }
  }

  function onPaste(text: string) {
    setPasteText(text);
    resetInput();
    if (!text.trim()) return;
    // Pasted links become a one-column sheet: POSTED LINK + the filled metric columns.
    const found = extractInstagramUrls(text);
    const links = [...found.valid.map((v) => v.url), ...found.invalid.map((x) => x.url)];
    if (links.length === 0) setInputError("No Instagram links found.");
    else applySource({ grid: [["POSTED LINK"], ...links.map((l) => [l])], xlsx: null });
  }

  /** Fetches the given row indexes in batches, updating rows as results arrive. */
  async function run(targetRows: BulkRow[], indexes: number[]) {
    cancelRef.current = false;
    setRunning(true);
    setNotice(null);
    try {
      for (let i = 0; i < indexes.length; i += BATCH_MAX) {
        if (cancelRef.current) break;
        const chunk = indexes.slice(i, i + BATCH_MAX);
        let response: BatchScrapeResponse | null = null;
        let failure: string | null = null;

        while (!cancelRef.current) {
          try {
            response = await apiFetch<BatchScrapeResponse>("/api/scrape/batch", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ urls: chunk.map((idx) => targetRows[idx]!.url), force }),
            });
            break;
          } catch (err) {
            if (err instanceof ApiClientError && err.code === "RATE_LIMITED") {
              const wait = err.retryAfterSec ?? 15;
              setWaitNote(`Pausing ${wait}s for the rate limit…`);
              await sleep(wait * 1000);
              setWaitNote(null);
              continue;
            }
            failure = err instanceof ApiClientError ? err.message : "Unexpected error.";
            break;
          }
        }

        setRows((prev) => {
          const next = [...prev];
          chunk.forEach((idx, j) => {
            const row = next[idx]!;
            const item = response?.results[j];
            if (item?.ok) next[idx] = { url: row.url, shortcode: row.shortcode, status: "done", data: item.data };
            else if (item) next[idx] = { url: row.url, shortcode: row.shortcode, status: "error", code: item.error.code, message: item.error.message };
            else if (failure) next[idx] = { url: row.url, shortcode: row.shortcode, status: "error", code: "UPSTREAM_ERROR", message: failure };
          });
          return next;
        });
      }
    } finally {
      setWaitNote(null);
      setRunning(false);
      if (cancelRef.current) setNotice("Stopped. Rows marked “Waiting” weren't fetched.");
    }
  }

  function startAll() {
    const initial: BulkRow[] = toFetch.map((v) => ({ url: v.url, shortcode: v.shortcode, status: "pending" }));
    setRows(initial);
    void run(initial, initial.map((_, i) => i));
  }

  function retryUnfinished() {
    const indexes = rows.flatMap((r, i) => (r.status === "error" || r.status === "pending" ? [i] : []));
    const next = rows.map((r): BulkRow =>
      r.status === "error" ? { url: r.url, shortcode: r.shortcode, status: "pending" } : r,
    );
    setRows(next);
    void run(next, indexes);
  }

  async function exportAs(kind: "csv" | "xlsx" | "pdf" | "sheets") {
    if (!loaded) return;
    const results = new Map(rows.flatMap((r) => (r.status === "done" ? [[r.shortcode, r.data] as const] : [])));
    const filled = fillReport(loaded.grid, loaded.layout, results);
    setNotice(null);
    try {
      if (kind === "sheets") {
        await navigator.clipboard.writeText(reportToTsv(filled, loaded.layout));
        setNotice("Copied! Open a Google Sheet (sheets.new), click cell A1 and paste (Ctrl/⌘ + V).");
        return;
      }
      const files = await import("@/lib/bulk/exportFiles");
      if (kind === "csv") files.downloadBlob(reportToCsv(filled, loaded.layout), "text/csv;charset=utf-8", exportFilename("csv"));
      if (kind === "xlsx") {
        const data = loaded.xlsx
          ? await files.fillWorkbook(loaded.xlsx.buffer, loaded.xlsx.sheetName, filled, loaded.layout)
          : await files.buildStyledWorkbook(filled, loaded.layout);
        files.downloadBlob(data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", exportFilename("xlsx"));
      }
      if (kind === "pdf") files.downloadBlob(await files.buildPdf(filled, loaded.layout), "application/pdf", exportFilename("pdf"));
    } catch (err) {
      console.error(err);
      setNotice(kind === "sheets" ? "Couldn't copy to the clipboard. Use the CSV or Excel download instead." : "Export failed. Please try again.");
    }
  }

  const unfinished = counts.failed + (running ? 0 : counts.pending);
  const progress = rows.length ? Math.round((counts.done / rows.length) * 100) : 0;

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Bulk fetch</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Upload your campaign sheet (or a Google Sheet / pasted links). The app finds the post links, fetches
          every post, and fills in POSTED DATE, VIEWS, LIKES, COMMENTS, REPOST, SHARE, SAVES, T. ENG and ENG. % plus a
          totals row. Your other columns (name, followers, reach…) stay as they are.
        </p>
      </section>

      {/* 1. Input */}
      <section className="rounded-xl border border-zinc-200 bg-white p-4 sm:p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <div role="tablist" className="flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              disabled={running}
              onClick={() => {
                setMode(m.id);
                resetInput();
              }}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
                mode === m.id
                  ? "bg-white shadow-sm dark:bg-zinc-800"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          {mode === "file" && (
            <div className="relative">
              <label className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-zinc-300 px-4 py-8 text-center text-sm hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500">
                <span className="font-medium">{fileName ?? "Choose an Excel (.xlsx) or CSV file"}</span>
                <span className="text-zinc-500 dark:text-zinc-400">Every sheet and column is scanned for Instagram links.</span>
                <input type="file" accept={ACCEPTED_FILE_TYPES} onChange={onFile} disabled={running} className="sr-only" />
              </label>
              {fileName && !running && (
                <button
                  type="button"
                  onClick={clearFile}
                  aria-label="Remove file"
                  title="Remove file"
                  className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-lg leading-none text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  ×
                </button>
              )}
              {tabs.length > 1 && (
                <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">Sheet tab:</span>
                  <select
                    value={currentTab}
                    onChange={(e) => selectTab(e.target.value)}
                    disabled={running}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    {tabs.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name.trim() || t.name} ({t.posts} post{t.posts === 1 ? "" : "s"})
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    Tab missing? Download the sheet again, or paste its link under Google Sheet link.
                  </span>
                </label>
              )}
            </div>
          )}

          {mode === "sheet" && (
            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="url"
                  value={sheetUrl}
                  onChange={(e) => setSheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/…/edit"
                  className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
                />
                <Button primary onClick={() => void onLoadSheet()} disabled={!sheetUrl.trim() || loadingInput || running}>
                  Load sheet
                </Button>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                The sheet must be shared as <strong>Anyone with the link → Viewer</strong>. The tab in your link is the
                one that&apos;s read.
              </p>
            </div>
          )}

          {mode === "paste" && (
            <textarea
              value={pasteText}
              onChange={(e) => onPaste(e.target.value)}
              disabled={running}
              rows={6}
              placeholder={"https://www.instagram.com/reel/…\nhttps://www.instagram.com/p/…"}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm outline-none ring-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900"
            />
          )}
        </div>

        {loadingInput && <Spinner label="Reading…" />}
        {inputError && (
          <div className="mt-4">
            <ErrorState title="Couldn't use that input" message={inputError} />
          </div>
        )}

        {loaded && (
          <div className="mt-4 space-y-3 border-t border-zinc-200 pt-4 text-sm dark:border-zinc-800">
            <p>
              Found <strong>{loaded.layout.posts.length}</strong> post{loaded.layout.posts.length === 1 ? "" : "s"} in
              the <strong>{loaded.layout.linkHeader}</strong> column
              {loaded.xlsx && <> of sheet <strong>{loaded.xlsx.sheetName}</strong></>}
              {loaded.layout.duplicates > 0 && (
                <span className="text-zinc-500"> · {loaded.layout.duplicates} rows repeat a post (fetched once)</span>
              )}
              {loaded.layout.invalid.length > 0 && (
                <>
                  <span className="text-zinc-500"> · </span>
                  <button onClick={() => setShowInvalid((s) => !s)} className="text-zinc-500 underline underline-offset-4">
                    {loaded.layout.invalid.length} link{loaded.layout.invalid.length === 1 ? "" : "s"} can&apos;t be used
                  </button>
                </>
              )}
            </p>
            <p className="text-zinc-600 dark:text-zinc-400">
              Will fill{" "}
              {REPORT_METRICS.map((m, i) => (
                <span key={m.key}>
                  {i > 0 && ", "}
                  <span className={loaded.layout.addedMetrics.includes(m.key) ? "italic" : "font-medium text-zinc-900 dark:text-zinc-100"}>
                    {m.header}
                  </span>
                </span>
              ))}{" "}
              and a totals row.
              {loaded.layout.addedMetrics.length > 0 && " Columns in italics aren't in your sheet and will be added at the end."}
              {" "}Everything else in your sheet stays as it is.
            </p>
            {showInvalid && (
              <ul className="max-h-48 space-y-1 overflow-auto rounded-lg bg-zinc-50 p-3 text-xs dark:bg-zinc-900">
                {loaded.layout.invalid.map((x) => (
                  <li key={`${x.row}-${x.url}`}>
                    <span className="break-all font-mono">{x.url}</span>
                    <span className="text-zinc-500"> — {x.message}</span>
                  </li>
                ))}
              </ul>
            )}
            {loaded.layout.posts.length > BULK_MAX_URLS && (
              <p className="text-amber-700 dark:text-amber-300">
                Only the first {BULK_MAX_URLS} will be fetched. Split larger lists into several runs.
              </p>
            )}

            {toFetch.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Button primary onClick={startAll} disabled={running}>
                  Fetch {toFetch.length} post{toFetch.length === 1 ? "" : "s"}
                </Button>
                <label className="inline-flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
                  <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} disabled={running} className="h-4 w-4" />
                  Force refresh
                </label>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Uses up to {toFetch.length} HikerAPI requests. Posts fetched recently are reused for free
                  {force ? " (except with Force refresh)" : ""}.
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 2. Progress + export */}
      {rows.length > 0 && (
        <section className="space-y-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p className="tabular-nums">
                <strong>
                  {counts.done} / {rows.length}
                </strong>{" "}
                <span className="text-zinc-500 dark:text-zinc-400">
                  · {counts.fetched} fetched · {counts.cached} cached · {counts.failed} failed
                </span>
              </p>
              <div className="flex gap-2">
                {running ? (
                  <Button onClick={() => (cancelRef.current = true)}>Stop</Button>
                ) : (
                  unfinished > 0 && <Button onClick={retryUnfinished}>Retry {unfinished} unfinished</Button>
                )}
              </div>
            </div>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="h-full rounded-full bg-zinc-900 transition-all dark:bg-zinc-100" style={{ width: `${progress}%` }} />
            </div>
            {waitNote && <p className="mt-2 text-xs text-zinc-500">{waitNote}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Download:</span>
            <Button onClick={() => void exportAs("xlsx")} disabled={running}>
              {loaded?.xlsx ? "Excel (your sheet, filled)" : "Excel"}
            </Button>
            <Button onClick={() => void exportAs("csv")} disabled={running}>CSV</Button>
            <Button onClick={() => void exportAs("pdf")} disabled={running}>PDF</Button>
            <Button onClick={() => void exportAs("sheets")} disabled={running}>Copy for Google Sheets</Button>
          </div>
          {notice && <p className="text-sm text-zinc-600 dark:text-zinc-300">{notice}</p>}

          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Post</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Views</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Likes</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Comments</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Shares</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Reposts</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Saves</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                {rows.map((r) => {
                  const s = r.status === "done" ? r.data.snapshot : null;
                  const name = r.status === "done" && r.data.post.owner_username ? `@${r.data.post.owner_username}` : r.shortcode;
                  const cell = (v: number | null | undefined, reason: Parameters<typeof nullReason>[0]) =>
                    s ? <NumberCell value={v ?? null} reason={nullReason(reason, s)} /> : <span className="text-zinc-300 dark:text-zinc-700">·</span>;
                  return (
                    <tr key={r.shortcode}>
                      <td className="px-3 py-2">
                        {r.status === "done" ? (
                          <Link href={`/posts/${r.shortcode}`} className="font-medium underline-offset-4 hover:underline">
                            {name}
                          </Link>
                        ) : (
                          <span className="font-mono text-xs">{name}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{cell(s?.play_count, "views")}</td>
                      <td className="px-3 py-2 text-right">{cell(s?.like_count, "likes")}</td>
                      <td className="px-3 py-2 text-right">{cell(s?.comment_count, "comments")}</td>
                      <td className="px-3 py-2 text-right">{cell(s?.reshare_count, "shares")}</td>
                      <td className="px-3 py-2 text-right">{cell(s?.repost_count, "reposts")}</td>
                      <td className="px-3 py-2 text-right">{cell(s?.save_count, "saves")}</td>
                      <td className="px-3 py-2">
                        <StatusBadge row={r} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
