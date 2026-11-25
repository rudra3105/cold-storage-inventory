import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthContext } from "@/lib/auth/context";
import { isDate, isUuid, monthStart, today } from "@/lib/data";

export type Row = Record<string, string | number | null>;
export type Col = { key: string; label: string; align?: "left" | "right" | "center"; kind?: "text" | "number" | "money" | "date"; weight?: number };
export type Section = { title?: string; cols: Col[]; rows: Row[]; totals?: Row };
export type ReportResult = { sections: Section[]; note?: string };
export type FilterKey = "from" | "to" | "date" | "party" | "product" | "chamber" | "floor";
export type Filters = { from: string; to: string; date: string; party?: string; product?: string; chamber?: string; floor?: string };
export type RunCtx = { supabase: SupabaseClient; auth: AuthContext; f: Filters };

export type ReportDef = {
  slug: string; title: string; description: string;
  group: "Registers" | "Stock" | "Party" | "Finance" | "Labour";
  /** permission needed by internal users; null = any internal user */
  permission: string | null;
  /** may a customer run it (RLS scopes the data to their own party)? */
  customer?: boolean;
  filters: FilterKey[]; defaults: "today" | "month" | "all-time";
  requireParty?: boolean; provisional?: boolean;
  run: (c: RunCtx) => Promise<ReportResult>;
};

export function parseFilters(sp: Record<string, string | string[] | undefined>, def: ReportDef): Filters {
  const g = (k: string) => { const v = Array.isArray(sp[k]) ? sp[k]![0] : sp[k]; return v && v.trim() ? v.trim() : undefined; };
  const t = today();
  const defFrom = def.defaults === "today" ? t : def.defaults === "month" ? monthStart() : "2000-01-01";
  const date = isDate(g("date")) ? g("date")! : t;
  return {
    from: isDate(g("from")) ? g("from")! : defFrom, to: isDate(g("to")) ? g("to")! : t, date,
    party: isUuid(g("party")) ? g("party") : undefined, product: isUuid(g("product")) ? g("product") : undefined,
    chamber: isUuid(g("chamber")) ? g("chamber") : undefined, floor: isUuid(g("floor")) ? g("floor") : undefined,
  };
}

/** PostgREST caps responses (1000 rows on Supabase). Page through until exhausted, up to a hard safety limit. */
export async function fetchAll<T = Record<string, unknown>>(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, limit = 50_000): Promise<T[]> {
  const out: T[] = []; const step = 1000;
  for (let from = 0; from < limit; from += step) {
    const { data, error } = await build(from, from + step - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < step) break;
  }
  return out;
}

export function sum(rows: Row[], key: string) { return rows.reduce((a, r) => a + (Number(r[key]) || 0), 0); }
export function totalsRow(rows: Row[], keys: string[], label: { key: string; text: string }): Row {
  const t: Row = { [label.key]: label.text };
  for (const k of keys) t[k] = Math.round(sum(rows, k) * 1000) / 1000;
  return t;
}

export function formatCell(v: unknown, kind: Col["kind"]): string {
  if (v == null || v === "") return "";
  if (kind === "number") return Number(v).toLocaleString("en-IN", { maximumFractionDigits: 3 });
  if (kind === "money") return Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (kind === "date") return new Date(String(v).slice(0, 10) + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  return String(v);
}
