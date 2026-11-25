"use server";

import { revalidatePath } from "next/cache";
import { actionContext, callRpc, fail, ok, type ActionResult } from "@/lib/action-utils";
import { inwardSchema, outwardSchema, type InwardValues, type OutwardValues } from "@/lib/schemas";

const blank = (s: string | undefined | null) => (s && s.trim() ? s.trim() : null);
const lines = (v: InwardValues["lines"]) => v.map((l) => ({
  product_id: l.product_id, rack_id: l.rack_id, bags: l.bags, kgs_per_bag: l.kgs_per_bag, wages_party: l.wages_party, wages_labour: l.wages_labour, remarks: blank(l.remarks),
}));
type Doc = { id: string; inward_no?: string; outward_no?: string; duplicate?: boolean; total_bags: number; total_kgs: number };

export async function createInwardAction(values: InwardValues, clientRequestId: string): Promise<ActionResult<Doc>> {
  const p = inwardSchema.safeParse(values);
  if (!p.success) return fail(p.error.issues[0].message);
  const v = p.data;
  const r = await callRpc<Doc>("inward.create", "create_inward", {
    p_header: { inward_date: v.inward_date, party_id: v.party_id, vehicle_no: blank(v.vehicle_no), wb_kgs: v.wb_kgs ?? null, remarks: blank(v.remarks), client_request_id: clientRequestId },
    p_items: lines(v.lines),
  });
  if (r.ok) { revalidatePath("/admin/inward"); revalidatePath("/admin"); revalidatePath("/admin/inventory"); }
  return r;
}

export async function updateInwardAction(id: string, values: InwardValues): Promise<ActionResult<Doc>> {
  const p = inwardSchema.safeParse(values);
  if (!p.success) return fail(p.error.issues[0].message);
  const v = p.data;
  const r = await callRpc<Doc>("inward.update", "update_inward", {
    p_id: id, p_header: { inward_date: v.inward_date, party_id: v.party_id, vehicle_no: blank(v.vehicle_no), wb_kgs: v.wb_kgs ?? null, remarks: blank(v.remarks) }, p_items: lines(v.lines),
  });
  if (r.ok) { revalidatePath("/admin/inward"); revalidatePath(`/admin/inward/${id}`); revalidatePath("/admin/inventory"); }
  return r;
}

export async function cancelInwardAction(id: string, reason: string): Promise<ActionResult<unknown>> {
  const r = await callRpc("inward.cancel", "cancel_inward", { p_id: id, p_reason: reason });
  if (r.ok) { revalidatePath("/admin/inward"); revalidatePath(`/admin/inward/${id}`); revalidatePath("/admin"); }
  return r;
}

export async function createOutwardAction(values: OutwardValues, clientRequestId: string): Promise<ActionResult<Doc>> {
  const p = outwardSchema.safeParse(values);
  if (!p.success) return fail(p.error.issues[0].message);
  const v = p.data;
  const r = await callRpc<Doc>("outward.create", "create_outward", {
    p_header: { outward_date: v.outward_date, party_id: v.party_id, vehicle_no: blank(v.vehicle_no), remarks: blank(v.remarks), outward_request_id: v.outward_request_id ?? null, client_request_id: clientRequestId },
    p_items: lines(v.lines),
  });
  if (r.ok) { revalidatePath("/admin/outward"); revalidatePath("/admin"); revalidatePath("/admin/inventory"); revalidatePath("/admin/requests"); }
  return r;
}

export async function updateOutwardAction(id: string, values: OutwardValues): Promise<ActionResult<Doc>> {
  const p = outwardSchema.safeParse(values);
  if (!p.success) return fail(p.error.issues[0].message);
  const v = p.data;
  const r = await callRpc<Doc>("outward.update", "update_outward", {
    p_id: id, p_header: { outward_date: v.outward_date, vehicle_no: blank(v.vehicle_no), remarks: blank(v.remarks) }, p_items: lines(v.lines),
  });
  if (r.ok) { revalidatePath("/admin/outward"); revalidatePath(`/admin/outward/${id}`); revalidatePath("/admin/inventory"); }
  return r;
}

export async function cancelOutwardAction(id: string, reason: string): Promise<ActionResult<unknown>> {
  const r = await callRpc("outward.cancel", "cancel_outward", { p_id: id, p_reason: reason });
  if (r.ok) { revalidatePath("/admin/outward"); revalidatePath(`/admin/outward/${id}`); revalidatePath("/admin"); revalidatePath("/admin/requests"); }
  return r;
}

export type StockPosition = {
  key: string; product_id: string; product_name: string; rack_id: string; floor_id: string; chamber_id: string; location: string;
  available_bags: number; available_kgs: number;
};

/** A party's stock by position - powers the outward form's "available stock" and location choice. RLS-scoped. */
export async function getPartyStock(partyId: string): Promise<ActionResult<StockPosition[]>> {
  const a = await actionContext();
  if ("error" in a) return fail(a.error);
  const { data, error } = await a.supabase.from("v_stock_detail").select("product_id,product_name,rack_id,floor_id,chamber_id,chamber_code,floor_no,rack_code,available_bags,available_kgs")
    .eq("party_id", partyId).gt("available_bags", 0).order("product_name");
  if (error) return fail(error.message);
  return ok((data ?? []).map((r) => ({
    key: `${r.product_id}:${r.rack_id}`, product_id: r.product_id, product_name: r.product_name, rack_id: r.rack_id, floor_id: r.floor_id, chamber_id: r.chamber_id,
    location: `${r.chamber_code} / Floor ${r.floor_no} / ${r.rack_code}`, available_bags: Number(r.available_bags), available_kgs: Number(r.available_kgs),
  })));
}
