import { requirePermission } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { PermissionToggle, SettingsForm } from "@/components/forms/admin-forms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Settings" };
const ROLES = ["manager", "staff", "accountant"] as const;
export default async function SettingsPage() {
  const ctx = await requirePermission("settings.manage");
  const supabase = await createClient();
  const [{ data: s }, { data: cat }, { data: rp }] = await Promise.all([
    supabase.from("business_settings").select("*").maybeSingle(),
    supabase.from("permissions_catalog").select("key,category,description").order("category").order("key"),
    supabase.from("role_permissions").select("role,permission,allowed"),
  ]);
  if (!s) throw new Error("Business settings row is missing; run the seed migration.");
  const allowed = (role: string, perm: string) => !!rp?.find((r) => r.role === role && r.permission === perm)?.allowed;
  return (<>
    <PageHeader title="Settings" description="Your business name and address (printed on receipts and bills) and customer options." />
    <SettingsForm initial={{ business_name: s.business_name, address: s.address ?? "", phone: s.phone ?? "", email: s.email ?? "", gst_number: s.gst_number ?? "", invoice_terms: s.invoice_terms ?? "", customer_can_see_rack: s.customer_can_see_rack, outward_requests_enabled: s.outward_requests_enabled }} />
    <Card className="mt-8"><CardHeader><CardTitle>Role permissions</CardTitle></CardHeader><CardContent>
      <p className="mb-3 text-sm text-muted-foreground">The Owner always has every permission. {ctx.role === "super_admin" ? "Changes apply immediately." : "Only the Owner can change these."}</p>
      <Table><TableHeader><TableRow><TableHead>Permission</TableHead><TableHead>Category</TableHead>{ROLES.map((r) => <TableHead key={r} className="text-center capitalize">{r}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{(cat ?? []).map((p) => <TableRow key={p.key}><TableCell><span className="font-medium">{p.key}</span><br /><span className="text-sm text-muted-foreground">{p.description}</span></TableCell><TableCell>{p.category}</TableCell>
          {ROLES.map((r) => <TableCell key={r} className="text-center">{ctx.role === "super_admin" ? <PermissionToggle role={r} permission={p.key} allowed={allowed(r, p.key)} /> : <span>{allowed(r, p.key) ? "Yes" : "No"}</span>}</TableCell>)}</TableRow>)}</TableBody></Table>
    </CardContent></Card></>);
}
