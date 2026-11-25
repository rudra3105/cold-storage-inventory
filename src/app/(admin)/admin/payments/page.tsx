import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/context";
import { isDate, qp } from "@/lib/data";
import { PageHeader } from "@/components/shell/page-header";
import { FilterBar, FilterField, Pagination } from "@/components/shell/filter-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtMoney } from "@/lib/utils";

export const metadata = { title: "Payments" };
const PAGE = 25;
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePermission("billing.view");
  const sp = await searchParams; const from = qp(sp.from); const to = qp(sp.to); const q = qp(sp.q)?.replace(/[%,()]/g, " ");
  const page = Math.max(1, Number(qp(sp.page) ?? 1) || 1);
  const supabase = await createClient();
  let query = supabase.from("payments").select("*", { count: "exact" }).order("payment_date", { ascending: false }).order("payment_no", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (isDate(from)) query = query.gte("payment_date", from!); if (isDate(to)) query = query.lte("payment_date", to!);
  if (q) query = query.or(`payment_no.ilike.%${q}%,payee_name.ilike.%${q}%,purpose.ilike.%${q}%`);
  const { data, count, error } = await query; if (error) throw new Error(error.message);
  return (<>
    <PageHeader title="Money Paid" description="Money you paid out: labour, refunds, expenses (payments)." actions={ctx.can("billing.manage") && <Button asChild><Link href="/admin/payments/new"><Plus /> Record money paid</Link></Button>} />
    <FilterBar resetHref="/admin/payments">
      <FilterField label="Search"><Input name="q" defaultValue={q} placeholder="No., payee, purpose" className="h-9" /></FilterField>
      <FilterField label="From"><Input type="date" name="from" defaultValue={from} className="h-9" /></FilterField>
      <FilterField label="To"><Input type="date" name="to" defaultValue={to} className="h-9" /></FilterField>
    </FilterBar>
    <Card><Table>
      <TableHeader><TableRow><TableHead>Payment</TableHead><TableHead>Date</TableHead><TableHead>Payee</TableHead><TableHead>Purpose</TableHead><TableHead>Mode</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
      <TableBody>
        {(data ?? []).length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No payments match.</TableCell></TableRow>}
        {(data ?? []).map((r) => <TableRow key={r.id}><TableCell><Link className="font-medium text-primary hover:underline" href={`/admin/payments/${r.id}`}>{r.payment_no}</Link></TableCell><TableCell>{fmtDate(r.payment_date)}</TableCell>
          <TableCell>{r.payee_name}</TableCell><TableCell>{r.purpose ?? "—"}</TableCell><TableCell>{r.payment_mode}</TableCell><TableCell className="text-right tabular-nums">{fmtMoney(r.amount)}</TableCell>
          <TableCell><Badge variant={r.status === "active" ? "success" : "destructive"}>{r.status}</Badge></TableCell></TableRow>)}
      </TableBody></Table></Card>
    <Pagination page={page} pageSize={PAGE} total={count ?? 0} basePath="/admin/payments" params={{ q, from, to }} />
  </>);
}
