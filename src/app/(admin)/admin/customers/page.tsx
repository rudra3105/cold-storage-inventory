import Link from "next/link";
import { requirePermission } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { qp } from "@/lib/data";
import { PageHeader } from "@/components/shell/page-header";
import { FilterBar, FilterField } from "@/components/shell/filter-bar";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Customer logins" };
export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("staff.manage");
  const q = qp((await searchParams).q)?.replace(/[%,()]/g, " ");
  const supabase = await createClient();
  let query = supabase.from("parties").select("id,party_code,name,mobile,email,is_active,user_id").order("name").limit(500);
  if (q) query = query.or(`name.ilike.%${q}%,party_code.ilike.%${q}%,email.ilike.%${q}%`);
  const { data, error } = await query; if (error) throw new Error(error.message);
  const ids = (data ?? []).map((p) => p.user_id).filter(Boolean) as string[];
  const profs = ids.length ? (await supabase.from("profiles").select("id,is_active").in("id", ids)).data ?? [] : [];
  return (<>
    <PageHeader title="Customer logins" description="Create and manage portal logins from each party's page. Customers only ever see their own data." />
    <FilterBar resetHref="/admin/customers"><FilterField label="Search"><Input name="q" defaultValue={q} className="h-9" /></FilterField></FilterBar>
    <Card><Table><TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Party</TableHead><TableHead>Contact</TableHead><TableHead>Portal login</TableHead></TableRow></TableHeader>
      <TableBody>{(data ?? []).map((p) => { const pr = profs.find((x) => x.id === p.user_id); return (
        <TableRow key={p.id}><TableCell>{p.party_code}</TableCell><TableCell><Link className="font-medium text-primary hover:underline" href={`/admin/parties/${p.id}`}>{p.name}</Link></TableCell><TableCell>{[p.mobile, p.email].filter(Boolean).join(" · ") || "—"}</TableCell>
          <TableCell>{!p.user_id ? <Badge>No login</Badge> : pr?.is_active ? <Badge variant="success">Active</Badge> : <Badge variant="warning">Disabled</Badge>}</TableCell></TableRow>); })}</TableBody></Table></Card>
  </>);
}
