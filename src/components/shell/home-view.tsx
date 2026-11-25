import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, BarChart3, Boxes, Check, HandCoins, Receipt, type LucideIcon } from "lucide-react";
import { Stat } from "@/components/shell/stat";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, fmtDate, fmtKg, fmtNum } from "@/lib/utils";

export type HomeData = {
  firstName: string;
  greeting: string;
  dateLine: string;
  can: { inward: boolean; outward: boolean; billing: boolean; reports: boolean; setup: boolean; requests: boolean };
  summary: { stock_bags: number; stock_kgs: number; today_inward_bags: number; today_outward_bags: number; pending_requests: number };
  setup: { href: string; label: string; done: boolean }[];
  chambers: { id: string; name: string; bags: number; floors: { id: string; floor_no: number; bags: number }[] }[];
  recent: { id: string; kind: "Inward" | "Outward"; no: string; date: string; party: string; bags: number; status: string }[];
};

function Action({ href, icon: Icon, title, sub, tone }: { href: string; icon: LucideIcon; title: string; sub: string; tone: "in" | "out" }) {
  return (
    <Link href={href} className={cn("flex items-center gap-4 rounded-2xl px-6 py-5 text-white transition-[filter,transform] hover:brightness-95 active:translate-y-px", tone === "in" ? "bg-in" : "bg-out")}>
      <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white/20 [&_svg]:size-7"><Icon /></span>
      <span className="leading-tight"><span className="block text-2xl font-bold">{title}</span><span className="mt-1 block text-base text-white/90">{sub}</span></span>
    </Link>
  );
}

function QuickLink({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <Link href={href} className="inline-flex h-12 items-center gap-2.5 rounded-xl border border-input bg-card px-4 text-base font-semibold hover:bg-muted [&_svg]:size-5 [&_svg]:text-primary"><Icon />{label}</Link>
  );
}

