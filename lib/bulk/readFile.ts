// Loads an uploaded spreadsheet as a grid. Runs in the browser.
import type { CellValue, Worksheet } from "exceljs";
import { parseCsv } from "./csv";
import { analyzeSheet, type Cell, type Grid } from "./report";

export const ACCEPTED_FILE_TYPES = ".xlsx,.csv,.txt";
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export class FileReadError extends Error {}

export interface SheetSource {
  grid: Grid;
  /** Set for .xlsx uploads so the download can be the user's own workbook, filled in place. */
  xlsx: { buffer: ArrayBuffer; sheetName: string } | null;
  /** Every tab of an .xlsx upload, so the user can switch away from the auto-picked one. */
  tabs?: SheetTab[];
}

export interface SheetTab {
  name: string;
  grid: Grid;
  posts: number;
}

function toCell(v: CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (v instanceof Date) return v;
  if (typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    // A cell showing "Post 1" can still link to the real URL; prefer the link target.
    if ("hyperlink" in v && typeof v.hyperlink === "string") return v.hyperlink;
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return toCell((v.result ?? null) as CellValue);
    if ("text" in v && typeof v.text === "string") return v.text;
  }
  return null;
}

/** Row/column 1-based in Excel → 0-based grid. Empty rows are kept so indexes line up. */
export function worksheetToGrid(ws: Worksheet): Grid {
  const grid: Grid = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: Cell[] = [];
    for (let c = 1; c <= ws.columnCount; c++) cells.push(toCell(row.getCell(c).value));
    grid.push(cells);
  }
  return grid;
}

export async function readSheetSource(file: File): Promise<SheetSource> {
  if (file.size > MAX_FILE_BYTES) throw new FileReadError("That file is over 10 MB.");
  const name = file.name.toLowerCase();

  if (name.endsWith(".csv") || name.endsWith(".txt")) return { grid: parseCsv(await file.text()), xlsx: null };
  if (name.endsWith(".xls")) {
    throw new FileReadError("Old .xls files aren't supported. In Excel choose File → Save As → .xlsx, then upload that.");
  }
  if (!name.endsWith(".xlsx")) throw new FileReadError("Upload an Excel (.xlsx) or CSV file.");

  const buffer = await file.arrayBuffer();
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new FileReadError("Couldn't read that Excel file. Is it a valid .xlsx?");
  }

  const tabs: SheetTab[] = [];
  wb.eachSheet((ws) => {
    const grid = worksheetToGrid(ws);
    const analysis = analyzeSheet(grid);
    tabs.push({ name: ws.name, grid, posts: analysis.ok ? analysis.layout.dataRows.length : 0 });
  });
  if (tabs.length === 0) throw new FileReadError("That workbook has no sheets.");
  // Default to the tab with the most post links.
  const chosen = tabs.reduce((best, t) => (t.posts > best.posts ? t : best));
  return { grid: chosen.grid, xlsx: { buffer, sheetName: chosen.name }, tabs };
}
