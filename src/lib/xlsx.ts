import "server-only";
import ExcelJS from "exceljs";

export type SheetCol = { label: string; key: string; align?: "left" | "right" | "center"; kind?: "text" | "number" | "money" | "date" };

/** CSV that Excel opens correctly (UTF-8 BOM) and that neutralises spreadsheet formula injection. */
export function toCsv(cols: SheetCol[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [cols.map((c) => esc(c.label)).join(","), ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(","))].join("\r\n");
}

export async function toXlsx(sheets: { name: string; title?: string; cols: SheetCol[]; rows: Record<string, unknown>[] }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Cold Storage Management";
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet");
    let startRow = 1;
    if (s.title) { ws.getCell("A1").value = s.title; ws.getCell("A1").font = { bold: true, size: 13 }; startRow = 3; }
    const header = ws.getRow(startRow);
    s.cols.forEach((c, i) => { const cell = header.getCell(i + 1); cell.value = c.label; cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B1F33" } }; cell.alignment = { horizontal: c.align ?? "left" }; });
    s.rows.forEach((r, ri) => {
      const row = ws.getRow(startRow + 1 + ri);
      s.cols.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        let v = r[c.key];
        if (typeof v === "string" && /^[=+\-@]/.test(v) && c.kind !== "number" && c.kind !== "money") v = "'" + v;
        if ((c.kind === "number" || c.kind === "money") && v !== null && v !== "" && v !== undefined && !Number.isNaN(Number(v))) { cell.value = Number(v); cell.numFmt = c.kind === "money" ? "#,##0.00" : "#,##0.###"; }
        else cell.value = v == null ? "" : (v as ExcelJS.CellValue);
        if (c.align) cell.alignment = { horizontal: c.align };
      });
    });
    s.cols.forEach((c, i) => { const col = ws.getColumn(i + 1); col.width = Math.min(40, Math.max(c.label.length + 2, ...s.rows.slice(0, 200).map((r) => String(r[c.key] ?? "").length + 2))); });
    ws.views = [{ state: "frozen", ySplit: startRow }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
