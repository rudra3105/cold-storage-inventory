import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Printer } from "lucide-react";
import { requirePermission } from "@/lib/auth/context";
import { isUuid, one } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { cancelInvoiceAction, issueInvoiceAction } from "@/lib/billing-actions";
import { PageHeader } from "@/components/shell/page-header";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtMoney } from "@/lib/utils";

export const metadata = { title: "Invoice" };
export default async function InvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("billing.view");
  const { id } = await params; if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const [{ data: inv }, { data: bal }, { data: allocs }] = await Promise.all([
    supabase.from("invoices").select("*, parties(name,party_code), invoice_items(*)").eq("id", id).maybeSingle(),
    supabase.from("invoice_balances").select("*").eq("invoice_id", id).maybeSingle(),
    supabase.from("receipt_allocations").select("amount, receipts(id,receipt_no,receipt_date,status)").eq("invoice_id", id),
  ]);
  if (!inv || !bal) notFound();
  const party = one(inv.parties as { name: string; party_code: string } | { name: string; party_code: string }[] | null);
  const items = [...(inv.invoice_items ?? [])].sort((a, b) => a.line_no - b.line_no);
  const manage = ctx.can("billing.manage");
  return (
    <>
      <PageHeader title={inv.invoice_no ?? "Draft invoice"} description={party ? `${party.name} (${party.party_code})` : undefined}
        actions={<>
          {inv.status !== "draft" && <Button asChild variant="outline"><a href={`/api/pdf/invoice/${id}`} target="_blank" rel="noopener"><Printer /> Print / PDF</a></Button>}
          {manage && inv.status === "draft" && <><Button asChild variant="outline"><Link href={`/admin/invoices/${id}/edit`}><Pencil /> Edit</Link></Button>
            <ConfirmAction label="Issue invoice" variant="default" size="default" confirmText="Issue this invoice? It gets its number, posts to the party ledger and can no longer be edited." action={() => issueInvoiceAction(id)} /></>}
          {manage && inv.status === "issued" && <ConfirmAction label="Cancel invoice" askReason confirmText="Cancel this invoice? A reversing ledger entry is posted. Not possible while receipts are applied to it." action={(r) => cancelInvoiceAction(id, r)} />}
        </>} />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Badge variant={bal.payment_status === "paid" ? "success" : bal.payment_status === "cancelled" ? "destructive" : "warning"}>{bal.payment_status}</Badge>
        <span>Date: {fmtDate(inv.invoice_date)}</span>{inv.due_date && <span>Due: {fmtDate(inv.due_date)}</span>}
        {inv.period_from && <span>Period: {fmtDate(inv.period_from)} – {inv.period_to ? fmtDate(inv.period_to) : "…"}</span>}
      </div>
      {inv.status === "cancelled" && <p className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-base font-medium text-destructive">Cancelled{inv.cancel_reason ? `: ${inv.cancel_reason}` : ""}</p>}
      <Card><Table>
        <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Qty</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">Rate</TableHead><TableHead className="text-right">Tax %</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
        <TableBody>
          {items.map((i) => <TableRow key={i.id}><TableCell>{i.line_no}</TableCell><TableCell>{i.description}</TableCell><TableCell className="text-right tabular-nums">{Number(i.quantity).toLocaleString("en-IN")}</TableCell><TableCell>{i.unit ?? ""}</TableCell>
            <TableCell className="text-right tabular-nums">{fmtMoney(i.rate)}</TableCell><TableCell className="text-right tabular-nums">{Number(i.tax_percent)}</TableCell><TableCell className="text-right tabular-nums">{fmtMoney(Number(i.amount) + Number(i.tax_amount))}</TableCell></TableRow>)}
          <TableRow className="font-semibold"><TableCell colSpan={6} className="text-right">Subtotal {fmtMoney(bal.subtotal)} · Tax {fmtMoney(bal.tax_total)} · Total</TableCell><TableCell className="text-right tabular-nums">{fmtMoney(bal.total)}</TableCell></TableRow>
          {inv.status === "issued" && <><TableRow><TableCell colSpan={6} className="text-right">Received</TableCell><TableCell className="text-right tabular-nums">{fmtMoney(bal.paid)}</TableCell></TableRow>
            <TableRow className="font-semibold"><TableCell colSpan={6} className="text-right">Outstanding</TableCell><TableCell className="text-right tabular-nums">{fmtMoney(bal.outstanding)}</TableCell></TableRow></>}
        </TableBody>
      </Table></Card>
      {inv.notes && <p className="mt-3 text-sm text-muted-foreground">Notes: {inv.notes}</p>}
      {(allocs ?? []).length > 0 && <Card className="mt-4"><CardHeader><CardTitle>Receipts applied</CardTitle></CardHeader><CardContent className="space-y-1 text-sm">
        {(allocs ?? []).map((a, n) => { const r = one(a.receipts as { id: string; receipt_no: string; receipt_date: string; status: string } | { id: string; receipt_no: string; receipt_date: string; status: string }[] | null);
          return r ? <p key={n}><Link className="text-primary hover:underline" href={`/admin/receipts/${r.id}`}>{r.receipt_no}</Link> · {fmtDate(r.receipt_date)} · {fmtMoney(a.amount)} {r.status === "cancelled" && <Badge variant="destructive">cancelled</Badge>}</p> : null; })}</CardContent></Card>}
    </>
  );
}
