"use server";
import { revalidatePath } from "next/cache";
import { actionContext, fail, friendlyError, ok, type ActionResult } from "@/lib/action-utils";
import { createAdminClient } from "@/lib/supabase/admin";
import { settingsSchema, staffSchema } from "@/lib/schemas";
import { z } from "zod";

const blank = (s?: string | null) => (s && s.trim() ? s.trim() : null);

export async function createStaff(values: z.infer<typeof staffSchema>): Promise<ActionResult<unknown>> {
  const a = await actionContext("staff.manage");
  if ("error" in a) return fail(a.error);
  const p = staffSchema.safeParse(values);
  if (!p.success) return fail(p.error.issues[0].message);
  const v = p.data;
  const admin = createAdminClient();
  const created = await admin.auth.admin.createUser({ email: v.email, password: v.password, email_confirm: true });
  if (created.error || !created.data.user) return fail(created.error?.message.includes("registered") ? "That email is already used by another account." : (created.error?.message ?? "Could not create user"));
  const uid = created.data.user.id;
  const undo = async () => { await admin.auth.admin.deleteUser(uid); };
  const prof = await admin.from("profiles").insert({ id: uid, full_name: v.full_name, phone: blank(v.phone), is_active: true, created_by: a.ctx.userId });
  if (prof.error) { await undo(); return fail(friendlyError(prof.error)); }
  const role = await admin.from("user_roles").insert({ user_id: uid, role: v.role, created_by: a.ctx.userId });
  if (role.error) { await undo(); return fail(friendlyError(role.error)); }
  revalidatePath("/admin/staff"); return ok({});
}

export async function changeStaffRole(userId: string, role: "manager" | "staff" | "accountant"): Promise<ActionResult<unknown>> {
  const a = await actionContext("staff.manage");
  if ("error" in a) return fail(a.error);
  if (!["manager", "staff", "accountant"].includes(role)) return fail("Invalid role.");
  if (userId === a.ctx.userId) return fail("You cannot change your own role.");
  const { data: cur } = await a.supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  if (!cur || cur.role === "super_admin" || cur.role === "customer") return fail("This account's role cannot be changed here.");
  const { error } = await createAdminClient().from("user_roles").update({ role }).eq("user_id", userId);
  if (error) return fail(friendlyError(error));
  revalidatePath("/admin/staff"); return ok({});
}

export async function updateSettings(values: z.infer<typeof settingsSchema>): Promise<ActionResult<unknown>> {
  const a = await actionContext("settings.manage");
  if ("error" in a) return fail(a.error);
  const p = settingsSchema.safeParse(values);
  if (!p.success) return fail(p.error.issues[0].message);
  const v = p.data;
  const { error } = await a.supabase.from("business_settings").update({ business_name: v.business_name, address: blank(v.address), phone: blank(v.phone), email: blank(v.email), gst_number: blank(v.gst_number), invoice_terms: blank(v.invoice_terms), customer_can_see_rack: v.customer_can_see_rack, outward_requests_enabled: v.outward_requests_enabled }).eq("id", true);
  if (error) return fail(friendlyError(error));
  revalidatePath("/admin/settings"); revalidatePath("/portal"); return ok({});
}

export async function setRolePermission(role: "manager" | "staff" | "accountant", permission: string, allowed: boolean): Promise<ActionResult<unknown>> {
  const a = await actionContext();
  if ("error" in a) return fail(a.error);
  if (a.ctx.role !== "super_admin") return fail("Only the Owner can change permissions.");
  const { error } = await a.supabase.rpc("set_role_permission", { p_role: role, p_permission: permission, p_allowed: allowed });
  if (error) return fail(friendlyError(error));
  revalidatePath("/admin/settings"); return ok({});
}
