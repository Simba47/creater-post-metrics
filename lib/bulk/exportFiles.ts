// Excel and PDF builders. The libraries are imported on demand so they only load when a user exports.
import { formatNumber } from "@/lib/format";
import { cellText, COLUMNS, type Column, type ExportRow } from "./export";

const XLSX_NUM_FMT: Partial<Record<Column["kind"], string>> = {
  int: "#,##0",
  percent: "0.00%",
  date: "yyyy-mm-dd",
  datetime: "yyyy-mm-dd hh:mm",
};

export async function buildXlsx(rows: ExportRow[]): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet("Metrics", { views: [{ state: "frozen", ySplit: 1 }] });

  ws.columns = COLUMNS.map((c) => {
    const numFmt = XLSX_NUM_FMT[c.kind];
    return { header: c.header, key: c.key, width: c.width, ...(numFmt ? { style: { numFmt } } : {}) };
  });

  for (const row of rows) {
    const added = ws.addRow(Object.fromEntries(COLUMNS.map((c) => [c.key, row[c.key] ?? null])));
    COLUMNS.forEach((c, i) => {
      const value = row[c.key];
      if (c.kind === "url" && typeof value === "string") {
        added.getCell(i + 1).value = { text: value, hyperlink: value };
        added.getCell(i + 1).font = { color: { argb: "FF2A78D6" }, underline: true };
      }
    });
  }

  const header = ws.getRow(1);
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F4F5" } };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };

  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

// The PDF is a readable summary: long text columns (URLs, caption, error) are left out.
const PDF_KEYS: Array<keyof ExportRow> = [
  "username",
  "type",
  "posted",
  "views",
  "likes",
  "comments",
  "shares",
  "reposts",
  "saves",
  "engagement_rate",
  "status",
];

export async function buildPdf(rows: ExportRow[], generatedAt = new Date()): Promise<ArrayBuffer> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const cols = PDF_KEYS.map((k) => COLUMNS.find((c) => c.key === k)!);

  const fetched = rows.filter((r) => r.status !== "error" && r.status !== "pending").length;
  doc.setFontSize(16);
  doc.text("Instagram post metrics", 40, 44);
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(
    `Generated ${generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC · ${rows.length} posts · ${fetched} fetched · "-" = not available`,
    40,
    60,
  );

  const body = rows.map((row) =>
    cols.map((c) => {
      const v = row[c.key];
      // Failed rows have no username; identify them by shortcode and say why they failed.
      if (c.key === "username") return v === null ? row.post_url.replace("https://www.instagram.com", "") : `@${v as string}`;
      if (c.key === "status" && row.error) return `failed: ${row.error}`;
      if (v === null) return "-";
      if (c.kind === "int") return formatNumber(v as number);
      return cellText(row, c);
    }),
  );

  autoTable(doc, {
    startY: 72,
    head: [cols.map((c) => c.header.replace(" (UTC)", ""))],
    body,
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [39, 39, 42], textColor: 255 },
    alternateRowStyles: { fillColor: [244, 244, 245] },
    columnStyles: Object.fromEntries(
      cols.map((c, i) => [i, c.kind === "int" || c.kind === "percent" ? { halign: "right" as const } : {}]),
    ),
    // Right-align numeric headers to match their values.
    didParseCell: (data) => {
      const col = cols[data.column.index];
      if (data.section === "head" && col && (col.kind === "int" || col.kind === "percent")) data.cell.styles.halign = "right";
    },
    // Link each username cell to its post.
    didDrawCell: (data) => {
      if (data.section === "body" && data.column.index === 0) {
        const row = rows[data.row.index];
        if (row) doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url: row.post_url });
      }
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
