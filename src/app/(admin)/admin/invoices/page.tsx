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

export const metadata = { title: "Invoices" };
const PAGE = 25;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePermission("billing.view");
  const sp = await searchParams;
  const party = qp(sp.party); const status = qp(sp.status); const from = qp(sp.from); const to = qp(sp.to); const q = qp(sp.q)?.replace(/[%,()]/g, " ");
  const page = Math.max(1, Number(qp(sp.page) ?? 1) || 1);
  const supabase = await createClient(); const m = await loadMasters({ includeInactive: true });
  let query = supabase.from("invoice_balances").select("*", { count: "exact" }).order("invoice_date", { ascending: false }).order("invoice_no", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (isUuid(party)) query = query.eq("party_id", party!);
  if (status === "unpaid" || status === "partial" || status === "paid" || status === "draft" || status === "cancelled") query = query.eq("payment_status", status);
  if (isDate(from)) query = query.gte("invoice_date", from!); if (isDate(to)) query = query.lte("invoice_date", to!);
  if (q) query = query.ilike("invoice_no", `%${q}%`);
  const { data, count, error } = await query; if (error) throw new Error(error.message);
  const name = (id: string) => m.parties.find((p) => p.id === id)?.name ?? "—";
  return (
    <>
      <PageHeader title="Bills" description="Invoices you have made for customers. Making a bill does not change stock." actions={ctx.can("billing.manage") && <Button asChild><Link href="/admin/invoices/new"><Plus /> Make a bill</Link></Button>} />
      <FilterBar resetHref="/admin/invoices">
        <FilterField label="Invoice no."><Input name="q" defaultValue={q} className="h-9" /></FilterField>
        <FilterField label="Party"><Select name="party" defaultValue={party ?? ""} className="h-9"><option value="">All</option>{m.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></FilterField>
        <FilterField label="Status"><Select name="status" defaultValue={status ?? ""} className="h-9"><option value="">All</option>{["draft", "unpaid", "partial", "paid", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}</Select></FilterField>
        <FilterField label="From"><Input type="date" name="from" defaultValue={from} className="h-9" /></FilterField>
        <FilterField label="To"><Input type="date" name="to" defaultValue={to} className="h-9" /></FilterField>
      </FilterBar>
      <Card><Table>
        <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Date</TableHead><TableHead>Party</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
        <TableBody>
          {(data ?? []).length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No invoices match.</TableCell></TableRow>}
          {(data ?? []).map((i) => (
            <TableRow key={i.invoice_id}>
              <TableCell><Link className="font-medium text-primary hover:underline" href={`/admin/invoices/${i.invoice_id}`}>{i.invoice_no ?? "Draft"}</Link></TableCell>
              <TableCell>{fmtDate(i.invoice_date)}</TableCell><TableCell>{name(i.party_id)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtMoney(i.total)}</TableCell><TableCell className="text-right tabular-nums">{fmtMoney(i.paid)}</TableCell>
              <TableCell className="text-right tabular-nums">{i.status === "issued" ? fmtMoney(i.outstanding) : "—"}</TableCell>
              <TableCell><Badge variant={i.payment_status === "paid" ? "success" : i.payment_status === "cancelled" ? "destructive" : i.payment_status === "draft" ? "default" : "warning"}>{i.payment_status}</Badge></TableCell>
            </TableRow>))}
        </TableBody>
      </Table></Card>
      <Pagination page={page} pageSize={PAGE} total={count ?? 0} basePath="/admin/invoices" params={{ q, party, status, from, to }} />
    </>
  );
}
