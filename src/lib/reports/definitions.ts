import "server-only";
import { fetchAll, sum, totalsRow, type Col, type ReportDef, type Row, type RunCtx, type Section } from "./engine";

const tx = (key: string, label: string, weight = 1): Col => ({ key, label, weight });
const nm = (key: string, label: string, weight = 1): Col => ({ key, label, kind: "number", align: "right", weight });
const mn = (key: string, label: string, weight = 1): Col => ({ key, label, kind: "money", align: "right", weight });
const dt = (key: string, label: string, weight = 1): Col => ({ key, label, kind: "date", weight });

type Q = { eq: (c: string, v: unknown) => Q; gte: (c: string, v: unknown) => Q; lte: (c: string, v: unknown) => Q; order: (c: string, o?: { ascending: boolean }) => Q; range: (a: number, b: number) => Q; gt: (c: string, v: unknown) => Q } & PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
function scope(q: Q, f: RunCtx["f"], opts: { party?: boolean; product?: boolean; chamber?: boolean; floor?: boolean } = { party: true, product: true, chamber: true, floor: true }) {
  if (opts.party && f.party) q = q.eq("party_id", f.party);
  if (opts.product && f.product) q = q.eq("product_id", f.product);
  if (opts.chamber && f.chamber) q = q.eq("chamber_id", f.chamber);
  if (opts.floor && f.floor) q = q.eq("floor_id", f.floor);
  return q;
}
const movCols = (kind: "inward" | "outward"): Col[] => [
  dt("doc_date", "Date"), tx("doc_no", kind === "inward" ? "Inward No." : "Outward No.", 1.3), tx("party_name", "Party", 1.6), tx("product_name", "Product", 1.4),
  tx("chamber_code", "Chamber"), nm("floor_no", "Floor"), tx("rack_code", "Rack"), nm("bags", "Bags"), nm("kgs_per_bag", "Kgs/Bag"), nm("total_kgs", "Total Kgs"),
  ...(kind === "inward" ? [nm("wb_kgs", "WB Kgs")] : []), tx("vehicle_no", "Vehicle", 1.2), nm("wages_party", "Wages/Party"), nm("wages_labour", "Wages/Labour"), tx("status", "Status"),
];

async function register(c: RunCtx, kind: "inward" | "outward", from: string, to: string): Promise<{ sections: Section[] }> {
  const view = kind === "inward" ? "v_inward_lines" : "v_outward_lines";
  const rows = await fetchAll<Row>((a, b) => scope(c.supabase.from(view).select("*").gte("doc_date", from).lte("doc_date", to).order("doc_date").order("doc_no").order("line_no").range(a, b) as unknown as Q, c.f));
  const live = rows.filter((r) => r.status === "active");
  return { sections: [{ cols: movCols(kind), rows, totals: { ...totalsRow(live, ["bags", "total_kgs", "wages_party", "wages_labour"], { key: "party_name", text: "Total (active entries)" }) } }] };
}

async function labour(c: RunCtx, kind: "inward" | "outward") {
  const rows = await fetchAll<Row>((a, b) => {
    let q = c.supabase.from("v_labour").select("*").eq("kind", kind).gte("record_date", c.f.from).lte("record_date", c.f.to).order("record_date").range(a, b) as unknown as Q;
    if (c.f.party) q = q.eq("party_id", c.f.party);
    if (c.f.product) q = q.eq("product_id", c.f.product);
    return q;
  });
  const live = rows.filter((r) => r.status === "active");
  return { sections: [{ cols: [dt("record_date", "Date"), tx("doc_no", kind === "inward" ? "Inward No." : "Outward No.", 1.3), tx("party_name", "Party", 1.6), tx("product_name", "Product", 1.4), nm("bags", "Bags"), nm("wages_labour", "Wages / Labour"), nm("wages_party", "Wages / Party"), tx("status", "Status")],
    rows, totals: totalsRow(live, ["bags", "wages_labour", "wages_party"], { key: "party_name", text: "Total (active entries)" }) }] };
}

async function stockRegister(c: RunCtx, from: string, to: string) {
  const { data, error } = await c.supabase.rpc("stock_register", { p_from: from, p_to: to, p_party: c.f.party ?? null, p_product: c.f.product ?? null, p_chamber: c.f.chamber ?? null, p_floor: c.f.floor ?? null });
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}
const regCols: Col[] = [tx("party_name", "Party", 1.6), tx("product_name", "Product", 1.4), nm("opening_bags", "Opening Bags"), nm("opening_kgs", "Opening Kgs"), nm("inward_bags", "Inward Bags"), nm("inward_kgs", "Inward Kgs"),
  nm("outward_bags", "Outward Bags"), nm("outward_kgs", "Outward Kgs"), nm("adjustment_bags", "Adj. Bags"), nm("closing_bags", "Closing Bags"), nm("closing_kgs", "Closing Kgs")];
