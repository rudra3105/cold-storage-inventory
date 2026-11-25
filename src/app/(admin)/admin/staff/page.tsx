import { requirePermission } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { StaffForm, StaffRowActions } from "@/components/forms/admin-forms";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Staff" };
const LABEL: Record<string, string> = { super_admin: "Owner", manager: "Manager", staff: "Warehouse staff", accountant: "Accountant" };
export default async function StaffPage() {
  const ctx = await requirePermission("staff.manage");
  const supabase = await createClient();
  const [{ data: roles }, { data: profs }] = await Promise.all([supabase.from("user_roles").select("user_id,role").neq("role", "customer"), supabase.from("profiles").select("id,full_name,phone,is_active")]);
  const rows = (roles ?? []).map((r) => ({ ...r, p: profs?.find((p) => p.id === r.user_id) })).filter((r) => r.p).sort((a, b) => a.p!.full_name.localeCompare(b.p!.full_name));
  return (<>
    <PageHeader title="Staff" description="Your employees who use this software. Turn off a person to stop their access." />
    <div className="mb-6"><StaffForm /></div>
    <Card><Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Phone</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead>Manage</TableHead></TableRow></TableHeader>
      <TableBody>{rows.map((r) => <TableRow key={r.user_id}><TableCell className="font-medium">{r.p!.full_name}</TableCell><TableCell>{r.p!.phone ?? "—"}</TableCell><TableCell>{LABEL[r.role]}</TableCell>
        <TableCell><Badge variant={r.p!.is_active ? "success" : "warning"}>{r.p!.is_active ? "Active" : "Disabled"}</Badge></TableCell>
        <TableCell><StaffRowActions userId={r.user_id} role={r.role} active={r.p!.is_active} self={r.user_id === ctx.userId} owner={r.role === "super_admin"} /></TableCell></TableRow>)}</TableBody></Table></Card>
  </>);
}
