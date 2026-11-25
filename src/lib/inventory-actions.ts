"use server";
import { revalidatePath } from "next/cache";
import { callRpc, fail, type ActionResult } from "@/lib/action-utils";
import { adjustmentSchema, type AdjustmentValues } from "@/lib/schemas";

export async function postAdjustment(values: AdjustmentValues): Promise<ActionResult<{ adj_no: string }>> {
  const p = adjustmentSchema.safeParse(values);
  if (!p.success) return fail(p.error.issues[0].message);
  const v = p.data;
  const r = await callRpc<{ adj_no: string }>("stock.adjust", "post_stock_adjustment", { p_party: v.party_id, p_product: v.product_id, p_rack: v.rack_id, p_bags_delta: v.bags_delta, p_kgs_delta: v.kgs_delta, p_date: v.adj_date, p_reason: v.reason });
  if (r.ok) { revalidatePath("/admin/inventory"); revalidatePath("/admin"); }
  return r;
}

export async function reviewRequestAction(id: string, approve: boolean, note: string): Promise<ActionResult<unknown>> {
  if (!approve && note.trim().length < 3) return fail("Give a reason for rejecting.");
  const r = await callRpc("request.review", "review_outward_request", { p_id: id, p_approve: approve, p_note: note.trim() || null });
  if (r.ok) { revalidatePath("/admin/requests"); revalidatePath("/admin"); }
  return r;
}
