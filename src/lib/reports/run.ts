import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AuthContext } from "@/lib/auth/context";
import { REPORT_MAP } from "./definitions";
import { parseFilters, type Filters, type ReportDef, type ReportResult } from "./engine";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Customers never see internal labour wages, and only see rack codes when the business allows it. */
async function sanitizeForCustomer(r: ReportResult, supabase: SupabaseClient): Promise<ReportResult> {
  const { data } = await supabase.from("business_settings").select("customer_can_see_rack").maybeSingle();
  const hidden = new Set(["wages_labour"]); if (data?.customer_can_see_rack === false) hidden.add("rack_code");
  return { ...r, sections: r.sections.map((s) => ({ ...s, cols: s.cols.filter((c) => !hidden.has(c.key)) })) };
}

export type Outcome =
  | { status: "ok"; def: ReportDef; f: Filters; result: ReportResult }
  | { status: "needs-party"; def: ReportDef; f: Filters }
  | { status: "forbidden" }
  | { status: "missing" };

export function canRun(def: ReportDef, ctx: AuthContext) {
  return ctx.role === "customer" ? !!def.customer : def.permission === null || ctx.can(def.permission);
}

export async function runReport(slug: string, sp: Record<string, string | string[] | undefined>, ctx: AuthContext): Promise<Outcome> {
  const def = REPORT_MAP.get(slug);
  if (!def) return { status: "missing" };
  if (!canRun(def, ctx)) return { status: "forbidden" };
  const f = parseFilters(sp, def);
  if (ctx.role === "customer") f.party = ctx.partyId ?? undefined;          // defence in depth: RLS already scopes everything
  if (def.requireParty && !f.party) return { status: "needs-party", def, f };
  if (f.from > f.to) return { status: "needs-party", def, f };                // handled by the page as an invalid range
  const supabase = await createClient();
  let result = await def.run({ supabase, auth: ctx, f });
  if (ctx.role === "customer") result = await sanitizeForCustomer(result, supabase);
  return { status: "ok", def, f, result };
}
