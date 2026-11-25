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
import { fmtNum } from "@/lib/utils";

export const metadata = { title: "Product Master" };
const PAGE = 25;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireInternal();
  const sp = await searchParams;
  const q = qp(sp.q)?.replace(/[%,()]/g, " "); const status = qp(sp.status); const page = Math.max(1, Number(qp(sp.page) ?? 1) || 1);
  const supabase = await createClient();
  let query = supabase.from("products").select("id,product_code,name,category,default_unit,default_kgs_per_bag,is_active", { count: "exact" }).order("name").range((page - 1) * PAGE, page * PAGE - 1);
  if (q) query = query.or(`name.ilike.%${q}%,product_code.ilike.%${q}%,category.ilike.%${q}%`);
  if (status === "active") query = query.eq("is_active", true);
  if (status === "inactive") query = query.eq("is_active", false);
  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((p) => p.id);
  const stock = ids.length ? (await supabase.from("stock_balances").select("product_id,available_bags").in("product_id", ids)).data ?? [] : [];
  const bags = (id: string) => stock.filter((s) => s.product_id === id).reduce((a, s) => a + Number(s.available_bags), 0);
  return (
    <>
      <PageHeader title="Products" description="The items you store, like potato or onion" actions={ctx.can("product.manage") && <Button asChild><Link href="/admin/products/new"><Plus /> Add product</Link></Button>} />
      <FilterBar resetHref="/admin/products">
        <FilterField label="Search"><Input name="q" defaultValue={q} placeholder="Name, code, category" className="h-9" /></FilterField>
        <FilterField label="Status"><Select name="status" defaultValue={status ?? ""} className="h-9"><option value="">All</option><option value="active">Active</option><option value="inactive">Inactive</option></Select></FilterField>
      </FilterBar>
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Product</TableHead><TableHead>Category</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">Kgs / bag</TableHead><TableHead className="text-right">Bags in stock</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {(data ?? []).length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No products yet.</TableCell></TableRow>}
            {(data ?? []).map((p) => (
              <TableRow key={p.id}>
                <TableCell>{p.product_code}</TableCell>
                <TableCell className="font-medium"><Link href={`/admin/products/${p.id}`} className="text-primary hover:underline">{p.name}</Link></TableCell>
                <TableCell>{p.category ?? "—"}</TableCell><TableCell>{p.default_unit}</TableCell>
                <TableCell className="text-right tabular-nums">{p.default_kgs_per_bag ? fmtNum(p.default_kgs_per_bag) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtNum(bags(p.id))}</TableCell>
                <TableCell><Badge variant={p.is_active ? "success" : "warning"}>{p.is_active ? "Active" : "Inactive"}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Pagination page={page} pageSize={PAGE} total={count ?? 0} basePath="/admin/products" params={{ q, status }} />
    </>
  );
}
