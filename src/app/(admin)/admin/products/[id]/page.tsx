import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireInternal } from "@/lib/auth/context";
import { isUuid } from "@/lib/data";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProductForm } from "@/components/forms/product-form";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { setProductActive } from "../actions";
import { fmtNum } from "@/lib/utils";

export const metadata = { title: "Product" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireInternal();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: p } = await supabase.from("products").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();
  const { data: stock } = await supabase.from("v_stock_detail").select("party_name,chamber_code,floor_no,rack_code,available_bags,available_kgs").eq("product_id", id).gt("available_bags", 0).order("party_name");
  return (
    <>
      <PageHeader title={p.name} description={p.product_code} actions={<Badge variant={p.is_active ? "success" : "warning"}>{p.is_active ? "Active" : "Inactive"}</Badge>} />
      <Card className="mb-4"><CardContent className="pt-5">
        <ProductForm id={id} canEdit={ctx.can("product.manage")} initial={{ name: p.name, category: p.category ?? "", description: p.description ?? "", default_unit: p.default_unit, default_kgs_per_bag: p.default_kgs_per_bag ? Number(p.default_kgs_per_bag) : null }} />
        {ctx.can("product.manage") && <div className="mt-5 border-t pt-4"><ConfirmAction label={p.is_active ? "Deactivate product" : "Activate product"} confirmText={p.is_active ? "Inactive products cannot be selected on new transactions. Existing stock and history are kept." : "Reactivate this product?"} action={async () => { "use server"; return setProductActive(id, !p.is_active); }} /></div>}
      </CardContent></Card>
      <Card>
        <CardHeader><CardTitle>Stock of this product</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Party</TableHead><TableHead>Chamber</TableHead><TableHead>Floor</TableHead><TableHead>Rack</TableHead><TableHead className="text-right">Bags</TableHead><TableHead className="text-right">Kgs</TableHead></TableRow></TableHeader>
            <TableBody>
              {(stock ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">None in stock.</TableCell></TableRow>}
              {(stock ?? []).map((s, i) => <TableRow key={i}><TableCell className="font-medium">{s.party_name}</TableCell><TableCell>{s.chamber_code}</TableCell><TableCell>{s.floor_no}</TableCell><TableCell>{s.rack_code}</TableCell><TableCell className="text-right tabular-nums">{fmtNum(s.available_bags)}</TableCell><TableCell className="text-right tabular-nums">{fmtNum(s.available_kgs)}</TableCell></TableRow>)}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
