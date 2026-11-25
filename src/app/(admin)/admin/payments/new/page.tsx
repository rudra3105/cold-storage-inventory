import { requirePermission } from "@/lib/auth/context";
import { loadMasters, today } from "@/lib/data";
import { PageHeader } from "@/components/shell/page-header";
import { PaymentForm } from "@/components/forms/billing-forms";
import type { PaymentValues } from "@/lib/schemas";

export const metadata = { title: "New payment" };
export default async function NewPayment() {
  await requirePermission("billing.manage"); const m = await loadMasters();
  const initial = { party_id: "", payee_name: "", payment_date: today(), amount: NaN, payment_mode: "" as never, purpose: "", reference_no: "", remarks: "" } as PaymentValues;
  return (<><PageHeader title="Record money paid" description="Enter money you paid to someone." /><PaymentForm initial={initial} parties={m.parties} /></>);
}
