import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type PdfCol = { label: string; weight: number; align?: "left" | "right" | "center" };
export type Business = { business_name: string; address?: string | null; phone?: string | null; email?: string | null; gst_number?: string | null };

const NAVY = rgb(0.043, 0.122, 0.2);
const GREY = rgb(0.36, 0.42, 0.5);
const LINE = rgb(0.85, 0.88, 0.92);

/** Standard PDF fonts only cover Latin-1: anything else (e.g. Gujarati, ₹) is replaced so rendering never throws. */
export function safe(s: unknown): string {
  return String(s ?? "").replace(/₹/g, "Rs.").replace(/[–—]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/·/g, "|").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

export class Pdf {
  private constructor(private doc: PDFDocument, private page: PDFPage, private font: PDFFont, private bold: PDFFont,
                      private w: number, private h: number, private m: number, public y: number, private footer: string) {}

  static async create(opts: { landscape?: boolean; footer?: string } = {}) {
    const doc = await PDFDocument.create();
    const [w, h] = opts.landscape ? [841.89, 595.28] : [595.28, 841.89];
    const page = doc.addPage([w, h]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    return new Pdf(doc, page, font, bold, w, h, 36, h - 36, opts.footer ?? "");
  }

  private newPage() {
    this.page = this.doc.addPage([this.w, this.h]);
    this.y = this.h - this.m;
  }
  private ensure(space: number) { if (this.y - space < this.m + 18) this.newPage(); }

  letterhead(b: Business, title: string) {
    this.page.drawText(safe(b.business_name), { x: this.m, y: this.y - 14, size: 16, font: this.bold, color: NAVY });
    const sub = [b.address, b.phone && `Ph: ${b.phone}`, b.email, b.gst_number && `GSTIN: ${b.gst_number}`].filter(Boolean).map(safe).join("  |  ");
    if (sub) this.page.drawText(sub.slice(0, 150), { x: this.m, y: this.y - 28, size: 8, font: this.font, color: GREY });
    const tw = this.bold.widthOfTextAtSize(safe(title).toUpperCase(), 13);
    this.page.drawText(safe(title).toUpperCase(), { x: this.w - this.m - tw, y: this.y - 14, size: 13, font: this.bold, color: NAVY });
    this.y -= 40;
    this.page.drawLine({ start: { x: this.m, y: this.y }, end: { x: this.w - this.m, y: this.y }, thickness: 1.2, color: NAVY });
    this.y -= 14;
  }

  kv(pairs: [string, string | null | undefined][], cols = 2) {
    const width = (this.w - 2 * this.m) / cols;
    const rows = Math.ceil(pairs.length / cols);
    this.ensure(rows * 14 + 8);
    pairs.forEach(([k, v], i) => {
      const r = Math.floor(i / cols), c = i % cols;
      const x = this.m + c * width, y = this.y - r * 14;
      this.page.drawText(safe(k), { x, y, size: 8, font: this.font, color: GREY });
      this.page.drawText(safe(v ?? "-").slice(0, 60), { x: x + 78, y, size: 9, font: this.bold, color: rgb(0.06, 0.1, 0.18) });
    });
    this.y -= rows * 14 + 8;
  }

  heading(text: string, size = 11) {
    this.ensure(26);
    this.page.drawText(safe(text), { x: this.m, y: this.y - size, size, font: this.bold, color: NAVY });
    this.y -= size + 8;
  }

  text(text: string, size = 9, opts: { bold?: boolean; color?: "grey" } = {}) {
    const lines = wrap(safe(text), (this.w - 2 * this.m), (s) => (opts.bold ? this.bold : this.font).widthOfTextAtSize(s, size));
    for (const l of lines) {
      this.ensure(size + 4);
      this.page.drawText(l, { x: this.m, y: this.y - size, size, font: opts.bold ? this.bold : this.font, color: opts.color === "grey" ? GREY : rgb(0.06, 0.1, 0.18) });
      this.y -= size + 3;
    }
  }

  table(cols: PdfCol[], rows: (string | number | null | undefined)[][], opts: { size?: number; boldLast?: boolean; boldRows?: Set<number> } = {}) {
    const size = opts.size ?? (cols.length > 9 ? 6.5 : cols.length > 6 ? 7.5 : 8.5);
    const total = cols.reduce((a, c) => a + c.weight, 0);
    const avail = this.w - 2 * this.m;
    const widths = cols.map((c) => (c.weight / total) * avail);
    const pad = 3;
    const cell = (txt: string, i: number, y: number, font: PDFFont) => {
      let t = safe(txt);
      const maxW = widths[i] - 2 * pad;
      while (t.length > 1 && font.widthOfTextAtSize(t, size) > maxW) t = t.slice(0, -1);
      if (t !== safe(txt) && t.length > 2) t = t.slice(0, -1) + ".";
      const tw = font.widthOfTextAtSize(t, size);
      const x0 = this.m + widths.slice(0, i).reduce((a, b) => a + b, 0);
      const x = cols[i].align === "right" ? x0 + widths[i] - pad - tw : cols[i].align === "center" ? x0 + (widths[i] - tw) / 2 : x0 + pad;
      this.page.drawText(t, { x, y, size, font, color: rgb(0.06, 0.1, 0.18) });
    };
    const header = () => {
      this.ensure(size + 12);
      this.page.drawRectangle({ x: this.m, y: this.y - size - 6, width: avail, height: size + 8, color: rgb(0.93, 0.95, 0.97) });
      cols.forEach((c, i) => cell(c.label, i, this.y - size - 2, this.bold));
      this.y -= size + 10;
    };
    header();
    rows.forEach((r, ri) => {
      if (this.y - size - 6 < this.m + 18) { this.newPage(); header(); }
      const strong = (opts.boldLast && ri === rows.length - 1) || opts.boldRows?.has(ri);
      r.forEach((v, i) => cell(v == null ? "" : String(v), i, this.y - size, strong ? this.bold : this.font));
      this.y -= size + 5;
      this.page.drawLine({ start: { x: this.m, y: this.y + 1.5 }, end: { x: this.m + avail, y: this.y + 1.5 }, thickness: 0.4, color: LINE });
    });
    this.y -= 8;
  }

  /** Right-aligned summary lines, e.g. subtotal / tax / total. */
  totals(rows: [string, string][]) {
    this.ensure(rows.length * 15 + 6);
    rows.forEach(([k, v], i) => {
      const last = i === rows.length - 1; const f = last ? this.bold : this.font; const s = last ? 11 : 9;
      const vw = f.widthOfTextAtSize(safe(v), s);
      this.page.drawText(safe(k), { x: this.w - this.m - 190, y: this.y - 10, size: s, font: f, color: GREY });
      this.page.drawText(safe(v), { x: this.w - this.m - vw, y: this.y - 10, size: s, font: f, color: NAVY });
      this.y -= 15;
    });
    this.y -= 6;
  }

  signatures(labels: string[]) {
    this.ensure(60);
    this.y -= 34;
    const w = (this.w - 2 * this.m) / labels.length;
    labels.forEach((l, i) => {
      const x = this.m + i * w + 8;
      this.page.drawLine({ start: { x, y: this.y }, end: { x: x + w - 36, y: this.y }, thickness: 0.6, color: GREY });
      this.page.drawText(safe(l), { x, y: this.y - 11, size: 8, font: this.font, color: GREY });
    });
    this.y -= 24;
  }

  async finish(): Promise<Uint8Array> {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      const t = safe(`${this.footer}${this.footer ? "   |   " : ""}Page ${i + 1} of ${pages.length}`);
      p.drawText(t, { x: this.m, y: 18, size: 7, font: this.font, color: GREY });
    });
    return this.doc.save();
  }
}

function wrap(text: string, maxW: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (measure(t) > maxW && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}

export const money = (n: number | string | null | undefined) =>
  "Rs. " + Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const num = (n: number | string | null | undefined, d = 3) => Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: d });
export const dmy = (d: string | null | undefined) => (d ? new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "-");

export function pdfResponse(bytes: Uint8Array, filename: string, inline = true) {
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename.replace(/[^\w.\-]+/g, "_")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
