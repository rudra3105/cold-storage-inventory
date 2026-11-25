import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { runReport } from "@/lib/reports/run";
import { formatCell, type Col } from "@/lib/reports/engine";
import { Pdf, pdfResponse } from "@/lib/pdf";
import { toCsv, toXlsx, type SheetCol } from "@/lib/xlsx";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const sheetCol = (c: Col): SheetCol => ({ label: c.label, key: c.key, align: c.align, kind: c.kind });

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { slug } = await params;
  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "pdf";
  if (!["pdf", "xlsx", "csv"].includes(format)) return NextResponse.json({ error: "Unknown format" }, { status: 400 });
  const sp = Object.fromEntries(url.searchParams.entries());
  const out = await runReport(slug, sp, ctx);
  if (out.status === "missing") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (out.status === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (out.status !== "ok") return NextResponse.json({ error: "Select a party and a valid date range" }, { status: 400 });

  const { def, f, result } = out;
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${def.slug}-${stamp}`;
  const withTotals = (s: (typeof result.sections)[number]) => (s.totals ? [...s.rows, { ...s.totals, __total: 1 }] : s.rows);

  if (format === "csv") {
    const text = result.sections.map((s, i) => (i ? "\r\n" : "") + (s.title ? s.title + "\r\n" : "") + toCsv(s.cols.map(sheetCol), withTotals(s)).replace(/^﻿/, "")).join("\r\n");
    return new Response("﻿" + text, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"`, "Cache-Control": "private, no-store" } });
  }
  if (format === "xlsx") {
    const buf = await toXlsx(result.sections.map((s, i) => ({ name: s.title ?? (i ? `Sheet ${i + 1}` : def.title), title: `${def.title}  (${f.from} to ${f.to})`, cols: s.cols.map(sheetCol), rows: withTotals(s) })));
    return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}.xlsx"`, "Cache-Control": "private, no-store" } });
  }

  const supabase = await createClient();
  const { data: biz } = await supabase.from("business_settings").select("business_name,address,phone,email,gst_number").maybeSingle();
  const pdf = await Pdf.create({ landscape: true, footer: `${def.title} | generated ${new Date().toLocaleString("en-IN")}` });
  pdf.letterhead(biz ?? { business_name: "Cold Storage" }, def.title);
  const range = def.filters.includes("date") ? `Date: ${f.date}` : def.filters.includes("from") ? `Period: ${f.from === "2000-01-01" ? "all time" : f.from} to ${f.to}` : "";
  if (range) pdf.text(range, 9, { color: "grey" });
  if (result.note) pdf.text(result.note, 8, { color: "grey" });
  for (const s of result.sections) {
    if (s.title) pdf.heading(s.title, 10);
    const rows = withTotals(s).map((r) => s.cols.map((c) => formatCell(r[c.key], c.kind).replace("₹", "Rs.")));
    pdf.table(s.cols.map((c) => ({ label: c.label, weight: c.weight ?? (c.kind ? 1 : 1.5), align: c.align })), rows, { boldLast: !!s.totals });
  }
  return pdfResponse(await pdf.finish(), `${base}.pdf`);
}
