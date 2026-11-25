import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireInternal } from "@/lib/auth/context";
import { isUuid } from "@/lib/data";
import { PageHeader } from "@/components/shell/page-header";
import { Stat } from "@/components/shell/stat";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PartyForm } from "@/components/forms/party-form";
import { CredentialForm } from "@/components/forms/login-admin";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { createCustomerLogin, resetLoginPassword, setLoginActive, setPartyActive } from "../actions";
import { fmtMoney, fmtNum, fmtKg } from "@/lib/utils";

export const metadata = { title: "Party" };

export default async function PartyPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireInternal();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: p } = await supabase.from("parties").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();

  const [{ data: stock }, { data: bal }, login] = await Promise.all([
    supabase.from("v_stock_detail").select("product_name,chamber_code,floor_no,rack_code,available_bags,available_kgs").eq("party_id", id).gt("available_bags", 0).order("product_name"),
    ctx.can("billing.view") ? supabase.from("party_ledger_balances").select("balance").eq("party_id", id).maybeSingle() : Promise.resolve({ data: null }),
    p.user_id ? supabase.from("profiles").select("is_active").eq("id", p.user_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const totalBags = (stock ?? []).reduce((a, s) => a + Number(s.available_bags), 0);
  const totalKgs = (stock ?? []).reduce((a, s) => a + Number(s.available_kgs), 0);
  const canLogin = ctx.can("staff.manage");

  return (
    <>
      <PageHeader title={p.name} description={`${p.party_code}${p.city ? " · " + p.city : ""}`}
        actions={<>
          {ctx.can("billing.view") && <Button asChild variant="outline"><Link href={`/admin/reports/ledger?party=${id}`}>Ledger</Link></Button>}
          <Button asChild variant="outline"><Link href={`/admin/reports/party-history?party=${id}`}>Transactions</Link></Button>
          <Badge variant={p.is_active ? "success" : "warning"}>{p.is_active ? "Active" : "Inactive"}</Badge>
        </>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Bags in stock" value={fmtNum(totalBags)} sub={fmtKg(totalKgs)} />
        <Stat label="Products in stock" value={fmtNum(new Set((stock ?? []).map((s) => s.product_name)).size)} />
        {bal && <Stat label="Ledger balance" value={fmtMoney(bal.balance)} sub="positive = party owes us" />}
        <Stat label="Opening balance" value={fmtMoney(p.opening_balance)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent>
            <PartyForm id={id} canEdit={ctx.can("party.manage")} initial={{
              name: p.name, contact_person: p.contact_person ?? "", mobile: p.mobile ?? "", email: p.email ?? "", address: p.address ?? "", city: p.city ?? "",
              state: p.state ?? "", gst_number: p.gst_number ?? "", opening_balance: Number(p.opening_balance), remarks: p.remarks ?? "" }} />
            {ctx.can("party.manage") && (
              <div className="mt-5 border-t pt-4">
                <ConfirmAction label={p.is_active ? "Deactivate party" : "Activate party"} variant="outline"
                  confirmText={p.is_active ? "Deactivating blocks new transactions and removes the customer's portal access. Stock and history are kept." : "Reactivate this party?"}
                  action={async () => { "use server"; return setPartyActive(id, !p.is_active); }} />
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Customer portal login</CardTitle><CardDescription>Lets this party see its own stock and documents</CardDescription></CardHeader>
          <CardContent>
            {p.user_id ? (
              <div className="space-y-4">
                <p className="text-sm">Login status: {login.data?.is_active ? <Badge variant="success">Enabled</Badge> : <Badge variant="warning">Disabled</Badge>}</p>
                {canLogin ? (<>
                  <CredentialForm mode="reset" submitLabel="Reset password" action={async (_e, pw) => { "use server"; return resetLoginPassword(p.user_id!, pw); }} />
                  <ConfirmAction label={login.data?.is_active ? "Disable login" : "Enable login"} confirmText="Change portal access for this customer?"
                    action={async () => { "use server"; return setLoginActive(p.user_id!, !login.data?.is_active); }} />
                </>) : <p className="text-sm text-muted-foreground">Only users who can manage staff may change logins.</p>}
              </div>
            ) : canLogin ? (
              <CredentialForm mode="create" defaultEmail={p.email ?? ""} submitLabel="Create login" action={async (email, pw) => { "use server"; return createCustomerLogin(id, email, pw); }} />
            ) : <p className="text-sm text-muted-foreground">No login yet. Ask the Owner to create one.</p>}
          </CardContent>
        </Card>
      </div>
      <Card className="mt-4">
        <CardHeader><CardTitle>Current stock</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Chamber</TableHead><TableHead>Floor</TableHead><TableHead>Rack</TableHead><TableHead className="text-right">Bags</TableHead><TableHead className="text-right">Kgs</TableHead></TableRow></TableHeader>
            <TableBody>
              {(stock ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No stock held.</TableCell></TableRow>}
              {(stock ?? []).map((s, i) => (
                <TableRow key={i}><TableCell className="font-medium">{s.product_name}</TableCell><TableCell>{s.chamber_code}</TableCell><TableCell>{s.floor_no}</TableCell><TableCell>{s.rack_code}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtNum(s.available_bags)}</TableCell><TableCell className="text-right tabular-nums">{fmtNum(s.available_kgs)}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
