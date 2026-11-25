import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireCustomer } from "@/lib/auth/context";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shell/page-header";
import { Stat } from "@/components/shell/stat";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtKg, fmtNum } from "@/lib/utils";

export const metadata = { title: "My stock" };

type Bal = { product_id: string; rack_id: string; floor_id: string; chamber_id: string; inward_bags: number; outward_bags: number; available_bags: number; available_kgs: string };

export default async function PortalHome() {
  const ctx = await requireCustomer();
  const supabase = await createClient();
  // RLS limits every query below to this customer's party; no party filter is relied upon for security.
  const [{ data: bal, error }, { data: products }, { data: racks }, { data: floors }, { data: chambers }, { data: settings }] = await Promise.all([
    supabase.from("stock_balances").select("*").gt("available_bags", 0),
    supabase.from("products").select("id,name"),
    supabase.from("racks").select("id,code"),
    supabase.from("floors").select("id,floor_no"),
    supabase.from("chambers").select("id,code"),
    supabase.from("business_settings").select("customer_can_see_rack").maybeSingle(),
  ]);
  if (error) throw new Error(`Could not load your stock: ${error.message}`);
  const rows = (bal ?? []) as Bal[];
  const showRack = settings?.customer_can_see_rack ?? true;
  const name = (list: { id: string; [k: string]: unknown }[] | null, id: string, key: string) => String(list?.find((x) => x.id === id)?.[key] ?? "—");

  const { data: all } = await supabase.from("stock_balances").select("inward_bags,outward_bags,available_bags,available_kgs,product_id");
  const t = (all ?? []).reduce((a, r) => ({ inw: a.inw + Number(r.inward_bags), out: a.out + Number(r.outward_bags), bags: a.bags + Number(r.available_bags), kgs: a.kgs + Number(r.available_kgs) }), { inw: 0, out: 0, bags: 0, kgs: 0 });
  const productCount = new Set((all ?? []).filter((r) => Number(r.available_bags) > 0).map((r) => r.product_id)).size;

  return (
    <>
      <PageHeader title={`Welcome, ${ctx.fullName}`} description="This is the stock we are keeping for you." actions={<Button asChild size="lg"><Link href="/portal/requests">Request goods</Link></Button>} />
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Summary">
        <Stat label="Bags we hold for you" value={fmtNum(t.bags)} />
        <Stat label="Total weight" value={fmtNum(t.kgs)} sub="kg" />
        <Stat label="Products" value={fmtNum(productCount)} />
      </section>
      <Card className="mt-5">
        <CardHeader><CardTitle>Your goods</CardTitle><CardDescription>Where your goods are stored right now</CardDescription></CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">You have no goods in storage right now.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Product</TableHead><TableHead>Room</TableHead><TableHead>Floor</TableHead>{showRack && <TableHead>Rack</TableHead>}
                <TableHead className="text-right">Bags</TableHead><TableHead className="text-right">Weight</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.product_id}${r.rack_id}`}>
                    <TableCell className="font-medium">{name(products, r.product_id, "name")}</TableCell>
                    <TableCell>{name(chambers, r.chamber_id, "code")}</TableCell>
                    <TableCell>Floor {name(floors, r.floor_id, "floor_no")}</TableCell>
                    {showRack && <TableCell>{name(racks, r.rack_id, "code")}</TableCell>}
                    <TableCell className="text-right tabular-nums">{fmtNum(r.available_bags)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtKg(r.available_kgs)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
