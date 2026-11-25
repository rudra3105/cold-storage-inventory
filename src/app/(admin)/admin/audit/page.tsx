import { requirePermission } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isDate, qp } from "@/lib/data";
import { PageHeader } from "@/components/shell/page-header";
import { FilterBar, FilterField, Pagination } from "@/components/shell/filter-bar";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Audit logs" };
const PAGE = 50;
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("audit.view");
  const sp = await searchParams; const table = qp(sp.table); const action = qp(sp.action); const user = qp(sp.user); const from = qp(sp.from); const to = qp(sp.to); const rec = qp(sp.record)?.replace(/[%,()]/g, " ");
  const page = Math.max(1, Number(qp(sp.page) ?? 1) || 1);
  const supabase = await createClient();
  let q = supabase.from("audit_logs").select("*", { count: "exact" }).order("id", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (table) q = q.eq("table_name", table); if (action) q = q.eq("action", action); if (user && /^[0-9a-f-]{36}$/i.test(user)) q = q.eq("user_id", user);
  if (isDate(from)) q = q.gte("at", from!); if (isDate(to)) q = q.lt("at", new Date(new Date(to! + "T00:00:00Z").getTime() + 86400000).toISOString());
  if (rec) q = q.eq("record_id", rec);
  const [{ data, count, error }, { data: tables }, { data: profs }] = await Promise.all([q, supabase.from("audit_logs").select("table_name").order("id", { ascending: false }).limit(2000), supabase.from("profiles").select("id,full_name")]);
  if (error) throw new Error(error.message);
  const tnames = [...new Set((tables ?? []).map((t) => t.table_name))].sort();
  const who = (id: string | null) => (id ? profs?.find((p) => p.id === id)?.full_name ?? id.slice(0, 8) : "system");
  return (<>
    <PageHeader title="Activity Log" description="A record of who did what and when. Nobody can edit or delete it." />
    <FilterBar resetHref="/admin/audit">
      <FilterField label="Table"><Select name="table" defaultValue={table ?? ""} className="h-9"><option value="">All</option>{tnames.map((t) => <option key={t}>{t}</option>)}</Select></FilterField>
      <FilterField label="Action"><Select name="action" defaultValue={action ?? ""} className="h-9"><option value="">All</option><option value="INSERT">INSERT</option><option value="UPDATE">UPDATE</option><option value="DELETE">DELETE</option></Select></FilterField>
      <FilterField label="User"><Select name="user" defaultValue={user ?? ""} className="h-9"><option value="">All</option>{(profs ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</Select></FilterField>
      <FilterField label="Record id"><Input name="record" defaultValue={rec} className="h-9" /></FilterField>
      <FilterField label="From"><Input type="date" name="from" defaultValue={from} className="h-9" /></FilterField>
      <FilterField label="To"><Input type="date" name="to" defaultValue={to} className="h-9" /></FilterField>
    </FilterBar>
    <Card><Table><TableHeader><TableRow><TableHead>When</TableHead><TableHead>User</TableHead><TableHead>Action</TableHead><TableHead>Table</TableHead><TableHead>Record</TableHead><TableHead>Change</TableHead></TableRow></TableHeader>
      <TableBody>{(data ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No entries.</TableCell></TableRow>}
        {(data ?? []).map((l) => <TableRow key={l.id}><TableCell className="whitespace-nowrap">{new Date(l.at).toLocaleString("en-IN")}</TableCell><TableCell>{who(l.user_id)}</TableCell><TableCell>{l.action}</TableCell><TableCell>{l.table_name}</TableCell><TableCell className="max-w-32 truncate font-mono text-xs">{l.record_id}</TableCell>
          <TableCell className="max-w-md"><details><summary className="cursor-pointer text-primary">View</summary><pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{JSON.stringify({ old: l.old_data, new: l.new_data, meta: l.meta }, null, 1)}</pre></details></TableCell></TableRow>)}</TableBody></Table></Card>
    <Pagination page={page} pageSize={PAGE} total={count ?? 0} basePath="/admin/audit" params={{ table, action, user, record: rec, from, to }} />
  </>);
}
