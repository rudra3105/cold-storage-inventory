/* eslint-disable @next/next/no-html-link-for-pages -- these links are file downloads from route handlers, not pages */
import { FileText } from "lucide-react";
import { requireCustomer } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtMoney } from "@/lib/utils";

export const metadata = { title: "My documents" };
export default async function PortalDocuments() {
  await requireCustomer();
  const supabase = await createClient();
  const [{ data: inv }, { data: rec }, { data: bal }] = await Promise.all([
    supabase.from("invoice_balances").select("*").in("status", ["issued", "cancelled"]).order("invoice_date", { ascending: false }).limit(200),
    supabase.from("receipts").select("id,receipt_no,receipt_date,amount,payment_mode,reference_no,status").order("receipt_date", { ascending: false }).limit(200),
    supabase.from("party_ledger_balances").select("balance").maybeSingle(),
  ]);
  const stmt = (f: string) => `/api/export/ledger?format=${f}`;
  return (<>
    <PageHeader title="Bills & Payments" description="Your bills, payments made, and account statements." actions={<>
      <Button asChild variant="outline"><a href={stmt("pdf")} target="_blank" rel="noopener"><FileText /> Ledger statement (PDF)</a></Button>
      <Button asChild variant="outline"><a href={stmt("xlsx")}>Excel</a></Button>
      <Button asChild variant="outline"><a href="/api/export/cold-stock-party?format=pdf" target="_blank" rel="noopener">Stock statement (PDF)</a></Button>
      <Button asChild variant="outline"><a href="/api/export/cold-stock-party?format=xlsx">Stock (Excel)</a></Button></>} />
    {bal && <p className="mb-4 text-sm">Account balance: <b>{fmtMoney(Math.abs(Number(bal.balance)))} {Number(bal.balance) > 0 ? "payable by you" : Number(bal.balance) < 0 ? "in your favour" : ""}</b></p>}
    <Card className="mb-6"><CardHeader><CardTitle>Invoices</CardTitle></CardHeader><Table>
      <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
      <TableBody>{(inv ?? []).length === 0 && <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">No invoices yet.</TableCell></TableRow>}
        {(inv ?? []).map((i) => <TableRow key={i.invoice_id}><TableCell>{i.invoice_no}</TableCell><TableCell>{fmtDate(i.invoice_date)}</TableCell><TableCell className="text-right tabular-nums">{fmtMoney(i.total)}</TableCell><TableCell className="text-right tabular-nums">{fmtMoney(i.paid)}</TableCell>
          <TableCell className="text-right tabular-nums">{i.status === "issued" ? fmtMoney(i.outstanding) : "—"}</TableCell><TableCell><Badge variant={i.payment_status === "paid" ? "success" : i.payment_status === "cancelled" ? "destructive" : "warning"}>{i.payment_status}</Badge></TableCell>
          <TableCell><Button asChild size="sm" variant="outline"><a href={`/api/pdf/invoice/${i.invoice_id}`} target="_blank" rel="noopener">PDF</a></Button></TableCell></TableRow>)}</TableBody></Table></Card>
    <Card><CardHeader><CardTitle>Payment history</CardTitle></CardHeader><CardContent className="px-0"><Table>
      <TableHeader><TableRow><TableHead>Receipt</TableHead><TableHead>Date</TableHead><TableHead>Mode</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
      <TableBody>{(rec ?? []).length === 0 && <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">No payments recorded.</TableCell></TableRow>}
        {(rec ?? []).map((r) => <TableRow key={r.id}><TableCell>{r.receipt_no}</TableCell><TableCell>{fmtDate(r.receipt_date)}</TableCell><TableCell>{r.payment_mode}</TableCell><TableCell>{r.reference_no ?? "—"}</TableCell><TableCell className="text-right tabular-nums">{fmtMoney(r.amount)}</TableCell>
          <TableCell><Badge variant={r.status === "active" ? "success" : "destructive"}>{r.status}</Badge></TableCell><TableCell><Button asChild size="sm" variant="outline"><a href={`/api/pdf/receipt/${r.id}`} target="_blank" rel="noopener">PDF</a></Button></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
  </>);
}
