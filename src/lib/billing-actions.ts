"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionContext, callRpc, fail, friendlyError, ok, type ActionResult } from "@/lib/action-utils";
import { invoiceSchema, paymentSchema, receiptSchema, type InvoiceValues, type PaymentValues, type ReceiptValues } from "@/lib/schemas";

const blank = (s: string | undefined | null) => (s && s.trim() ? s.trim() : null);

export async function saveInvoiceAction(id: string | null, values: InvoiceValues): Promise<ActionResult<{ id: string }>> {
  const p = invoiceSchema.safeParse(values);
  if (!p.success) return fail(p.error.issues[0].message);
  const v = p.data;
  const r = await callRpc<{ id: string }>("billing.manage", "save_invoice", {
    p_id: id,
    p_header: { party_id: v.party_id, invoice_date: v.invoice_date, due_date: blank(v.due_date), period_from: blank(v.period_from), period_to: blank(v.period_to), notes: blank(v.notes) },
    p_items: v.items.map((i) => ({ description: i.description, charge_type_id: blank(i.charge_type_id), quantity: i.quantity, unit: blank(i.unit), rate: i.rate, tax_percent: i.tax_percent })),
  });
  if (r.ok) { revalidatePath("/admin/invoices"); revalidatePath(`/admin/invoices/${r.data.id}`); }
  return r;
}
export async function issueInvoiceAction(id: string) {
  const r = await callRpc<{ invoice_no: string }>("billing.manage", "issue_invoice", { p_id: id });
  if (r.ok) { revalidatePath("/admin/invoices"); revalidatePath(`/admin/invoices/${id}`); }
  return r;
}
export async function cancelInvoiceAction(id: string, reason: string) {
  const r = await callRpc("billing.manage", "cancel_invoice", { p_id: id, p_reason: reason });
  if (r.ok) { revalidatePath("/admin/invoices"); revalidatePath(`/admin/invoices/${id}`); }
  return r;
}

export async function createReceiptAction(values: ReceiptValues): Promise<ActionResult<{ id: string; receipt_no: string }>> {
  const p = receiptSchema.safeParse(values);
  if (!p.success) return fail(p.error.issues[0].message);
  const v = p.data;
  const allocations = v.allocations.filter((a) => a.invoice_id && a.amount > 0);
  const r = await callRpc<{ id: string; receipt_no: string }>("billing.manage", "create_receipt", {
    p_header: { party_id: v.party_id, receipt_date: v.receipt_date, amount: v.amount, payment_mode: v.payment_mode, reference_no: blank(v.reference_no), remarks: blank(v.remarks) },
    p_allocations: allocations,
  });
  if (r.ok) { revalidatePath("/admin/receipts"); revalidatePath("/admin/invoices"); }
  return r;
}
export async function cancelReceiptAction(id: string, reason: string) {
  const r = await callRpc("billing.manage", "cancel_receipt", { p_id: id, p_reason: reason });
  if (r.ok) { revalidatePath("/admin/receipts"); revalidatePath(`/admin/receipts/${id}`); revalidatePath("/admin/invoices"); }
  return r;
}

export async function createPaymentAction(values: PaymentValues): Promise<ActionResult<{ id: string; payment_no: string }>> {
  const p = paymentSchema.safeParse(values);
  if (!p.success) return fail(p.error.issues[0].message);
  const v = p.data;
  const r = await callRpc<{ id: string; payment_no: string }>("billing.manage", "create_payment", {
    p_header: { party_id: blank(v.party_id), payee_name: blank(v.payee_name), payment_date: v.payment_date, amount: v.amount, payment_mode: v.payment_mode, purpose: blank(v.purpose), reference_no: blank(v.reference_no), remarks: blank(v.remarks) },
  });
  if (r.ok) revalidatePath("/admin/payments");
  return r;
}
export async function cancelPaymentAction(id: string, reason: string) {
  const r = await callRpc("billing.manage", "cancel_payment", { p_id: id, p_reason: reason });
  if (r.ok) { revalidatePath("/admin/payments"); revalidatePath(`/admin/payments/${id}`); }
  return r;
}

