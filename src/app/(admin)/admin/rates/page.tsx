import { requirePermission } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { loadMasters, today } from "@/lib/data";
import { PageHeader } from "@/components/shell/page-header";
import { ChargeActiveButton, ChargeTypeForm, EndRateButton, PartyRateForm } from "@/components/forms/admin-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtMoney } from "@/lib/utils";

export const metadata = { title: "Charges & rates" };
export default async function RatesPage() {
  const ctx = await requirePermission("billing.view");
  const manage = ctx.can("billing.manage");
  const supabase = await createClient(); const m = await loadMasters({ includeInactive: true });
  const [{ data: charges }, { data: rates }] = await Promise.all([
    supabase.from("charge_types").select("*").order("name"),
    supabase.from("party_rates").select("*").order("effective_from", { ascending: false }).limit(300),
  ]);
  return (<>
    <PageHeader title="Charges & Rates" description="Your price list. When you make a bill, these prices fill in automatically and you can change them." />
    <Card className="mb-6"><CardHeader><CardTitle>Charge types</CardTitle></CardHeader><CardContent className="space-y-3">
      {manage && <ChargeTypeForm />}
      <Table><TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Basis</TableHead><TableHead className="text-right">Default rate</TableHead><TableHead>Status</TableHead>{manage && <TableHead />}</TableRow></TableHeader>
        <TableBody>{(charges ?? []).map((c) => <TableRow key={c.id}><TableCell>{c.code}</TableCell><TableCell>{c.name}</TableCell><TableCell>{c.basis.replaceAll("_", " ")}</TableCell><TableCell className="text-right tabular-nums">{c.default_rate == null ? "—" : fmtMoney(c.default_rate)}</TableCell>
          <TableCell><Badge variant={c.is_active ? "success" : "warning"}>{c.is_active ? "Active" : "Inactive"}</Badge></TableCell>{manage && <TableCell><ChargeActiveButton id={c.id} active={c.is_active} /></TableCell>}</TableRow>)}</TableBody></Table>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Party-specific rates</CardTitle></CardHeader><CardContent className="space-y-3">
      {manage && <PartyRateForm today={today()} parties={m.parties.map((p) => ({ id: p.id, name: p.name }))} charges={(charges ?? []).filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name }))} />}
      <Table><TableHeader><TableRow><TableHead>Party</TableHead><TableHead>Charge</TableHead><TableHead className="text-right">Rate</TableHead><TableHead>From</TableHead><TableHead>To</TableHead>{manage && <TableHead />}</TableRow></TableHeader>
        <TableBody>{(rates ?? []).length === 0 && <TableRow><TableCell colSpan={6} className="py-4 text-center text-muted-foreground">No party rates set.</TableCell></TableRow>}
          {(rates ?? []).map((r) => <TableRow key={r.id}><TableCell>{m.parties.find((p) => p.id === r.party_id)?.name}</TableCell><TableCell>{charges?.find((c) => c.id === r.charge_type_id)?.name}</TableCell><TableCell className="text-right tabular-nums">{fmtMoney(r.rate)}</TableCell>
            <TableCell>{fmtDate(r.effective_from)}</TableCell><TableCell>{r.effective_to ? fmtDate(r.effective_to) : "open"}</TableCell>{manage && <TableCell>{!r.effective_to && <EndRateButton id={r.id} date={today()} />}</TableCell>}</TableRow>)}</TableBody></Table>
    </CardContent></Card></>);
}
