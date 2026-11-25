import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireInternal } from "@/lib/auth/context";
import { qp } from "@/lib/data";
import { PageHeader } from "@/components/shell/page-header";
import { FilterBar, FilterField, Pagination } from "@/components/shell/filter-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtMoney } from "@/lib/utils";

export const metadata = { title: "Party Master" };
const PAGE = 25;

export default async function PartiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireInternal();
  const sp = await searchParams;
  const q = qp(sp.q)?.replace(/[%,()]/g, " "); const status = qp(sp.status); const page = Math.max(1, Number(qp(sp.page) ?? 1) || 1);
  const supabase = await createClient();

  let query = supabase.from("parties").select("id,party_code,name,contact_person,mobile,city,is_active,user_id", { count: "exact" }).order("name").range((page - 1) * PAGE, page * PAGE - 1);
  if (q) query = query.or(`name.ilike.%${q}%,party_code.ilike.%${q}%,mobile.ilike.%${q}%,city.ilike.%${q}%,contact_person.ilike.%${q}%`);
  if (status === "active") query = query.eq("is_active", true);
  if (status === "inactive") query = query.eq("is_active", false);
  const { data, count, error } = await query;
  if (error) throw new Error(error.message);

  const ids = (data ?? []).map((p) => p.id);
  const bal = ctx.can("billing.view") && ids.length ? (await supabase.from("party_ledger_balances").select("party_id,balance").in("party_id", ids)).data ?? [] : [];
  const stock = ids.length ? (await supabase.from("stock_balances").select("party_id,available_bags").in("party_id", ids)).data ?? [] : [];
  const bagsOf = (id: string) => stock.filter((s) => s.party_id === id).reduce((a, s) => a + Number(s.available_bags), 0);

  return (
    <>
      <PageHeader title="Parties" description="Your customers who store goods with you" actions={ctx.can("party.manage") && <Button asChild><Link href="/admin/parties/new"><Plus /> Add party</Link></Button>} />
      <FilterBar resetHref="/admin/parties">
        <FilterField label="Search"><Input name="q" defaultValue={q} placeholder="Name, code, mobile, city" className="h-9" /></FilterField>
        <FilterField label="Status"><Select name="status" defaultValue={status ?? ""} className="h-9"><option value="">All</option><option value="active">Active</option><option value="inactive">Inactive</option></Select></FilterField>
      </FilterBar>
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Party</TableHead><TableHead>Contact</TableHead><TableHead>City</TableHead><TableHead className="text-right">Bags in stock</TableHead>
            {ctx.can("billing.view") && <TableHead className="text-right">Balance</TableHead>}<TableHead>Login</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {(data ?? []).length === 0 && <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No parties match.</TableCell></TableRow>}
            {(data ?? []).map((p) => (
              <TableRow key={p.id}>
                <TableCell className="whitespace-nowrap">{p.party_code}</TableCell>
                <TableCell className="font-medium"><Link href={`/admin/parties/${p.id}`} className="text-primary hover:underline">{p.name}</Link></TableCell>
                <TableCell>{[p.contact_person, p.mobile].filter(Boolean).join(" · ") || "—"}</TableCell>
                <TableCell>{p.city ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{bagsOf(p.id).toLocaleString("en-IN")}</TableCell>
                {ctx.can("billing.view") && <TableCell className="text-right tabular-nums">{fmtMoney(bal.find((b) => b.party_id === p.id)?.balance ?? 0)}</TableCell>}
                <TableCell>{p.user_id ? <Badge variant="success">Has login</Badge> : <Badge>No login</Badge>}</TableCell>
                <TableCell><Badge variant={p.is_active ? "success" : "warning"}>{p.is_active ? "Active" : "Inactive"}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Pagination page={page} pageSize={PAGE} total={count ?? 0} basePath="/admin/parties" params={{ q, status }} />
    </>
  );
}
