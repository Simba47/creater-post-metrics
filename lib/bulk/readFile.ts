// Reads an uploaded spreadsheet into plain text for extractInstagramUrls. Runs in the browser.

export const ACCEPTED_FILE_TYPES = ".xlsx,.csv,.txt";
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export class FileReadError extends Error {}

/** Returns every cell's text (and any hyperlink target) from every sheet, one per line. */
export async function readSpreadsheetText(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new FileReadError("That file is over 10 MB.");
  const name = file.name.toLowerCase();

  if (name.endsWith(".csv") || name.endsWith(".txt")) return file.text();

  if (name.endsWith(".xls")) {
    throw new FileReadError("Old .xls files aren't supported. In Excel choose File → Save As → .xlsx, then upload that.");
  }
  if (!name.endsWith(".xlsx")) {
    throw new FileReadError("Upload an Excel (.xlsx) or CSV file.");
  }

  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new FileReadError("Couldn't read that Excel file. Is it a valid .xlsx?");
  }

  const parts: string[] = [];
  wb.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        parts.push(cell.text);
        // A cell showing "Post 1" can still link to the real URL.
        const link = cell.hyperlink ?? (typeof cell.value === "object" && cell.value && "hyperlink" in cell.value ? cell.value.hyperlink : undefined);
        if (typeof link === "string") parts.push(link);
      });
    });
  });
  return parts.join("\n");
}