export function HomeView({ d }: { d: HomeData }) {
  const maxFloor = Math.max(1, ...d.chambers.flatMap((c) => c.floors.map((f) => f.bags)));
  const floorNos = [...new Set(d.chambers.flatMap((c) => c.floors.map((f) => f.floor_no)))].sort((a, b) => b - a);
  const openSetup = d.setup.some((x) => !x.done) && d.can.setup;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[32px] font-bold leading-tight tracking-tight">{d.greeting}, {d.firstName}</h1>
        <p className="mt-1 text-base text-muted-foreground">{d.dateLine}</p>
      </div>

      {openSetup && (
        <Card className="border-primary/40 bg-primary-soft/40">
          <CardHeader><CardTitle>Set up your warehouse</CardTitle><CardDescription>Do these three things once, in this order. After that you can record goods.</CardDescription></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            {d.setup.map((x, n) => (
              <Link key={x.href} href={x.href} className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:border-primary">
                <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-base font-bold", x.done ? "bg-in text-white" : "bg-primary text-white")}>{x.done ? <Check className="size-5" /> : n + 1}</span>
                <span className="text-base font-semibold leading-snug">{x.label}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <section aria-label="What do you want to do?" className="space-y-3">
        {(d.can.inward || d.can.outward) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {d.can.inward && <Action href="/admin/inward/new" icon={ArrowDownToLine} title="Goods In" sub="Goods have arrived" tone="in" />}
            {d.can.outward && <Action href="/admin/outward/new" icon={ArrowUpFromLine} title="Goods Out" sub="Goods are leaving" tone="out" />}
          </div>
        )}
        <div className="flex flex-wrap gap-2.5">
          <QuickLink href="/admin/inventory" icon={Boxes} label="Check stock" />
          {d.can.billing && <QuickLink href="/admin/receipts/new" icon={HandCoins} label="Money received" />}
          {d.can.billing && <QuickLink href="/admin/invoices/new" icon={Receipt} label="Make a bill" />}
          {d.can.reports && <QuickLink href="/admin/reports" icon={BarChart3} label="Reports" />}
        </div>
      </section>

      {d.can.requests && d.summary.pending_requests > 0 && (
        <Link href="/admin/requests" className="flex items-center justify-between gap-3 rounded-2xl bg-out-soft px-5 py-4 text-base font-semibold text-warning hover:brightness-95">
          <span>{d.summary.pending_requests} customer request{d.summary.pending_requests === 1 ? " is" : "s are"} waiting for you</span>
          <span className="underline">Open requests</span>
        </Link>
      )}

      <section aria-label="Today" className="grid grid-cols-3 gap-4 sm:gap-8">
        <Stat label="In warehouse" value={fmtNum(d.summary.stock_bags)} sub={<>bags<span className="hidden sm:inline"> · {fmtKg(d.summary.stock_kgs)}</span></>} />
        <Stat className="border-in" label="Came in today" value={fmtNum(d.summary.today_inward_bags)} sub="bags" />
        <Stat className="border-out" label="Went out today" value={fmtNum(d.summary.today_outward_bags)} sub="bags" />
      </section>

      <Card>
        <CardHeader><CardTitle>Your warehouse</CardTitle><CardDescription>Bags on every floor. Darker means fuller. Tap a floor to see what is stored there.</CardDescription></CardHeader>
        <CardContent>
          {d.chambers.length === 0 ? <p className="text-base text-muted-foreground">No rooms set up yet.</p> : (
            <div className="grid gap-x-2 gap-y-2" style={{ gridTemplateColumns: `3.5rem repeat(${d.chambers.length}, minmax(0, 1fr))` }}>
              <span />
              {d.chambers.map((c) => (
                <Link key={c.id} href={`/admin/inventory?chamber=${c.id}`} className="rounded-lg px-1 pb-1 text-center hover:bg-muted">
                  <span className="block text-lg font-bold">{c.name}</span>
                  <span className="block text-sm text-muted-foreground tabular-nums">{fmtNum(c.bags)}<span className="hidden sm:inline"> bags</span></span>
                </Link>
              ))}
              {floorNos.map((n) => (
                <FloorRow key={n} n={n} chambers={d.chambers} max={maxFloor} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Latest entries</CardTitle></CardHeader>
        <CardContent className="px-2 sm:px-3">
          {d.recent.length === 0 ? (
            <p className="px-3 py-6 text-base text-muted-foreground">Nothing recorded yet. Press Goods In when the first goods arrive.</p>
          ) : (
            <ul className="divide-y">
              {d.recent.map((r) => (
                <li key={r.kind + r.id}>
                  <Link href={`/admin/${r.kind === "Inward" ? "inward" : "outward"}/${r.id}`} className="flex items-center gap-4 rounded-xl px-3 py-3 hover:bg-muted">
                    <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-full [&_svg]:size-5", r.kind === "Inward" ? "bg-in-soft text-in" : "bg-out-soft text-out")}>{r.kind === "Inward" ? <ArrowDownToLine /> : <ArrowUpFromLine />}</span>
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className={cn("block truncate text-base font-semibold", r.status === "cancelled" && "text-muted-foreground line-through")}>{r.party}</span>
                      <span className="block truncate text-sm text-muted-foreground">{r.kind === "Inward" ? "Goods in" : "Goods out"} · {r.no}{r.status === "cancelled" ? " · cancelled" : ""}</span>
                    </span>
                    <span className="text-right leading-tight"><span className="block text-base font-bold tabular-nums">{fmtNum(r.bags)} bags</span><span className="block text-sm text-muted-foreground">{fmtDate(r.date)}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FloorRow({ n, chambers, max }: { n: number; chambers: HomeData["chambers"]; max: number }) {
  return (
    <>
      <span className="flex items-center text-sm font-semibold text-muted-foreground">Floor {n}</span>
      {chambers.map((c) => {
        const f = c.floors.find((x) => x.floor_no === n);
        if (!f) return <span key={c.id} className="rounded-xl border border-dashed" />;
        const mix = Math.round(10 + (f.bags / max) * 80);
        const dark = mix >= 66;
        return (
          <Link key={c.id} href={`/admin/inventory?chamber=${c.id}&floor=${f.id}`}
            className={cn("flex h-14 items-center justify-center rounded-xl border text-lg font-bold tabular-nums transition-[filter] hover:brightness-95", f.bags === 0 ? "border-dashed bg-card text-muted-foreground" : dark ? "border-transparent text-white" : "border-transparent text-foreground")}
            style={f.bags === 0 ? undefined : { backgroundColor: `color-mix(in srgb, var(--primary) ${mix}%, white)` }}
            aria-label={`${c.name}, floor ${n}: ${f.bags} bags`}>
            {f.bags === 0 ? "empty" : fmtNum(f.bags)}
          </Link>
        );
      })}
    </>
  );
}
