import Link from "next/link";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import type { AuthContext } from "@/lib/auth/context";
import { loadMasters } from "@/lib/data";
import { canRun, runReport } from "@/lib/reports/run";
import { formatCell, type Col, type Section } from "@/lib/reports/engine";
import { PageHeader } from "@/components/shell/page-header";
import { FilterBar, FilterField } from "@/components/shell/filter-bar";
import { PrintButton } from "@/components/shell/print-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const MAX_ROWS = 2000;

function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function QuickRanges({ basePath, f }: { basePath: string; f: { to: string; party?: string; product?: string; chamber?: string; floor?: string } }) {
  const now = new Date(f.to + "T00:00:00");
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const ranges: [string, string, string][] = [
    ["Today", ymd(now), ymd(now)],
    ["This month", ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd(now)],
    ["Last month", ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), ymd(new Date(now.getFullYear(), now.getMonth(), 0))],
    ["This financial year", `${fyStartYear}-04-01`, ymd(now)],
  ];
  const keep = { party: f.party, product: f.product, chamber: f.chamber, floor: f.floor };
  return (
    <div className="no-print mb-3 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Quick dates:</span>
      {ranges.map(([label, from, to]) => {
        const qs = new URLSearchParams({ from, to, ...Object.fromEntries(Object.entries(keep).filter(([, v]) => v) as [string, string][]) });
        return <Link key={label} href={`${basePath}?${qs}`} className="rounded-full border bg-card px-4 py-2 text-base font-medium hover:bg-muted">{label}</Link>;
      })}
    </div>
  );
}

