import Link from "next/link";
import { requireInternal } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { isUuid, loadMasters, qp, today } from "@/lib/data";
import { PageHeader } from "@/components/shell/page-header";
import { FilterBar, FilterField, Pagination } from "@/components/shell/filter-bar";
import { Stat } from "@/components/shell/stat";
import { AdjustmentForm } from "@/components/forms/adjustment-form";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtKg, fmtNum } from "@/lib/utils";

export const metadata = { title: "Inventory" };
const PAGE = 50;
const SORTS: Record<string, string> = { party: "party_name", product: "product_name", bags: "available_bags", kgs: "available_kgs", chamber: "chamber_code" };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireInternal();
  const sp = await searchParams;
  const party = qp(sp.party); const product = qp(sp.product); const chamber = qp(sp.chamber); const floor = qp(sp.floor);
  const sort = SORTS[qp(sp.sort) ?? ""] ? qp(sp.sort)! : "party"; const dir = qp(sp.dir) === "desc" ? "desc" : "asc";
  const page = Math.max(1, Number(qp(sp.page) ?? 1) || 1);
  const supabase = await createClient(); const m = await loadMasters({ includeInactive: true });
  let q = supabase.from("v_stock_detail").select("*", { count: "exact" }).neq("available_bags", 0);
  let tq = supabase.from("v_stock_detail").select("available_bags,available_kgs").neq("available_bags", 0);
  for (const [col, v] of [["party_id", party], ["product_id", product], ["chamber_id", chamber], ["floor_id", floor]] as const) if (isUuid(v)) { q = q.eq(col, v!); tq = tq.eq(col, v!); }
  q = q.order(SORTS[sort], { ascending: dir === "asc" }).order("party_name").order("product_name").range((page - 1) * PAGE, page * PAGE - 1);
  const [{ data, count, error }, { data: all }] = await Promise.all([q, tq.range(0, 9999)]);
  if (error) throw new Error(error.message);
  const bags = (all ?? []).reduce((a, r) => a + Number(r.available_bags), 0), kgs = (all ?? []).reduce((a, r) => a + Number(r.available_kgs), 0);
  const adjs = ctx.can("stock.adjust") ? (await supabase.from("stock_adjustments").select("*").order("created_at", { ascending: false }).limit(15)).data ?? [] : [];
  const floors = m.floors.filter((f) => !chamber || f.chamber_id === chamber);
  const rackOpts = m.racks.filter((r) => r.is_active).map((r) => { const f = m.floors.find((x) => x.id === r.floor_id); const c = m.chambers.find((x) => x.id === f?.chamber_id); return { id: r.id, label: `${c?.code}-F${f?.floor_no}-${r.code}` }; });
  const sortLink = (key: string, label: string) => { const p = new URLSearchParams(Object.entries({ party, product, chamber, floor }).filter(([, v]) => v) as [string, string][]); p.set("sort", key); p.set("dir", sort === key && dir === "asc" ? "desc" : "asc"); return <Link href={`/admin/inventory?${p}`} className="hover:underline">{label}{sort === key ? (dir === "asc" ? " ▲" : " ▼") : ""}</Link>; };
  return (<>
    <PageHeader title="Stock" description="What is in the warehouse right now. It updates by itself from Goods In and Goods Out." />
    <div className="mb-4 grid gap-3 sm:grid-cols-3"><Stat label="Bags in stock" value={fmtNum(bags)} /><Stat label="Total weight" value={fmtKg(kgs)} /><Stat label="Stock lines" value={fmtNum(count ?? 0)} /></div>
    <FilterBar resetHref="/admin/inventory">
      <FilterField label="Party"><Select name="party" defaultValue={party ?? ""} className="h-9"><option value="">All</option>{m.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></FilterField>
      <FilterField label="Product"><Select name="product" defaultValue={product ?? ""} className="h-9"><option value="">All</option>{m.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></FilterField>
      <FilterField label="Chamber"><Select name="chamber" defaultValue={chamber ?? ""} className="h-9"><option value="">All</option>{m.chambers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></FilterField>
      <FilterField label="Floor"><Select name="floor" defaultValue={floor ?? ""} className="h-9"><option value="">All</option>{floors.map((f) => <option key={f.id} value={f.id}>{m.chambers.find((c) => c.id === f.chamber_id)?.code} · Floor {f.floor_no}</option>)}</Select></FilterField>
    </FilterBar>
    <Card><Table>
      <TableHeader><TableRow><TableHead>{sortLink("party", "Party")}</TableHead><TableHead>{sortLink("product", "Product")}</TableHead><TableHead>{sortLink("chamber", "Location")}</TableHead>
        <TableHead className="text-right">Inward bags</TableHead><TableHead className="text-right">Outward bags</TableHead><TableHead className="text-right">Adj.</TableHead><TableHead className="text-right">{sortLink("bags", "Available bags")}</TableHead><TableHead className="text-right">{sortLink("kgs", "Available kgs")}</TableHead></TableRow></TableHeader>
      <TableBody>
        {(data ?? []).length === 0 && <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No stock matches these filters.</TableCell></TableRow>}
        {(data ?? []).map((r) => <TableRow key={`${r.party_id}${r.product_id}${r.rack_id}`}><TableCell>{r.party_name}</TableCell><TableCell>{r.product_name}</TableCell><TableCell>{r.chamber_code}-F{r.floor_no}-{r.rack_code}</TableCell>
          <TableCell className="text-right tabular-nums">{fmtNum(r.inward_bags)}</TableCell><TableCell className="text-right tabular-nums">{fmtNum(r.outward_bags)}</TableCell><TableCell className="text-right tabular-nums">{fmtNum(r.adjustment_bags)}</TableCell>
          <TableCell className="text-right font-medium tabular-nums">{fmtNum(r.available_bags)}</TableCell><TableCell className="text-right tabular-nums">{fmtKg(r.available_kgs)}</TableCell></TableRow>)}
      </TableBody></Table></Card>
    <Pagination page={page} pageSize={PAGE} total={count ?? 0} basePath="/admin/inventory" params={{ party, product, chamber, floor, sort, dir }} />
    {ctx.can("stock.adjust") && <section className="mt-8 space-y-3"><h2 className="text-base font-semibold">Stock adjustment</h2>
      <AdjustmentForm today={today()} parties={m.parties.map((p) => ({ id: p.id, label: p.name }))} products={m.products.map((p) => ({ id: p.id, label: p.name }))} racks={rackOpts} />
      <Card><CardHeader><CardTitle>Recent adjustments</CardTitle></CardHeader><Table>
        <TableHeader><TableRow><TableHead>No.</TableHead><TableHead>Date</TableHead><TableHead>Party</TableHead><TableHead>Product</TableHead><TableHead className="text-right">Bags</TableHead><TableHead className="text-right">Kgs</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
        <TableBody>{adjs.length === 0 && <TableRow><TableCell colSpan={7} className="py-4 text-center text-muted-foreground">No adjustments yet.</TableCell></TableRow>}
          {adjs.map((a) => <TableRow key={a.id}><TableCell>{a.adj_no}</TableCell><TableCell>{fmtDate(a.adj_date)}</TableCell><TableCell>{m.parties.find((p) => p.id === a.party_id)?.name}</TableCell><TableCell>{m.products.find((p) => p.id === a.product_id)?.name}</TableCell>
            <TableCell className="text-right tabular-nums">{a.bags_delta}</TableCell><TableCell className="text-right tabular-nums">{Number(a.kgs_delta)}</TableCell><TableCell>{a.reason}</TableCell></TableRow>)}</TableBody></Table></Card></section>}
  </>);
}
