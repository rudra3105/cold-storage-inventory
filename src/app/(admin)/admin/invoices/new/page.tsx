import { requirePermission } from "@/lib/auth/context";
import { loadMasters, qp, today, isUuid } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { InvoiceForm } from "@/components/forms/billing-forms";
import type { InvoiceValues } from "@/lib/schemas";

export const metadata = { title: "New invoice" };
export default async function NewInvoice({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("billing.manage");
  const sp = await searchParams; const party = qp(sp.party);
  const m = await loadMasters(); const supabase = await createClient();
  const { data: charges } = await supabase.from("charge_types").select("id,name,basis,default_rate").eq("is_active", true).order("name");
  const initial = { party_id: isUuid(party) ? party! : "", invoice_date: today(), due_date: "", period_from: "", period_to: "", notes: "",
    items: [{ description: "", charge_type_id: "", quantity: NaN, unit: "", rate: NaN, tax_percent: 0 }] } as InvoiceValues;
  return (<><PageHeader title="Make a bill" description="Save it first as a draft. Press Issue when it is correct." />
    <InvoiceForm id={null} initial={initial} parties={m.parties} charges={(charges ?? []).map((c) => ({ ...c, default_rate: c.default_rate == null ? null : Number(c.default_rate) }))} /></>);
}
