import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/context";
import { loadMasters, isUuid } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { InvoiceForm } from "@/components/forms/billing-forms";
import type { InvoiceValues } from "@/lib/schemas";

export const metadata = { title: "Edit draft invoice" };
export default async function EditInvoice({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("billing.manage");
  const { id } = await params; if (!isUuid(id)) notFound();
  const supabase = await createClient(); const m = await loadMasters({ includeInactive: true });
  const { data: inv } = await supabase.from("invoices").select("*, invoice_items(*)").eq("id", id).maybeSingle();
  if (!inv) notFound();
  if (inv.status !== "draft") redirect(`/admin/invoices/${id}`);
  const { data: charges } = await supabase.from("charge_types").select("id,name,basis,default_rate").eq("is_active", true).order("name");
  const items = [...(inv.invoice_items ?? [])].sort((a, b) => a.line_no - b.line_no);
  const initial = { party_id: inv.party_id, invoice_date: inv.invoice_date, due_date: inv.due_date ?? "", period_from: inv.period_from ?? "", period_to: inv.period_to ?? "", notes: inv.notes ?? "",
    items: items.map((i) => ({ description: i.description, charge_type_id: i.charge_type_id ?? "", quantity: Number(i.quantity), unit: i.unit ?? "", rate: Number(i.rate), tax_percent: Number(i.tax_percent) })) } as InvoiceValues;
  return (<><PageHeader title="Edit draft invoice" /><InvoiceForm id={id} initial={initial} parties={m.parties} charges={(charges ?? []).map((c) => ({ ...c, default_rate: c.default_rate == null ? null : Number(c.default_rate) }))} /></>);
}
