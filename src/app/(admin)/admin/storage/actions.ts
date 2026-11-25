"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionContext, fail, friendlyError, ok, type ActionResult } from "@/lib/action-utils";

const fin = () => revalidatePath("/admin/storage");

export async function addChamber(code: string, name: string): Promise<ActionResult<unknown>> {
  const a = await actionContext("location.manage");
  if ("error" in a) return fail(a.error);
  const p = z.object({ code: z.string().trim().min(1).max(10), name: z.string().trim().min(1).max(60) }).safeParse({ code: code.toUpperCase(), name });
  if (!p.success) return fail("Chamber code and name are required.");
  const { data: last } = await a.supabase.from("chambers").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { error } = await a.supabase.from("chambers").insert({ ...p.data, sort_order: (last?.sort_order ?? 0) + 1 });
  if (error) return fail(friendlyError(error));
  fin(); return ok({});
}

export async function addFloor(chamberId: string): Promise<ActionResult<unknown>> {
  const a = await actionContext("location.manage");
  if ("error" in a) return fail(a.error);
  const { data: last } = await a.supabase.from("floors").select("floor_no").eq("chamber_id", chamberId).order("floor_no", { ascending: false }).limit(1).maybeSingle();
  const n = (last?.floor_no ?? 0) + 1;
  const { error } = await a.supabase.from("floors").insert({ chamber_id: chamberId, floor_no: n, name: `Floor ${n}` });
  if (error) return fail(friendlyError(error));
  fin(); return ok({});
}

export async function addRack(floorId: string, code: string, capacity: number | null): Promise<ActionResult<unknown>> {
  const a = await actionContext("location.manage");
  if ("error" in a) return fail(a.error);
  const p = z.object({ code: z.string().trim().min(1).max(30), capacity: z.number().int().positive().nullable() }).safeParse({ code, capacity });
  if (!p.success) return fail("Rack code is required; capacity must be a positive whole number.");
  const { error } = await a.supabase.from("racks").insert({ floor_id: floorId, code: p.data.code, capacity_bags: p.data.capacity });
  if (error) return fail(friendlyError(error));
  fin(); return ok({});
}

export async function updateRack(id: string, code: string, capacity: number | null): Promise<ActionResult<unknown>> {
  const a = await actionContext("location.manage");
  if ("error" in a) return fail(a.error);
  const p = z.object({ code: z.string().trim().min(1).max(30), capacity: z.number().int().positive().nullable() }).safeParse({ code, capacity });
  if (!p.success) return fail("Rack code is required; capacity must be a positive whole number.");
  const { error } = await a.supabase.from("racks").update({ code: p.data.code, capacity_bags: p.data.capacity }).eq("id", id);
  if (error) return fail(friendlyError(error));
  fin(); return ok({});
}

export async function setLocationActive(kind: "chamber" | "floor" | "rack", id: string, active: boolean): Promise<ActionResult<unknown>> {
  const a = await actionContext("location.manage");
  if ("error" in a) return fail(a.error);
  const table = kind === "chamber" ? "chambers" : kind === "floor" ? "floors" : "racks";
  const { error } = await a.supabase.from(table).update({ is_active: active }).eq("id", id);
  if (error) return fail(friendlyError(error));     // DB blocks deactivation while stock is held
  fin(); return ok({});
}
