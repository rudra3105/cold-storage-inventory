import { requireCustomer } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { CancelRequestButton, RequestForm } from "@/components/forms/request-form";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Outward requests" };
export default async function PortalRequests() {
  await requireCustomer();
  const supabase = await createClient();
  const [{ data: settings }, { data: reqs }, { data: bal }, { data: products }] = await Promise.all([
    supabase.from("business_settings").select("outward_requests_enabled").maybeSingle(),
    supabase.from("outward_requests").select("*").order("created_at", { ascending: false }).limit(100),
    supabase.from("stock_balances").select("product_id,available_bags"),
    supabase.from("products").select("id,name"),
  ]);
  const byProduct = new Map<string, number>(); (bal ?? []).forEach((b) => byProduct.set(b.product_id, (byProduct.get(b.product_id) ?? 0) + Number(b.available_bags)));
  const options = [...byProduct.entries()].filter(([, n]) => n > 0).map(([id, n]) => ({ id, label: products?.find((p) => p.id === id)?.name ?? "—", bags: n }));
  return (<>
    <PageHeader title="Request Goods" description="Tell the warehouse what you want delivered. Your stock reduces only after they actually send it." />
    {settings?.outward_requests_enabled === false ? <p className="mb-4 rounded-xl bg-muted px-4 py-3 text-base">Online requests are currently switched off. Please contact the warehouse.</p>
      : options.length === 0 ? <p className="mb-4 rounded-xl bg-muted px-4 py-3 text-base">You have no stock available to request.</p> : <div className="mb-6"><RequestForm products={options} /></div>}
    <Card><Table><TableHeader><TableRow><TableHead>Request</TableHead><TableHead>Date</TableHead><TableHead>Product</TableHead><TableHead className="text-right">Bags</TableHead><TableHead>Status</TableHead><TableHead>Note</TableHead><TableHead /></TableRow></TableHeader>
      <TableBody>{(reqs ?? []).length === 0 && <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">No requests yet.</TableCell></TableRow>}
        {(reqs ?? []).map((r) => <TableRow key={r.id}><TableCell>{r.request_no}</TableCell><TableCell>{fmtDate(r.created_at)}</TableCell><TableCell>{products?.find((p) => p.id === r.product_id)?.name}</TableCell><TableCell className="text-right tabular-nums">{r.bags_requested}</TableCell>
          <TableCell><Badge variant={r.status === "rejected" || r.status === "cancelled" ? "destructive" : r.status === "pending" ? "warning" : "success"}>{r.status}</Badge></TableCell><TableCell>{r.review_note ?? "—"}</TableCell>
          <TableCell>{r.status === "pending" && <CancelRequestButton id={r.id} />}</TableCell></TableRow>)}</TableBody></Table></Card></>);
}
