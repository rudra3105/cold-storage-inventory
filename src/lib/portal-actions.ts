"use server";
import { revalidatePath } from "next/cache";
import { actionContext, callRpc, fail, type ActionResult } from "@/lib/action-utils";
import { requestSchema } from "@/lib/schemas";
import type { z } from "zod";

export async function submitRequest(values: z.input<typeof requestSchema>): Promise<ActionResult<{ request_no: string }>> {
  const a = await actionContext();
  if ("error" in a) return fail(a.error);
  if (a.ctx.role !== "customer") return fail("Only customers can submit requests.");
  const p = requestSchema.safeParse(values);
  if (!p.success) return fail(p.error.issues[0].message);
  const r = await callRpc<{ request_no: string }>(null, "create_outward_request", { p_product: p.data.product_id, p_bags: p.data.bags, p_preferred_date: p.data.preferred_date || null, p_remarks: p.data.remarks?.trim() || null });
  if (r.ok) revalidatePath("/portal/requests");
  return r;
}
export async function cancelRequest(id: string): Promise<ActionResult<unknown>> {
  const a = await actionContext();
  if ("error" in a) return fail(a.error);
  const r = await callRpc(null, "cancel_outward_request", { p_id: id });
  if (r.ok) revalidatePath("/portal/requests");
  return r;
}