const regKeys = ["opening_bags", "opening_kgs", "inward_bags", "inward_kgs", "outward_bags", "outward_kgs", "adjustment_bags", "closing_bags", "closing_kgs"];

async function stockDetail(c: RunCtx) {
  return fetchAll<Row>((a, b) => scope(c.supabase.from("v_stock_detail").select("*").gt("available_bags", 0).order("party_name").order("product_name").order("chamber_code").order("floor_no").range(a, b) as unknown as Q, c.f));
}
const stockCols: Col[] = [tx("party_name", "Party", 1.6), tx("product_name", "Product", 1.4), tx("chamber_code", "Chamber"), nm("floor_no", "Floor"), tx("rack_code", "Rack"),
  nm("inward_bags", "Inward Bags"), nm("outward_bags", "Outward Bags"), nm("available_bags", "Available Bags"), nm("inward_kgs", "Inward Kgs"), nm("outward_kgs", "Outward Kgs"), nm("available_kgs", "Available Kgs")];

export const REPORTS: ReportDef[] = [
  { slug: "rojmel", title: "Daily Book (Rojmel)", description: "Everything recorded on one day: goods in, goods out, money received and paid. Layout to be confirmed with the client.", group: "Registers", permission: "reports.view", filters: ["date"], defaults: "today", provisional: true,
    async run(c) {
      const { data, error } = await c.supabase.rpc("rojmel", { p_date: c.f.date });
      if (error) throw new Error(error.message);
      const rows = ((data ?? []) as Row[]).map((r) => ({ ...r }));
      return { note: "Provisional layout: the exact Rojmel format must be confirmed with the client before it is relied on.", sections: [{
        cols: [tx("kind", "Type"), tx("ref_no", "Ref. No.", 1.4), tx("party_name", "Party / Payee", 1.6), tx("description", "Details", 2), nm("bags", "Bags"), nm("kgs", "Kgs"), mn("amount_in", "Received (Rs.)"), mn("amount_out", "Paid (Rs.)"), tx("status", "Status")],
        rows, totals: { ref_no: "Total (active)", ...Object.fromEntries(["bags", "kgs", "amount_in", "amount_out"].map((k) => [k, sum(rows.filter((r) => r.status === "active"), k)])) } }] };
    } },
  { slug: "ledger", title: "Party Account Statement", description: "What a party owes or is owed: bills, payments and balance.", group: "Finance", permission: "billing.view", customer: true, filters: ["party", "from", "to"], defaults: "all-time", requireParty: true,
    async run(c) {
      const { data, error } = await c.supabase.rpc("ledger_statement", { p_party: c.f.party, p_from: c.f.from, p_to: c.f.to });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Row[];
      return { note: "Balance: positive = party owes us; negative = we owe the party.", sections: [{ cols: [dt("entry_date", "Date"), tx("entry_type", "Type", 1.2), tx("narration", "Narration", 3), mn("debit", "Debit (Rs.)"), mn("credit", "Credit (Rs.)"), mn("balance", "Balance (Rs.)")],
        rows, totals: { narration: "Period totals", debit: sum(rows, "debit"), credit: sum(rows, "credit"), balance: rows.length ? rows[rows.length - 1].balance : 0 } }] };
    } },
  { slug: "inward-register", title: "Goods In Register", description: "Every entry of goods received, for any dates.", group: "Registers", permission: "reports.view", customer: true, filters: ["from", "to", "party", "product", "chamber", "floor"], defaults: "month", run: (c) => register(c, "inward", c.f.from, c.f.to) },
  { slug: "outward-register", title: "Goods Out Register", description: "Every entry of goods sent out, for any dates.", group: "Registers", permission: "reports.view", customer: true, filters: ["from", "to", "party", "product", "chamber", "floor"], defaults: "month", run: (c) => register(c, "outward", c.f.from, c.f.to) },
  { slug: "stock-register", title: "Stock Register", description: "For any dates: opening stock, goods in, goods out and closing stock.", group: "Stock", permission: "reports.view", customer: true, filters: ["from", "to", "party", "product", "chamber", "floor"], defaults: "month",
    async run(c) { const rows = await stockRegister(c, c.f.from, c.f.to); return { sections: [{ cols: regCols, rows, totals: totalsRow(rows, regKeys, { key: "party_name", text: "Total" }) }] }; } },
  { slug: "labour-inward", title: "Labour Wages: Goods In", description: "Wages recorded on goods received.", group: "Labour", permission: "labour.view", filters: ["from", "to", "party", "product"], defaults: "month", run: (c) => labour(c, "inward") },
  { slug: "labour-outward", title: "Labour Wages: Goods Out", description: "Wages recorded on goods sent out.", group: "Labour", permission: "labour.view", filters: ["from", "to", "party", "product"], defaults: "month", run: (c) => labour(c, "outward") },
  { slug: "cold-stock-party", title: "Current Stock by Party", description: "What is in the warehouse right now, with location.", group: "Party", permission: "reports.view", customer: true, filters: ["party", "product", "chamber", "floor"], defaults: "all-time",
    async run(c) {
      const rows = await stockDetail(c);
      return { sections: [{ cols: stockCols, rows, totals: totalsRow(rows, ["inward_bags", "outward_bags", "available_bags", "inward_kgs", "outward_kgs", "available_kgs"], { key: "party_name", text: "Total" }) }] };
    } },
  { slug: "party-wise", title: "Party-wise Stock Summary", description: "Each party's stock by product.", group: "Party", permission: "reports.view", customer: true, filters: ["from", "to", "party", "product", "chamber", "floor"], defaults: "month",
    async run(c) {
      const rows = await stockRegister(c, c.f.from, c.f.to);
      const by = new Map<string, Row[]>();
      rows.forEach((r) => by.set(String(r.party_name), [...(by.get(String(r.party_name)) ?? []), r]));
      const cols = regCols.filter((x) => x.key !== "party_name");
      return { sections: [...by.entries()].map(([party, rs]) => ({ title: party, cols, rows: rs, totals: totalsRow(rs, regKeys, { key: "product_name", text: "Party total" }) })) };
    } },
  { slug: "party-history", title: "Party History", description: "All goods in and out for one party.", group: "Party", permission: "reports.view", customer: true, filters: ["party", "from", "to", "product"], defaults: "all-time", requireParty: true,
    async run(c) {
      const [i, o] = await Promise.all((["v_inward_lines", "v_outward_lines"] as const).map((v) => fetchAll<Row>((a, b) => {
        let q = c.supabase.from(v).select("*").eq("party_id", c.f.party).gte("doc_date", c.f.from).lte("doc_date", c.f.to).order("doc_date").range(a, b) as unknown as Q;
        if (c.f.product) q = q.eq("product_id", c.f.product);
        return q;
      })));
      const rows: Row[] = [...i.map((r): Row => ({ ...r, type: "Inward" })), ...o.map((r): Row => ({ ...r, type: "Outward" }))].sort((a, b) => String(a.doc_date).localeCompare(String(b.doc_date)) || String(a.doc_no).localeCompare(String(b.doc_no)));
      const live = rows.filter((r) => r.status === "active");
      const inB = sum(live.filter((r) => r.type === "Inward"), "bags"); const outB = sum(live.filter((r) => r.type === "Outward"), "bags");
      return { note: `Active entries in period: ${inB} bags in, ${outB} bags out.`, sections: [{ cols: [dt("doc_date", "Date"), tx("type", "Type"), tx("doc_no", "No.", 1.3), tx("product_name", "Product", 1.4), tx("chamber_code", "Chamber"), nm("floor_no", "Floor"), tx("rack_code", "Rack"), nm("bags", "Bags"), nm("total_kgs", "Total Kgs"), tx("vehicle_no", "Vehicle", 1.2), tx("status", "Status")], rows }] };
    } },
  { slug: "floor-wise", title: "Floor-wise Stock", description: "Stock on every floor of every room.", group: "Stock", permission: "reports.view", filters: ["from", "to", "chamber", "floor", "product", "party"], defaults: "month",
    async run(c) {
      const { data, error } = await c.supabase.rpc("floor_report", { p_from: c.f.from, p_to: c.f.to });
      if (error) throw new Error(error.message);
      let floors = (data ?? []) as Row[];
      const { data: fl } = await c.supabase.from("floors").select("id,chamber_id");
      const allowed = new Set((fl ?? []).filter((x: { id: string; chamber_id: string }) => (!c.f.chamber || x.chamber_id === c.f.chamber) && (!c.f.floor || x.id === c.f.floor)).map((x: { id: string }) => x.id));
      floors = floors.filter((r) => allowed.has(String(r.floor_id)));
      const det = (await stockDetail(c)).filter((r) => allowed.has(String(r.floor_id)));
      const group = (keyCol: string) => {
        const m = new Map<string, Row>();
        det.forEach((r) => { const k = `${r.chamber_code}|${r.floor_no}|${r[keyCol]}`; const e = m.get(k) ?? { chamber_code: r.chamber_code, floor_no: r.floor_no, [keyCol]: r[keyCol], available_bags: 0, available_kgs: 0 };
          e.available_bags = Number(e.available_bags) + Number(r.available_bags); e.available_kgs = Number(e.available_kgs) + Number(r.available_kgs); m.set(k, e); });
        return [...m.values()];
      };
      return { sections: [
        { title: "Floor summary", cols: [tx("chamber_code", "Chamber"), nm("floor_no", "Floor"), nm("current_bags", "Current Bags"), nm("current_kgs", "Current Kgs"), nm("inward_bags", "Inward Bags (period)"), nm("inward_kgs", "Inward Kgs"), nm("outward_bags", "Outward Bags (period)"), nm("outward_kgs", "Outward Kgs"), nm("parties", "Parties"), nm("products", "Products")],
          rows: floors, totals: totalsRow(floors, ["current_bags", "current_kgs", "inward_bags", "inward_kgs", "outward_bags", "outward_kgs"], { key: "chamber_code", text: "Total" }) },
        { title: "Product-wise stock by floor", cols: [tx("chamber_code", "Chamber"), nm("floor_no", "Floor"), tx("product_name", "Product", 2), nm("available_bags", "Bags"), nm("available_kgs", "Kgs")], rows: group("product_name") },
        { title: "Party-wise stock by floor", cols: [tx("chamber_code", "Chamber"), nm("floor_no", "Floor"), tx("party_name", "Party", 2), nm("available_bags", "Bags"), nm("available_kgs", "Kgs")], rows: group("party_name") },
      ] };
    } },
  { slug: "transaction-summary", title: "Daily Totals", description: "Total goods in and out for each day, plus money totals.", group: "Registers", permission: "reports.view", filters: ["from", "to", "party"], defaults: "month",
    async run(c) {
      const [i, o] = await Promise.all((["v_inward_lines", "v_outward_lines"] as const).map((v) => fetchAll<Row>((a, b) => scope(c.supabase.from(v).select("doc_id,doc_date,bags,total_kgs,status").eq("status", "active").gte("doc_date", c.f.from).lte("doc_date", c.f.to).order("doc_date").range(a, b) as unknown as Q, c.f, { party: true }))));
      const days = new Map<string, Row>();
      const add = (rows: Row[], pre: "in" | "out") => rows.forEach((r) => { const d = String(r.doc_date); const e = days.get(d) ?? { date: d, in_docs: 0, in_bags: 0, in_kgs: 0, out_docs: 0, out_bags: 0, out_kgs: 0 }; e[`${pre}_bags`] = Number(e[`${pre}_bags`]) + Number(r.bags); e[`${pre}_kgs`] = Number(e[`${pre}_kgs`]) + Number(r.total_kgs); days.set(d, e); });
      add(i, "in"); add(o, "out");
      [[i, "in"], [o, "out"]].forEach(([rows, pre]) => { const seen = new Map<string, Set<string>>(); (rows as Row[]).forEach((r) => { const s = seen.get(String(r.doc_date)) ?? new Set(); s.add(String(r.doc_id)); seen.set(String(r.doc_date), s); }); seen.forEach((s, d) => { days.get(d)![`${pre}_docs`] = s.size; }); });
      const rows = [...days.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const sections: Section[] = [{ title: "Stock movement by day", cols: [dt("date", "Date"), nm("in_docs", "Inward Entries"), nm("in_bags", "Inward Bags"), nm("in_kgs", "Inward Kgs"), nm("out_docs", "Outward Entries"), nm("out_bags", "Outward Bags"), nm("out_kgs", "Outward Kgs")], rows, totals: totalsRow(rows, ["in_docs", "in_bags", "in_kgs", "out_docs", "out_bags", "out_kgs"], { key: "date", text: "Total" }) }];
      if (c.auth.can("billing.view")) {
        const [inv, rc, py] = await Promise.all([
          fetchAll<Row>((a, b) => { let q = c.supabase.from("invoice_balances").select("total,status").eq("status", "issued").gte("invoice_date", c.f.from).lte("invoice_date", c.f.to).range(a, b) as unknown as Q; if (c.f.party) q = q.eq("party_id", c.f.party); return q; }),
          fetchAll<Row>((a, b) => { let q = c.supabase.from("receipts").select("amount").eq("status", "active").gte("receipt_date", c.f.from).lte("receipt_date", c.f.to).range(a, b) as unknown as Q; if (c.f.party) q = q.eq("party_id", c.f.party); return q; }),
          fetchAll<Row>((a, b) => { let q = c.supabase.from("payments").select("amount").eq("status", "active").gte("payment_date", c.f.from).lte("payment_date", c.f.to).range(a, b) as unknown as Q; if (c.f.party) q = q.eq("party_id", c.f.party); return q; }),
        ]);
        sections.push({ title: "Billing", cols: [tx("item", "Item", 2), nm("count", "Count"), mn("amount", "Amount (Rs.)")], rows: [{ item: "Invoices issued", count: inv.length, amount: sum(inv, "total") }, { item: "Receipts", count: rc.length, amount: sum(rc, "amount") }, { item: "Payments out", count: py.length, amount: sum(py, "amount") }] });
      }
      return { sections };
    } },
];

export const REPORT_MAP = new Map(REPORTS.map((r) => [r.slug, r]));
