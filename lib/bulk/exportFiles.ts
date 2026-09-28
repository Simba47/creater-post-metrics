// Excel and PDF builders for the campaign report. Libraries load on demand (only when exporting).
import type { Style, Worksheet } from "exceljs";
import { formatNumber } from "@/lib/format";
import {
  displayCell,
  kindsByColumn,
  rectangle,
  type FilledReport,
  type MetricDef,
  type ReportLayout,
} from "./report";

const NUM_FMT: Record<MetricDef["kind"], string> = {
  int: "#,##0",
  percent: "0.00%",
  date: "dd/mm/yyyy",
};

const YELLOW = "FFFFFF00";
const THIN = { style: "thin" as const, color: { argb: "FF000000" } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

function copyStyle(style: Partial<Style>): Partial<Style> {
  return JSON.parse(JSON.stringify(style ?? {})) as Partial<Style>;
}

const isEmptyStyle = (s: Partial<Style> | undefined) => !s || Object.keys(s).length === 0;

/**
 * Fills the user's own workbook in place: only the metric cells, added headers and the totals row
 * change, so their colours, borders, widths and other columns are kept.
 */
export async function fillWorkbook(
  buffer: ArrayBuffer,
  sheetName: string,
  filled: FilledReport,
  layout: ReportLayout,
): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error(`Sheet "${sheetName}" not found`);

  // Keep worksheet rows aligned with grid rows (1-based vs 0-based).
  if (layout.insertedHeader) ws.spliceRows(1, 0, []);
  if (filled.insertedTotalsRow) ws.spliceRows(filled.totalsRow + 1, 0, []);
  if (layout.insertedHeader) {
    ws.getCell(layout.headerRow + 1, layout.linkCol + 1).value = "POSTED LINK";
  }

  const lastOriginalCol = ws.columnCount;
  for (const { row, col, kind } of filled.written) {
    const cell = ws.getCell(row + 1, col + 1);
    const left = col > 0 ? ws.getCell(row + 1, col) : null;
    // New cells (added columns / new totals row) borrow the look of the cell to their left.
    // Always assign a copy: exceljs cells in a row can share one style object, so mutating
    // numFmt/font in place would change every cell in the row.
    cell.style = copyStyle(isEmptyStyle(cell.style) && left && !isEmptyStyle(left.style) ? left.style : cell.style);
    cell.value = filled.grid[row]?.[col] ?? null;
    if (kind !== "header") cell.numFmt = NUM_FMT[kind];
    if (row === filled.totalsRow) cell.font = { ...(cell.font ?? {}), bold: true };
  }

  // Added columns get the width of the last original column.
  const lastWidth = ws.getColumn(lastOriginalCol).width ?? 12;
  for (const key of layout.addedMetrics) {
    const column = ws.getColumn(layout.metricCols[key] + 1);
    if (!column.width) column.width = lastWidth;
  }

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

function autoWidths(ws: Worksheet, grid: string[][]): void {
  const w = grid[0]?.length ?? 0;
  for (let c = 0; c < w; c++) {
    const longest = Math.max(...grid.map((r) => (r[c] ?? "").length));
    ws.getColumn(c + 1).width = Math.min(Math.max(longest + 2, 10), 50);
  }
}

/** A new workbook in the campaign-report style (yellow bold header, borders, totals row). */
export async function buildStyledWorkbook(filled: FilledReport, layout: ReportLayout): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet("Report", { views: [{ state: "frozen", ySplit: layout.headerRow + 1 }] });
  const kinds = kindsByColumn(layout);
  const grid = rectangle(filled.grid);

  grid.forEach((r, ri) => {
    const row = ws.getRow(ri + 1);
    r.forEach((v, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = v;
      const kind = kinds.get(ci);
      const inTable = ri >= layout.headerRow && ri <= filled.totalsRow;
      if (!inTable) return;
      cell.border = BORDER;
      if (ri === layout.headerRow) {
        cell.font = { bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: YELLOW } };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        return;
      }
      if (kind) {
        cell.numFmt = NUM_FMT[kind];
        cell.alignment = { horizontal: "center" };
      }
      if (typeof v === "string" && /^https?:\/\//.test(v)) {
        cell.value = { text: v, hyperlink: v };
        cell.font = { color: { argb: "FF0563C1" }, underline: true };
      }
      if (ri === filled.totalsRow) cell.font = { bold: true };
    });
  });

  autoWidths(ws, grid.map((r) => r.map((v, c) => displayCell(v, kinds.get(c)))));
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

/** PDF of the report table (header row → totals row) in landscape. */
export async function buildPdf(filled: FilledReport, layout: ReportLayout, generatedAt = new Date()): Promise<ArrayBuffer> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const kinds = kindsByColumn(layout);
  const table = rectangle(filled.grid).slice(layout.headerRow, filled.totalsRow + 1);
  const [head, ...body] = table;

  doc.setFontSize(14);
  doc.text("Campaign report", 30, 36);
  doc.setFontSize(8);
  doc.setTextColor(110);
  doc.text(`Generated ${generatedAt.toLocaleString("en-GB")} · ${layout.dataRows.length} posts`, 30, 50);

  const text = (v: (typeof table)[number][number], c: number) => {
    const kind = kinds.get(c);
    // Counts, and plain numbers in the user's own columns (e.g. AVG. REACH), get thousands separators.
    if (typeof v === "number" && (kind === "int" || (!kind && Number.isInteger(v)))) return formatNumber(v);
    return displayCell(v, kind);
  };

  autoTable(doc, {
    startY: 60,
    margin: { left: 30, right: 30 },
    head: [(head ?? []).map((v, c) => text(v, c))],
    body: body.map((r) => r.map((v, c) => text(v, c))),
    styles: { fontSize: 7, cellPadding: 3, lineColor: [0, 0, 0], lineWidth: 0.5, textColor: [0, 0, 0], overflow: "linebreak" },
    headStyles: { fillColor: [255, 255, 0], textColor: [0, 0, 0], fontStyle: "bold", halign: "center" },
    columnStyles: Object.fromEntries([...kinds.keys()].map((c) => [c, { halign: "center" as const }])),
    didParseCell: (data) => {
      if (data.section === "body" && data.row.index === body.length - 1) data.cell.styles.fontStyle = "bold";
    },
  });

  return doc.output("arraybuffer");
}

export function downloadBlob(data: BlobPart, type: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
