import Link from "next/link";
import { requireCustomer } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isDate, qp, today, monthStart } from "@/lib/data";
import { PageHeader } from "@/components/shell/page-header";
import { FilterBar, FilterField } from "@/components/shell/filter-bar";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtNum } from "@/lib/utils";
import { fetchAll } from "@/lib/reports/engine";

export const metadata = { title: "My transactions" };
type R = { doc_id: string; doc_no: string; doc_date: string; product_name: string; bags: number; total_kgs: number; chamber_code: string; floor_no: number; rack_code: string; status: string; vehicle_no: string | null };

export default async function PortalTransactions({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireCustomer();
  const sp = await searchParams; const tab = qp(sp.tab) === "inward" ? "inward" : qp(sp.tab) === "outward" ? "outward" : "all";
  const from = isDate(qp(sp.from)) ? qp(sp.from)! : "2000-01-01"; const to = isDate(qp(sp.to)) ? qp(sp.to)! : today();
  const supabase = await createClient();
  const { data: s } = await supabase.from("business_settings").select("customer_can_see_rack").maybeSingle(); const showRack = s?.customer_can_see_rack ?? true;
  const load = (view: string) => fetchAll<R>((a, b) => supabase.from(view).select("doc_id,doc_no,doc_date,product_name,bags,total_kgs,chamber_code,floor_no,rack_code,status,vehicle_no").gte("doc_date", from).lte("doc_date", to).order("doc_date", { ascending: false }).order("doc_no", { ascending: false }).range(a, b));
  const [i, o] = await Promise.all([tab !== "outward" ? load("v_inward_lines") : [], tab !== "inward" ? load("v_outward_lines") : []]);
  const rows = [...i.map((r) => ({ ...r, type: "Goods In" })), ...o.map((r) => ({ ...r, type: "Goods Out" }))].sort((a, b) => b.doc_date.localeCompare(a.doc_date) || b.doc_no.localeCompare(a.doc_no)).slice(0, 1000);
  const tabLink = (t: string, l: string) => <Link key={t} href={`/portal/transactions?tab=${t}`} className={`rounded-full px-5 py-2.5 text-base font-semibold ${tab === t ? "bg-primary text-primary-foreground" : "border bg-card hover:bg-muted"}`}>{l}</Link>;
  return (<>
    <PageHeader title="My History" description="Every time goods came in or went out for you." />
    <div className="mb-3 flex gap-2">{tabLink("all", "All")}{tabLink("inward", "Goods In")}{tabLink("outward", "Goods Out")}</div>
    <FilterBar resetHref={`/portal/transactions?tab=${tab}`}><input type="hidden" name="tab" value={tab} /><FilterField label="From"><Input type="date" name="from" defaultValue={from === "2000-01-01" ? "" : from} className="h-9" /></FilterField><FilterField label="To"><Input type="date" name="to" defaultValue={to} className="h-9" /></FilterField></FilterBar>
    <Card><Table><TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Number</TableHead><TableHead>Date</TableHead><TableHead>Product</TableHead><TableHead className="text-right">Bags</TableHead><TableHead className="text-right">Kgs</TableHead><TableHead>Location</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
      <TableBody>{rows.length === 0 && <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No transactions.</TableCell></TableRow>}
        {rows.map((r, n) => <TableRow key={n}><TableCell>{r.type}</TableCell><TableCell>{r.doc_no}</TableCell><TableCell>{fmtDate(r.doc_date)}</TableCell><TableCell>{r.product_name}</TableCell><TableCell className="text-right tabular-nums">{fmtNum(r.bags)}</TableCell><TableCell className="text-right tabular-nums">{fmtNum(r.total_kgs)}</TableCell>
          <TableCell>{r.chamber_code}-F{r.floor_no}{showRack ? `-${r.rack_code}` : ""}</TableCell><TableCell><Badge variant={r.status === "active" ? "success" : "destructive"}>{r.status}</Badge></TableCell></TableRow>)}</TableBody></Table></Card>
    <p className="mt-2 text-sm text-muted-foreground">Month start: {fmtDate(monthStart())}. Showing up to 1,000 most recent lines; use the date filter for older entries.</p>
  </>);
}