export async function ReportView({ slug, sp, ctx, basePath }: { slug: string; sp: Record<string, string | string[] | undefined>; ctx: AuthContext; basePath: string }) {
  const out = await runReport(slug, sp, ctx);
  if (out.status === "missing") return <p className="text-sm">Report not found.</p>;
  if (out.status === "forbidden") return <p className="rounded-xl bg-out-soft px-4 py-3 text-base font-medium text-warning">You do not have access to this report.</p>;
  const def = out.def;
  const isCustomer = ctx.role === "customer";
  const m = await loadMasters({ includeInactive: true });
  const f = out.f;
  const exportQs = new URLSearchParams(Object.entries({ from: f.from, to: f.to, date: f.date, party: isCustomer ? undefined : f.party, product: f.product, chamber: f.chamber, floor: f.floor }).filter(([, v]) => v) as [string, string][]).toString();
  const has = (k: string) => def.filters.includes(k as never) && !(isCustomer && k === "party");
  const floors = m.floors.filter((x) => !f.chamber || x.chamber_id === f.chamber);
  const badRange = f.from > f.to;

  return (
    <>
      <PageHeader title={def.title} description={def.description}
        actions={out.status === "ok" && !badRange && <>
          <Button asChild variant="outline"><a href={`/api/export/${slug}?format=pdf&${exportQs}`} target="_blank" rel="noopener"><FileText /> PDF</a></Button>
          <Button asChild variant="outline"><a href={`/api/export/${slug}?format=xlsx&${exportQs}`}><FileSpreadsheet /> Excel</a></Button>
          <Button asChild variant="outline"><a href={`/api/export/${slug}?format=csv&${exportQs}`}><Download /> CSV</a></Button>
          <PrintButton />
        </>} />
      {def.provisional && <p className="mb-3 rounded-xl bg-out-soft px-4 py-3 text-base font-medium text-warning">Provisional report: layout and logic need client confirmation.</p>}
      {has("from") && <QuickRanges basePath={basePath} f={f} />}
      <FilterBar resetHref={basePath}>
        {has("date") && <FilterField label="Date"><Input type="date" name="date" defaultValue={f.date} className="h-9" /></FilterField>}
        {has("from") && <FilterField label="From"><Input type="date" name="from" defaultValue={f.from === "2000-01-01" ? "" : f.from} className="h-9" /></FilterField>}
        {has("to") && <FilterField label="To"><Input type="date" name="to" defaultValue={f.to} className="h-9" /></FilterField>}
        {has("party") && <FilterField label="Party"><Select name="party" defaultValue={f.party ?? ""} className="h-9"><option value="">{def.requireParty ? "Select party…" : "All parties"}</option>{m.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></FilterField>}
        {has("product") && <FilterField label="Product"><Select name="product" defaultValue={f.product ?? ""} className="h-9"><option value="">All products</option>{m.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></FilterField>}
        {has("chamber") && <FilterField label="Chamber"><Select name="chamber" defaultValue={f.chamber ?? ""} className="h-9"><option value="">All chambers</option>{m.chambers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></FilterField>}
        {has("floor") && <FilterField label="Floor"><Select name="floor" defaultValue={f.floor ?? ""} className="h-9"><option value="">All floors</option>{floors.map((x) => { const c = m.chambers.find((c) => c.id === x.chamber_id); return <option key={x.id} value={x.id}>{c?.code} · Floor {x.floor_no}</option>; })}</Select></FilterField>}
      </FilterBar>
      {badRange && <p role="alert" className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-base font-medium text-destructive">“From” date must not be after “To” date.</p>}
      {out.status === "needs-party" && !badRange && <p className="rounded-xl bg-muted px-4 py-3 text-base">Select a party above and apply to run this report.</p>}
      {out.status === "ok" && !badRange && (
        <div className="space-y-4">
          {out.result.note && <p className="text-sm text-muted-foreground">{out.result.note}</p>}
          {out.result.sections.length === 0 && <p className="text-sm text-muted-foreground">No data.</p>}
          {out.result.sections.map((s, i) => <SectionTable key={i} section={s} />)}
        </div>
      )}
    </>
  );
}

function SectionTable({ section: s }: { section: Section }) {
  const shown = s.rows.slice(0, MAX_ROWS);
  const cell = (c: Col, v: unknown) => formatCell(v, c.kind);
  return (
    <Card>
      {s.title && <CardHeader><CardTitle>{s.title}</CardTitle></CardHeader>}
      <Table>
        <TableHeader><TableRow>{s.cols.map((c) => <TableHead key={c.key} className={c.align === "right" ? "text-right" : undefined}>{c.label}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {shown.length === 0 && <TableRow><TableCell colSpan={s.cols.length} className="py-6 text-center text-muted-foreground">No records for these filters.</TableCell></TableRow>}
          {shown.map((r, i) => (
            <TableRow key={i} className={r.status === "cancelled" ? "text-muted-foreground line-through" : undefined}>
              {s.cols.map((c) => <TableCell key={c.key} className={c.align === "right" ? "text-right tabular-nums" : c.key === "status" ? "" : undefined}>{c.key === "status" && r[c.key] ? <Badge variant={r[c.key] === "cancelled" ? "destructive" : "success"}>{String(r[c.key])}</Badge> : cell(c, r[c.key])}</TableCell>)}
            </TableRow>
          ))}
          {s.totals && <TableRow className="bg-muted/60 font-semibold">{s.cols.map((c) => <TableCell key={c.key} className={c.align === "right" ? "text-right tabular-nums" : undefined}>{cell(c, s.totals![c.key])}</TableCell>)}</TableRow>}
        </TableBody>
      </Table>
      {s.rows.length > MAX_ROWS && <p className="px-4 py-2 text-sm text-muted-foreground">Showing the first {MAX_ROWS.toLocaleString("en-IN")} of {s.rows.length.toLocaleString("en-IN")} rows. Export for the full data.</p>}
    </Card>
  );
}

export function ReportIndex({ ctx, reports, basePath }: { ctx: AuthContext; reports: import("@/lib/reports/engine").ReportDef[]; basePath: string }) {
  const groups = ["Stock", "Registers", "Party", "Finance", "Labour"] as const;
  const GROUP_LABEL: Record<string, string> = { Stock: "Stock", Registers: "Goods in and out", Party: "Parties", Finance: "Money", Labour: "Labour" };
  return (
    <div className="space-y-6">
      {groups.map((g) => {
        const list = reports.filter((r) => r.group === g && canRun(r, ctx));
        if (!list.length) return null;
        return (
          <section key={g}>
            <h2 className="mb-2 text-base font-semibold">{GROUP_LABEL[g]}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((r) => (
                <Link key={r.slug} href={`${basePath}/${r.slug}`} className="rounded-2xl border bg-card p-4 transition-colors hover:border-primary">
                  <p className="text-base font-semibold">{r.title} {r.provisional && <Badge variant="warning">Provisional</Badge>}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
