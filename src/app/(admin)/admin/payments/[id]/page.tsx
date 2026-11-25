import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { requirePermission } from "@/lib/auth/context";
import { isUuid } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { cancelPaymentAction } from "@/lib/billing-actions";
import { PageHeader } from "@/components/shell/page-header";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { fmtDate, fmtMoney } from "@/lib/utils";

export const metadata = { title: "Payment" };
export default async function PaymentDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("billing.view");
  const { id } = await params; if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: r } = await supabase.from("payments").select("*").eq("id", id).maybeSingle();
  if (!r) notFound();
  return (<>
    <PageHeader title={r.payment_no} description={r.payee_name} actions={<><Button asChild variant="outline"><a href={`/api/pdf/payment/${id}`} target="_blank" rel="noopener"><Printer /> Print voucher</a></Button>
      {ctx.can("billing.manage") && r.status === "active" && <ConfirmAction label="Cancel payment" askReason confirmText="Cancel this payment? A reversing entry is posted if it was against a party." action={(x) => cancelPaymentAction(id, x)} />}</>} />
    <Card><CardContent className="grid gap-3 pt-5 text-sm sm:grid-cols-3">
      <p><span className="text-muted-foreground">Date</span><br />{fmtDate(r.payment_date)}</p><p><span className="text-muted-foreground">Amount</span><br /><b>{fmtMoney(r.amount)}</b></p>
      <p><span className="text-muted-foreground">Status</span><br /><Badge variant={r.status === "active" ? "success" : "destructive"}>{r.status}</Badge></p>
      <p><span className="text-muted-foreground">Mode</span><br />{r.payment_mode}</p><p><span className="text-muted-foreground">Purpose</span><br />{r.purpose ?? "—"}</p><p><span className="text-muted-foreground">Reference</span><br />{r.reference_no ?? "—"}</p>
      <p className="sm:col-span-3"><span className="text-muted-foreground">Remarks</span><br />{r.remarks ?? "—"}</p>
      {r.status === "cancelled" && <p className="sm:col-span-3 text-destructive">Cancelled: {r.cancel_reason}</p>}
    </CardContent></Card></>);
}
