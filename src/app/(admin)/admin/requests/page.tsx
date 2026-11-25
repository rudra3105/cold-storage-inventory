import Link from "next/link";
import { requirePermission } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { loadMasters, qp } from "@/lib/data";
import { PageHeader } from "@/components/shell/page-header";
import { FilterBar, FilterField } from "@/components/shell/filter-bar";
import { RequestReview } from "@/components/forms/request-review";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Outward requests" };
export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("request.review");
  const status = qp((await searchParams).status) ?? "pending";
  const supabase = await createClient(); const m = await loadMasters({ includeInactive: true });
  let q = supabase.from("outward_requests").select("*").order("created_at", { ascending: false }).limit(200);
  if (status !== "all") q = q.eq("status", status);
  const { data, error } = await q; if (error) throw new Error(error.message);
  return (<>
    <PageHeader title="Customer Requests" description="Goods your customers asked for. Stock only reduces when you record Goods Out." />
    <FilterBar resetHref="/admin/requests"><FilterField label="Status"><Select name="status" defaultValue={status} className="h-9">{["pending", "approved", "rejected", "fulfilled", "cancelled", "all"].map((s) => <option key={s} value={s}>{s}</option>)}</Select></FilterField></FilterBar>
    <Card><Table>
      <TableHeader><TableRow><TableHead>Request</TableHead><TableHead>Party</TableHead><TableHead>Product</TableHead><TableHead className="text-right">Bags</TableHead><TableHead>Preferred</TableHead><TableHead>Remarks</TableHead><TableHead>Status</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
      <TableBody>
        {(data ?? []).length === 0 && <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">No requests.</TableCell></TableRow>}
        {(data ?? []).map((r) => <TableRow key={r.id}><TableCell>{r.request_no}<br /><span className="text-sm text-muted-foreground">{fmtDate(r.created_at)}</span></TableCell>
          <TableCell>{m.parties.find((p) => p.id === r.party_id)?.name}</TableCell><TableCell>{m.products.find((p) => p.id === r.product_id)?.name}</TableCell>
          <TableCell className="text-right tabular-nums">{r.bags_requested}</TableCell><TableCell>{r.preferred_date ? fmtDate(r.preferred_date) : "—"}</TableCell><TableCell>{r.remarks ?? "—"}{r.review_note && <><br /><span className="text-sm text-muted-foreground">Review: {r.review_note}</span></>}</TableCell>
          <TableCell><Badge variant={r.status === "rejected" || r.status === "cancelled" ? "destructive" : r.status === "pending" ? "warning" : "success"}>{r.status}</Badge></TableCell>
          <TableCell>{r.status === "pending" && <RequestReview id={r.id} />}{r.status === "approved" && <Button asChild size="sm"><Link href={`/admin/outward/new?request=${r.id}`}>Create outward</Link></Button>}</TableCell></TableRow>)}
      </TableBody></Table></Card>
  </>);
}