export type OutstandingInvoice = { id: string; invoice_no: string; invoice_date: string; total: number; outstanding: number };
export async function getOutstandingInvoices(partyId: string): Promise<ActionResult<OutstandingInvoice[]>> {
  const a = await actionContext("billing.view");
  if ("error" in a) return fail(a.error);
  const { data, error } = await a.supabase.from("invoice_balances").select("invoice_id,invoice_no,invoice_date,total,outstanding").eq("party_id", partyId).eq("status", "issued").gt("outstanding", 0).order("invoice_date");
  if (error) return fail(error.message);
  return ok((data ?? []).map((d) => ({ id: d.invoice_id, invoice_no: d.invoice_no, invoice_date: d.invoice_date, total: Number(d.total), outstanding: Number(d.outstanding) })));
}

/** Suggested rate for a party + charge type: latest effective party rate, else the charge's default. */
export async function suggestRate(partyId: string, chargeTypeId: string, onDate: string): Promise<ActionResult<{ rate: number | null; name: string; basis: string }>> {
  const a = await actionContext("billing.view");
  if ("error" in a) return fail(a.error);
  const [{ data: ct }, { data: pr }] = await Promise.all([
    a.supabase.from("charge_types").select("name,basis,default_rate").eq("id", chargeTypeId).maybeSingle(),
    a.supabase.from("party_rates").select("rate,effective_from,effective_to").eq("party_id", partyId).eq("charge_type_id", chargeTypeId).is("product_id", null).lte("effective_from", onDate).order("effective_from", { ascending: false }).limit(5),
  ]);
  if (!ct) return fail("Charge type not found");
  const live = (pr ?? []).find((r) => !r.effective_to || r.effective_to >= onDate);
  return ok({ rate: live ? Number(live.rate) : ct.default_rate == null ? null : Number(ct.default_rate), name: ct.name, basis: ct.basis });
}

const chargeSchema = z.object({ code: z.string().trim().toUpperCase().min(2).max(20), name: z.string().trim().min(2).max(80),
  basis: z.enum(["manual", "flat", "per_bag", "per_kg", "per_bag_per_day", "per_kg_per_day", "per_bag_per_month", "per_kg_per_month"]), default_rate: z.number().min(0).nullable() });
export async function saveChargeType(id: string | null, v: z.infer<typeof chargeSchema>): Promise<ActionResult<unknown>> {
  const a = await actionContext("billing.manage");
  if ("error" in a) return fail(a.error);
  const p = chargeSchema.safeParse(v);
  if (!p.success) return fail(p.error.issues[0].message);
  const q = id ? a.supabase.from("charge_types").update(p.data).eq("id", id) : a.supabase.from("charge_types").insert(p.data);
  const { error } = await q;
  if (error) return fail(friendlyError(error));
  revalidatePath("/admin/rates"); return ok({});
}
export async function setChargeActive(id: string, active: boolean): Promise<ActionResult<unknown>> {
  const a = await actionContext("billing.manage");
  if ("error" in a) return fail(a.error);
  const { error } = await a.supabase.from("charge_types").update({ is_active: active }).eq("id", id);
  if (error) return fail(friendlyError(error)); revalidatePath("/admin/rates"); return ok({});
}
const rateSchema = z.object({ party_id: z.uuid(), charge_type_id: z.uuid(), rate: z.number().min(0), effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), notes: z.string().max(200).nullable() });
export async function addPartyRate(v: z.infer<typeof rateSchema>): Promise<ActionResult<unknown>> {
  const a = await actionContext("billing.manage");
  if ("error" in a) return fail(a.error);
  const p = rateSchema.safeParse(v);
  if (!p.success) return fail("Choose a party, charge and a valid rate / dates.");
  const { error } = await a.supabase.from("party_rates").insert(p.data);
  if (error) return fail(friendlyError(error)); revalidatePath("/admin/rates"); return ok({});
}
export async function endPartyRate(id: string, endDate: string): Promise<ActionResult<unknown>> {
  const a = await actionContext("billing.manage");
  if ("error" in a) return fail(a.error);
  const { error } = await a.supabase.from("party_rates").update({ effective_to: endDate }).eq("id", id);
  if (error) return fail(friendlyError(error)); revalidatePath("/admin/rates"); return ok({});
}
