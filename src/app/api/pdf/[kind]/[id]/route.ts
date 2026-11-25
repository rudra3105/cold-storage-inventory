import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isUuid, one } from "@/lib/data";
import { Pdf, dmy, money, num, pdfResponse, type Business } from "@/lib/pdf";

export const dynamic = "force-dynamic";

/** Printable documents. Uses the caller's own session, so RLS decides what can be rendered (customers: own documents only). */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = await createClient();
  const { data: biz } = await supabase.from("business_settings").select("business_name,address,phone,email,gst_number,invoice_terms").maybeSingle();
  const business: Business & { invoice_terms?: string | null } = biz ?? { business_name: "Cold Storage" };
  const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

  if (kind === "inward" || kind === "outward") {
    const { data: lines } = await supabase.from(kind === "inward" ? "v_inward_lines" : "v_outward_lines").select("*").eq("doc_id", id).order("line_no");
    const h = lines?.[0];
    if (!h) return notFound();
    const pdf = await Pdf.create({ landscape: true, footer: `${h.doc_no}` });
    pdf.letterhead(business, kind === "inward" ? "Inward Receipt" : "Outward Receipt");
    pdf.kv([
      [kind === "inward" ? "Inward No." : "Outward No.", h.doc_no], ["Date", dmy(h.doc_date)], ["Party", h.party_name], ["Vehicle No.", h.vehicle_no],
      ...(kind === "inward" ? [["WB Kgs", h.wb_kgs == null ? "-" : num(h.wb_kgs)] as [string, string]] : []), ["Status", String(h.status).toUpperCase()],
    ], 3);
    const rows = lines!.map((l) => [l.line_no, l.product_name, l.chamber_code, l.floor_no, l.rack_code, num(l.bags, 0), num(l.kgs_per_bag), num(l.total_kgs), num(l.wages_party, 2), num(l.wages_labour, 2)]);
    pdf.table([
      { label: "#", weight: 3 }, { label: "Product", weight: 16 }, { label: "Chamber", weight: 7 }, { label: "Floor", weight: 5 }, { label: "Rack", weight: 7 },
      { label: "Bags", weight: 7, align: "right" }, { label: "Kgs / Bag", weight: 8, align: "right" }, { label: "Total Kgs", weight: 10, align: "right" },
      { label: "Wages / Party", weight: 9, align: "right" }, { label: "Wages / Labour", weight: 9, align: "right" },
    ], rows, { size: 9 });
    pdf.totals([["Total bags", num(lines!.reduce((a, l) => a + Number(l.bags), 0), 0)], ["Total kgs", num(lines!.reduce((a, l) => a + Number(l.total_kgs), 0))]]);
    if (h.doc_remarks) pdf.text(`Remarks: ${h.doc_remarks}`, 9);
    if (h.status === "cancelled") pdf.text(`CANCELLED: ${h.cancel_reason ?? ""}`, 10, { bold: true });
    pdf.signatures(kind === "inward" ? ["Received by", "Driver / Party"] : ["Dispatched by", "Received by (Driver / Party)"]);
    return pdfResponse(await pdf.finish(), `${h.doc_no}.pdf`);
  }

  if (kind === "invoice") {
    const [{ data: inv }, { data: items }, { data: bal }] = await Promise.all([
      supabase.from("invoices").select("*,parties(name,address,city,state,gst_number,mobile)").eq("id", id).maybeSingle(),
      supabase.from("invoice_items").select("*").eq("invoice_id", id).order("line_no"),
      supabase.from("invoice_balances").select("*").eq("invoice_id", id).maybeSingle(),
    ]);
    if (!inv || !bal) return notFound();
    const party = one(inv.parties as { name: string; address: string | null; city: string | null; state: string | null; gst_number: string | null; mobile: string | null } | null);
    const pdf = await Pdf.create({ footer: inv.invoice_no ?? "DRAFT" });
    pdf.letterhead(business, "Invoice");
    pdf.kv([
      ["Invoice No.", inv.invoice_no ?? "DRAFT"], ["Invoice date", dmy(inv.invoice_date)], ["Due date", dmy(inv.due_date)],
      ["Period", inv.period_from ? `${dmy(inv.period_from)} - ${dmy(inv.period_to)}` : "-"], ["Status", bal.payment_status.toUpperCase()],
    ], 2);
    pdf.heading("Bill to");
    pdf.text([party?.name, party?.address, [party?.city, party?.state].filter(Boolean).join(", "), party?.gst_number && `GSTIN: ${party.gst_number}`, party?.mobile && `Mobile: ${party.mobile}`].filter(Boolean).join("\n"), 9);
    pdf.y -= 8;
    pdf.table([
      { label: "#", weight: 3 }, { label: "Description", weight: 30 }, { label: "Qty", weight: 8, align: "right" }, { label: "Rate", weight: 9, align: "right" },
      { label: "Amount", weight: 11, align: "right" }, { label: "Tax %", weight: 6, align: "right" }, { label: "Tax", weight: 9, align: "right" },
    ], (items ?? []).map((i) => [i.line_no, i.description, `${num(i.quantity)}${i.unit ? " " + i.unit : ""}`, num(i.rate, 2), num(i.amount, 2), num(i.tax_percent, 2), num(i.tax_amount, 2)]));
    pdf.totals([["Subtotal", money(bal.subtotal)], ["Tax", money(bal.tax_total)], ["Total", money(bal.total)], ...(Number(bal.paid) > 0 ? [["Paid", money(bal.paid)], ["Balance due", money(bal.outstanding)]] as [string, string][] : [])]);
    if (inv.status === "cancelled") pdf.text(`CANCELLED: ${inv.cancel_reason ?? ""}`, 10, { bold: true });
    if (inv.notes) pdf.text(`Notes: ${inv.notes}`, 9);
    if (business.invoice_terms) { pdf.heading("Terms", 9); pdf.text(business.invoice_terms, 8, { color: "grey" }); }
    pdf.signatures(["Authorised signatory"]);
    return pdfResponse(await pdf.finish(), `${inv.invoice_no ?? "draft-invoice"}.pdf`);
  }

  if (kind === "receipt") {
    const [{ data: r }, { data: allocs }] = await Promise.all([
      supabase.from("receipts").select("*,parties(name)").eq("id", id).maybeSingle(),
      supabase.from("receipt_allocations").select("amount,invoices(invoice_no)").eq("receipt_id", id),
    ]);
    if (!r) return notFound();
    const pdf = await Pdf.create({ footer: r.receipt_no });
    pdf.letterhead(business, "Receipt");
    pdf.kv([["Receipt No.", r.receipt_no], ["Date", dmy(r.receipt_date)], ["Received from", one(r.parties as { name: string } | null)?.name], ["Mode", r.payment_mode.replace("_", " ")],
      ["Reference", r.reference_no], ["Status", String(r.status).toUpperCase()]], 2);
    pdf.totals([["Amount received", money(r.amount)]]);
    if ((allocs ?? []).length) { pdf.heading("Applied to invoices"); pdf.table([{ label: "Invoice", weight: 3 }, { label: "Amount", weight: 2, align: "right" }], (allocs ?? []).map((a) => [one(a.invoices as unknown as { invoice_no: string } | { invoice_no: string }[] | null)?.invoice_no, money(a.amount)])); }
    if (r.remarks) pdf.text(`Remarks: ${r.remarks}`, 9);
    if (r.status === "cancelled") pdf.text(`CANCELLED: ${r.cancel_reason ?? ""}`, 10, { bold: true });
    pdf.signatures(["Received by", "Authorised signatory"]);
    return pdfResponse(await pdf.finish(), `${r.receipt_no}.pdf`);
  }

  if (kind === "payment") {
    const { data: p } = await supabase.from("payments").select("*").eq("id", id).maybeSingle();
    if (!p) return notFound();
    const pdf = await Pdf.create({ footer: p.payment_no });
    pdf.letterhead(business, "Payment Voucher");
    pdf.kv([["Payment No.", p.payment_no], ["Date", dmy(p.payment_date)], ["Paid to", p.payee_name], ["Mode", p.payment_mode.replace("_", " ")], ["Purpose", p.purpose], ["Reference", p.reference_no], ["Status", String(p.status).toUpperCase()]], 2);
    pdf.totals([["Amount paid", money(p.amount)]]);
    if (p.remarks) pdf.text(`Remarks: ${p.remarks}`, 9);
    pdf.signatures(["Paid by", "Received by"]);
    return pdfResponse(await pdf.finish(), `${p.payment_no}.pdf`);
  }
  return notFound();
}
