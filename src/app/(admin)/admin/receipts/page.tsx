import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requirePermission } from "@/lib/auth/context";
import { isDate, isUuid, loadMasters, qp } from "@/lib/data";
import { PageHeader } from "@/components/shell/page-header";
import { FilterBar, FilterField, Pagination } from "@/components/shell/filter-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtMoney } from "@/lib/utils";

export const metadata = { title: "Receipts" };
const PAGE = 25;
export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePermission("billing.view");
  const sp = await searchParams; const party = qp(sp.party); const from = qp(sp.from); const to = qp(sp.to); const q = qp(sp.q)?.replace(/[%,()]/g, " ");
  const page = Math.max(1, Number(qp(sp.page) ?? 1) || 1);
  const supabase = await createClient(); const m = await loadMasters({ includeInactive: true });
  let query = supabase.from("receipts").select("*", { count: "exact" }).order("receipt_date", { ascending: false }).order("receipt_no", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (isUuid(party)) query = query.eq("party_id", party!); if (isDate(from)) query = query.gte("receipt_date", from!); if (isDate(to)) query = query.lte("receipt_date", to!);
  if (q) query = query.or(`receipt_no.ilike.%${q}%,reference_no.ilike.%${q}%`);
  const { data, count, error } = await query; if (error) throw new Error(error.message);
  return (<>
    <PageHeader title="Money Received" description="Payments you received from customers (receipts)." actions={ctx.can("billing.manage") && <Button asChild><Link href="/admin/receipts/new"><Plus /> Record money received</Link></Button>} />
    <FilterBar resetHref="/admin/receipts">
      <FilterField label="Receipt / reference"><Input name="q" defaultValue={q} className="h-9" /></FilterField>
      <FilterField label="Party"><Select name="party" defaultValue={party ?? ""} className="h-9"><option value="">All</option>{m.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></FilterField>
      <FilterField label="From"><Input type="date" name="from" defaultValue={from} className="h-9" /></FilterField>
      <FilterField label="To"><Input type="date" name="to" defaultValue={to} className="h-9" /></FilterField>
    </FilterBar>
    <Card><Table>
      <TableHeader><TableRow><TableHead>Receipt</TableHead><TableHead>Date</TableHead><TableHead>Party</TableHead><TableHead>Mode</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
      <TableBody>
        {(data ?? []).length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No receipts match.</TableCell></TableRow>}
        {(data ?? []).map((r) => <TableRow key={r.id}><TableCell><Link className="font-medium text-primary hover:underline" href={`/admin/receipts/${r.id}`}>{r.receipt_no}</Link></TableCell><TableCell>{fmtDate(r.receipt_date)}</TableCell>
          <TableCell>{m.parties.find((p) => p.id === r.party_id)?.name}</TableCell><TableCell>{r.payment_mode}</TableCell><TableCell>{r.reference_no ?? "—"}</TableCell>
          <TableCell className="text-right tabular-nums">{fmtMoney(r.amount)}</TableCell><TableCell><Badge variant={r.status === "active" ? "success" : "destructive"}>{r.status}</Badge></TableCell></TableRow>)}
      </TableBody></Table></Card>
    <Pagination page={page} pageSize={PAGE} total={count ?? 0} basePath="/admin/receipts" params={{ q, party, from, to }} />
  </>);
}
