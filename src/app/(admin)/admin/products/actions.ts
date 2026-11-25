"use server";

import { revalidatePath } from "next/cache";
import { actionContext, fail, friendlyError, ok, type ActionResult } from "@/lib/action-utils";
import { productSchema, type ProductValues } from "@/lib/schemas";

const nul = (s: string | undefined | null) => (s && s.trim() ? s.trim() : null);

export async function saveProduct(id: string | null, values: ProductValues): Promise<ActionResult<{ id: string; name: string }>> {
  const a = await actionContext("product.manage");
  if ("error" in a) return fail(a.error);
  const p = productSchema.safeParse(values);
  if (!p.success) return fail(p.error.issues[0].message);
  const v = p.data;
  const row = { name: v.name, category: nul(v.category), description: nul(v.description), default_unit: v.default_unit, default_kgs_per_bag: v.default_kgs_per_bag ?? null };
  const q = id ? a.supabase.from("products").update(row).eq("id", id) : a.supabase.from("products").insert(row);
  const { data, error } = await q.select("id,name").single();
  if (error) return fail(friendlyError(error));
  revalidatePath("/admin/products");
  return ok({ id: data.id as string, name: data.name as string });
}

export async function setProductActive(id: string, active: boolean): Promise<ActionResult<unknown>> {
  const a = await actionContext("product.manage");
  if ("error" in a) return fail(a.error);
  const { error } = await a.supabase.from("products").update({ is_active: active }).eq("id", id);
  if (error) return fail(friendlyError(error));
  revalidatePath("/admin/products");
  return ok({});
}

/** Used by the inward form's "Refresh product list" and quick-add. */
export async function listActiveProducts(): Promise<{ id: string; name: string; default_kgs_per_bag: number | null }[]> {
  const a = await actionContext();
  if ("error" in a) return [];
  const { data } = await a.supabase.from("products").select("id,name,default_kgs_per_bag").eq("is_active", true).order("name");
  return (data ?? []) as { id: string; name: string; default_kgs_per_bag: number | null }[];
}
