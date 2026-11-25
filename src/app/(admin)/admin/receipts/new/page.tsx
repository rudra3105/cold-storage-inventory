import { requirePermission } from "@/lib/auth/context";
import { isUuid, loadMasters, qp, today } from "@/lib/data";
import { PageHeader } from "@/components/shell/page-header";
import { ReceiptForm } from "@/components/forms/billing-forms";
import type { ReceiptValues } from "@/lib/schemas";

export const metadata = { title: "New receipt" };
export default async function NewReceipt({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("billing.manage");
  const party = qp((await searchParams).party); const m = await loadMasters();
  const initial = { party_id: isUuid(party) ? party! : "", receipt_date: today(), amount: NaN, payment_mode: "" as never, reference_no: "", remarks: "", allocations: [] } as ReceiptValues;
  return (<><PageHeader title="Record money received" description="Enter what the customer paid. You can match it to their pending bills." /><ReceiptForm initial={initial} parties={m.parties} /></>);
}
