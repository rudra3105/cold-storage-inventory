import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus, Printer } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireInternal } from "@/lib/auth/context";
import { isDate, isUuid, loadMasters, one, qp, today, monthStart } from "@/lib/data";
import { PageHeader } from "@/components/shell/page-header";
import { FilterBar, FilterField, Pagination } from "@/components/shell/filter-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { StockDocForm } from "@/components/forms/stock-doc-form";
import { cancelInwardAction, cancelOutwardAction, createInwardAction, createOutwardAction, updateInwardAction, updateOutwardAction } from "@/lib/stock-actions";
import { fmtDate, fmtKg, fmtNum } from "@/lib/utils";

export type Kind = "inward" | "outward";
const C = {
  inward: { table: "inward_transactions", items: "inward_items", view: "v_inward_lines", idCol: "inward_id", noCol: "inward_no", dateCol: "inward_date", title: "Goods In", perm: "inward.create" },
  outward: { table: "outward_transactions", items: "outward_items", view: "v_outward_lines", idCol: "outward_id", noCol: "outward_no", dateCol: "outward_date", title: "Goods Out", perm: "outward.create" },
} as const;
const PAGE = 25;
type SP = Record<string, string | string[] | undefined>;

export async function StockDocList({ kind, searchParams }: { kind: Kind; searchParams: SP }) {
  const k = C[kind]; const ctx = await requireInternal();
  const q = qp(searchParams.q)?.replace(/[%,()]/g, " "); const from = qp(searchParams.from); const to = qp(searchParams.to);
  const party = qp(searchParams.party); const product = qp(searchParams.product); const status = qp(searchParams.status);
  const page = Math.max(1, Number(qp(searchParams.page) ?? 1) || 1);
  const supabase = await createClient();
  const m = await loadMasters({ includeInactive: true });

  let ids: string[] | null = null;
  if (isUuid(product)) {
    const { data } = await supabase.from(k.items).select(k.idCol).eq("product_id", product!).limit(5000);
    ids = ((data ?? []) as unknown as Record<string, string>[]).map((r) => r[k.idCol]);
  }
  let query = supabase.from(k.table).select(`id,${k.noCol},${k.dateCol},vehicle_no,status,party_id,parties(name),${k.items}(bags,total_kgs,products(name))`, { count: "exact" })
    .order(k.dateCol, { ascending: false }).order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  if (isDate(from)) query = query.gte(k.dateCol, from!);
  if (isDate(to)) query = query.lte(k.dateCol, to!);
  if (isUuid(party)) query = query.eq("party_id", party!);
  if (status === "active" || status === "cancelled") query = query.eq("status", status);
  if (q) query = query.or(`${k.noCol}.ilike.%${q}%,vehicle_no.ilike.%${q}%`);
  if (ids) query = query.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  type Row = Record<string, unknown> & { id: string; status: string; vehicle_no: string | null; parties: { name: string } | { name: string }[] | null };

  return (
    <>
      <PageHeader title={k.title} description={kind === "inward" ? "Goods that arrived at the warehouse (Inward)" : "Goods that left the warehouse (Outward)"} actions={ctx.can(k.perm) && <Button asChild><Link href={`/admin/${kind}/new`}><Plus /> {kind === "inward" ? "New Goods In" : "New Goods Out"}</Link></Button>} />
      <FilterBar resetHref={`/admin/${kind}`}>
        <FilterField label="Search"><Input name="q" defaultValue={q} placeholder="Number or vehicle" className="h-9" /></FilterField>
        <FilterField label="From"><Input type="date" name="from" defaultValue={from} className="h-9" /></FilterField>
        <FilterField label="To"><Input type="date" name="to" defaultValue={to} className="h-9" /></FilterField>
        <FilterField label="Party"><Select name="party" defaultValue={party ?? ""} className="h-9"><option value="">All</option>{m.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></FilterField>
        <FilterField label="Product"><Select name="product" defaultValue={product ?? ""} className="h-9"><option value="">All</option>{m.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></FilterField>
        <FilterField label="Status"><Select name="status" defaultValue={status ?? ""} className="h-9"><option value="">All</option><option value="active">Active</option><option value="cancelled">Cancelled</option></Select></FilterField>
      </FilterBar>
      <Card><Table>
        <TableHeader><TableRow><TableHead>No.</TableHead><TableHead>Date</TableHead><TableHead>Party</TableHead><TableHead>Products</TableHead><TableHead>Vehicle</TableHead><TableHead className="text-right">Bags</TableHead><TableHead className="text-right">Kgs</TableHead><TableHead>Status</TableHead><TableHead className="no-print" /></TableRow></TableHeader>
        <TableBody>
          {(data ?? []).length === 0 && <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No {kind} entries match.</TableCell></TableRow>}
          {((data ?? []) as unknown as Row[]).map((r) => {
            const items = (r[k.items] as { bags: number; total_kgs: number; products: { name: string } | { name: string }[] | null }[]) ?? [];
            const names = [...new Set(items.map((i) => one(i.products)?.name).filter(Boolean))];
            return (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap font-medium"><Link className="text-primary hover:underline" href={`/admin/${kind}/${r.id}`}>{String(r[k.noCol])}</Link></TableCell>
                <TableCell className="whitespace-nowrap">{fmtDate(String(r[k.dateCol]))}</TableCell>
                <TableCell>{one(r.parties)?.name ?? "—"}</TableCell>
                <TableCell className="max-w-56 truncate">{names.join(", ") || "—"}</TableCell>
                <TableCell>{r.vehicle_no ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtNum(items.reduce((a, i) => a + i.bags, 0))}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtNum(items.reduce((a, i) => a + Number(i.total_kgs), 0))}</TableCell>
                <TableCell><Badge variant={r.status === "cancelled" ? "destructive" : "success"}>{r.status}</Badge></TableCell>
                <TableCell className="no-print"><a className="text-primary hover:underline" href={`/api/pdf/${kind}/${r.id}`} target="_blank" rel="noopener">Print</a></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table></Card>
      <Pagination page={page} pageSize={PAGE} total={count ?? 0} basePath={`/admin/${kind}`} params={{ q, from, to, party, product, status }} />
    </>
  );
}

export async function StockDocDetail({ kind, id }: { kind: Kind; id: string }) {
  const k = C[kind]; const ctx = await requireInternal();
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const [{ data: lines }, { data: moves }, audit] = await Promise.all([
    supabase.from(k.view).select("*").eq("doc_id", id).order("line_no"),
    supabase.from("stock_movements").select("movement_type,movement_date,bags,kgs,created_at,rack_id").eq(k.idCol, id).order("created_at"),
    ctx.can("audit.view") ? supabase.from("audit_logs").select("at,action,meta,user_id").eq("table_name", k.table).eq("record_id", id).order("at") : Promise.resolve({ data: [] }),
  ]);
  const h = (lines ?? [])[0] as Record<string, unknown> | undefined;
  if (!h) notFound();
  const cancelled = h.status === "cancelled";
  const totalBags = (lines ?? []).reduce((a, l) => a + Number(l.bags), 0);
  const totalKgs = (lines ?? []).reduce((a, l) => a + Number(l.total_kgs), 0);
  const can = (p: string) => ctx.can(p);
  const cancelAction = kind === "inward" ? cancelInwardAction : cancelOutwardAction;
  return (
    <>
      <PageHeader title={`${k.title} ${h.doc_no}`} description={`${fmtDate(String(h.doc_date))} · ${h.party_name}`}
        actions={<>
          <Badge variant={cancelled ? "destructive" : "success"}>{String(h.status)}</Badge>
          <Button asChild variant="outline"><a href={`/api/pdf/${kind}/${id}`} target="_blank" rel="noopener"><Printer /> Print</a></Button>
          {!cancelled && can(`${kind}.update`) && <Button asChild variant="outline"><Link href={`/admin/${kind}/${id}/edit`}><Pencil /> Modify</Link></Button>}
          {can(k.perm) && <Button asChild variant="ghost"><Link href={`/admin/${kind}/new`}>Make new</Link></Button>}
        </>} />
      {cancelled && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-base font-medium text-destructive">Cancelled — stock was reversed. Reason: {String(h.cancel_reason ?? "—")}</p>}
      <Card className="mb-4"><CardContent className="grid gap-3 pt-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><p className="text-sm text-muted-foreground">Party</p><p className="font-medium">{String(h.party_name)}</p></div>
        <div><p className="text-sm text-muted-foreground">Vehicle</p><p className="font-medium">{String(h.vehicle_no ?? "—")}</p></div>
        {kind === "inward" && <div><p className="text-sm text-muted-foreground">WB Kgs</p><p className="font-medium tabular-nums">{h.wb_kgs == null ? "—" : fmtKg(h.wb_kgs as number)}</p></div>}
        <div><p className="text-sm text-muted-foreground">Total</p><p className="font-medium tabular-nums">{fmtNum(totalBags)} bags · {fmtKg(totalKgs)}</p></div>
        {h.doc_remarks ? <div className="sm:col-span-2"><p className="text-sm text-muted-foreground">Remarks</p><p>{String(h.doc_remarks)}</p></div> : null}
      </CardContent></Card>
      <Card className="mb-4"><Table>
        <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Product</TableHead><TableHead>Chamber</TableHead><TableHead>Floor</TableHead><TableHead>Rack</TableHead><TableHead className="text-right">Bags</TableHead><TableHead className="text-right">Kgs/bag</TableHead><TableHead className="text-right">Total kgs</TableHead><TableHead className="text-right">Wages/Party</TableHead><TableHead className="text-right">Wages/Labour</TableHead></TableRow></TableHeader>
        <TableBody>{(lines ?? []).map((l) => (
          <TableRow key={l.line_id}><TableCell>{l.line_no}</TableCell><TableCell className="font-medium">{l.product_name}</TableCell><TableCell>{l.chamber_code}</TableCell><TableCell>{l.floor_no}</TableCell><TableCell>{l.rack_code}</TableCell>
            <TableCell className="text-right tabular-nums">{fmtNum(l.bags)}</TableCell><TableCell className="text-right tabular-nums">{fmtNum(l.kgs_per_bag)}</TableCell><TableCell className="text-right tabular-nums">{fmtNum(l.total_kgs)}</TableCell>
            <TableCell className="text-right tabular-nums">{fmtNum(l.wages_party)}</TableCell><TableCell className="text-right tabular-nums">{fmtNum(l.wages_labour)}</TableCell></TableRow>))}
        </TableBody>
      </Table></Card>
      {!cancelled && can(`${kind}.cancel`) && (
        <div className="no-print mb-4"><ConfirmAction label={`Cancel ${kind}`} variant="outline" askReason
          confirmText={kind === "inward" ? "Cancelling removes this stock. It is refused if any of it has already been dispatched." : "Cancelling restores the dispatched stock to the same locations."}
          action={async (reason) => { "use server"; return cancelAction(id, reason); }} /></div>
      )}
      <Card><CardHeader><CardTitle>Stock ledger entries</CardTitle></CardHeader><CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Posted</TableHead><TableHead>Type</TableHead><TableHead>Stock date</TableHead><TableHead className="text-right">Bags</TableHead><TableHead className="text-right">Kgs</TableHead></TableRow></TableHeader>
          <TableBody>{(moves ?? []).map((mv, i) => <TableRow key={i}><TableCell className="whitespace-nowrap">{new Date(mv.created_at).toLocaleString("en-IN")}</TableCell><TableCell>{mv.movement_type.replace("_", " ")}</TableCell><TableCell>{fmtDate(mv.movement_date)}</TableCell><TableCell className="text-right tabular-nums">{mv.bags > 0 ? "+" : ""}{fmtNum(mv.bags)}</TableCell><TableCell className="text-right tabular-nums">{Number(mv.kgs) > 0 ? "+" : ""}{fmtNum(mv.kgs)}</TableCell></TableRow>)}</TableBody>
        </Table>
        {(audit.data ?? []).length > 0 && <p className="mt-3 text-sm text-muted-foreground">{(audit.data ?? []).filter((a) => ["modify", "cancel"].includes(a.action)).length} modification/cancellation event(s) recorded in the audit log.</p>}
      </CardContent></Card>
    </>
  );
}

export async function StockDocNew({ kind, searchParams }: { kind: Kind; searchParams: SP }) {
  const k = C[kind]; const ctx = await requireInternal();
  if (!ctx.can(k.perm)) return <p className="rounded-xl bg-out-soft px-4 py-3 text-base font-medium text-warning">You do not have permission to create {kind} entries.</p>;
  const m = await loadMasters();
  const req = qp(searchParams.request);
  let initParty = ""; let initProduct = ""; let reqId: string | null = null; let reqBags = NaN;
  if (kind === "outward" && isUuid(req)) {
    const supabase = await createClient();
    const { data: r } = await supabase.from("outward_requests").select("id,party_id,product_id,bags_requested,status").eq("id", req!).maybeSingle();
    if (r && r.status === "approved") { initParty = r.party_id; initProduct = r.product_id; reqId = r.id; reqBags = r.bags_requested; }
  }
  const line = { product_id: initProduct, chamber_id: "", floor_id: "", rack_id: "", bags: reqBags, kgs_per_bag: NaN, wages_party: 0, wages_labour: 0, remarks: "" };
  const initial = (kind === "inward"
    ? { inward_date: today(), party_id: "", vehicle_no: "", wb_kgs: null, remarks: "", lines: [{ ...line }] }
    : { outward_date: today(), party_id: initParty, vehicle_no: "", remarks: "", outward_request_id: reqId, lines: [{ ...line }] }) as never;
  return (
    <>
      <PageHeader title={kind === "inward" ? "New Goods In" : "New Goods Out"} description={kind === "inward" ? "Fill in the party, product, bags and where you are storing it" : "Choose the party, then the stock to send out. You cannot send more than is available."} />
      {reqId && <p className="mb-4 rounded-xl bg-muted px-4 py-3 text-base">Fulfilling approved customer request — choose the stock location below.</p>}
      <StockDocForm kind={kind} initial={initial} lockParty={!!reqId} parties={m.parties} products={m.products} chambers={m.chambers} floors={m.floors} racks={m.racks} canAddProduct={ctx.can("product.manage")}
        save={(kind === "inward" ? createInwardAction : createOutwardAction) as never} />
    </>
  );
}

export async function StockDocEdit({ kind, id }: { kind: Kind; id: string }) {
  const k = C[kind]; const ctx = await requireInternal();
  if (!isUuid(id)) notFound();
  if (!ctx.can(`${kind}.update`)) return <p className="rounded-xl bg-out-soft px-4 py-3 text-base font-medium text-warning">You do not have permission to modify {kind} entries.</p>;
  const supabase = await createClient();
  const [{ data: lines }, m] = await Promise.all([supabase.from(k.view).select("*").eq("doc_id", id).order("line_no"), loadMasters({ includeInactive: true })]);
  const h = (lines ?? [])[0];
  if (!h) notFound();
  if (h.status === "cancelled") return <p className="rounded-xl bg-red-50 px-4 py-3 text-base font-medium text-destructive">A cancelled {kind} cannot be modified.</p>;
  const ls = (lines ?? []).map((l) => ({ product_id: l.product_id, chamber_id: l.chamber_id, floor_id: l.floor_id, rack_id: l.rack_id, bags: Number(l.bags), kgs_per_bag: Number(l.kgs_per_bag), wages_party: Number(l.wages_party), wages_labour: Number(l.wages_labour), remarks: "" }));
  const initial = (kind === "inward"
    ? { inward_date: h.doc_date, party_id: h.party_id, vehicle_no: h.vehicle_no ?? "", wb_kgs: h.wb_kgs == null ? null : Number(h.wb_kgs), remarks: h.doc_remarks ?? "", lines: ls }
    : { outward_date: h.doc_date, party_id: h.party_id, vehicle_no: h.vehicle_no ?? "", remarks: h.doc_remarks ?? "", outward_request_id: null, lines: ls }) as never;
  return (
    <>
      <PageHeader title={`Change ${k.title} ${h.doc_no}`} description="The old version is kept in the Activity Log." />
      <StockDocForm kind={kind} docId={id} initial={initial} lockParty={kind === "outward"} parties={m.parties} products={m.products.filter((p) => p.is_active || ls.some((l) => l.product_id === p.id))}
        chambers={m.chambers} floors={m.floors} racks={m.racks} canAddProduct={false}
        save={(kind === "inward" ? createInwardAction : createOutwardAction) as never} update={(kind === "inward" ? updateInwardAction : updateOutwardAction) as never} />
    </>
  );
}
export { monthStart };
