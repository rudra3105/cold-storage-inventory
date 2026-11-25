import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { requirePermission } from "@/lib/auth/context";
import { isUuid, one } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { cancelReceiptAction } from "@/lib/billing-actions";
import { PageHeader } from "@/components/shell/page-header";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { fmtDate, fmtMoney } from "@/lib/utils";

export const metadata = { title: "Receipt" };
export default async function ReceiptDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("billing.view");
  const { id } = await params; if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: r } = await supabase.from("receipts").select("*, parties(name), receipt_allocations(amount, invoices(id,invoice_no))").eq("id", id).maybeSingle();
  if (!r) notFound();
  const party = one(r.parties as { name: string } | { name: string }[] | null);
  type Inv = { id: string; invoice_no: string };
  return (<>
    <PageHeader title={r.receipt_no} description={party?.name} actions={<><Button asChild variant="outline"><a href={`/api/pdf/receipt/${id}`} target="_blank" rel="noopener"><Printer /> Print / PDF</a></Button>
      {ctx.can("billing.manage") && r.status === "active" && <ConfirmAction label="Cancel receipt" askReason confirmText="Cancel this receipt? A reversing ledger entry is posted and invoice allocations are released." action={(x) => cancelReceiptAction(id, x)} />}</>} />
    <Card><CardContent className="grid gap-3 pt-5 text-sm sm:grid-cols-3">
      <p><span className="text-muted-foreground">Date</span><br />{fmtDate(r.receipt_date)}</p><p><span className="text-muted-foreground">Amount</span><br /><b>{fmtMoney(r.amount)}</b></p>
      <p><span className="text-muted-foreground">Status</span><br /><Badge variant={r.status === "active" ? "success" : "destructive"}>{r.status}</Badge></p>
      <p><span className="text-muted-foreground">Mode</span><br />{r.payment_mode}</p><p><span className="text-muted-foreground">Reference</span><br />{r.reference_no ?? "—"}</p><p><span className="text-muted-foreground">Remarks</span><br />{r.remarks ?? "—"}</p>
      {r.status === "cancelled" && <p className="sm:col-span-3 text-destructive">Cancelled: {r.cancel_reason}</p>}
      <div className="sm:col-span-3"><p className="text-muted-foreground">Applied to invoices</p>
        {(r.receipt_allocations ?? []).length === 0 ? <p>On account (not applied to any invoice)</p> : (r.receipt_allocations ?? []).map((a: { amount: number; invoices: Inv | Inv[] | null }, n: number) => { const i = one(a.invoices); return <p key={n}>{i ? <Link className="text-primary hover:underline" href={`/admin/invoices/${i.id}`}>{i.invoice_no}</Link> : "—"} · {fmtMoney(a.amount)}</p>; })}</div>
    </CardContent></Card></>);
}
