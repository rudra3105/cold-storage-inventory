"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionContext, fail, friendlyError, ok, type ActionResult } from "@/lib/action-utils";
import { partySchema, type PartyValues } from "@/lib/schemas";
import { createAdminClient } from "@/lib/supabase/admin";

const nul = (s: string | undefined) => (s && s.trim() ? s.trim() : null);

export async function saveParty(id: string | null, values: PartyValues): Promise<ActionResult<{ id: string }>> {
  const a = await actionContext("party.manage");
  if ("error" in a) return fail(a.error);
  const p = partySchema.safeParse(values);
  if (!p.success) return fail(p.error.issues[0].message);
  const v = p.data;
  const row = {
    name: v.name, contact_person: nul(v.contact_person), mobile: nul(v.mobile), email: nul(v.email), address: nul(v.address), city: nul(v.city),
    state: nul(v.state), gst_number: nul(v.gst_number), opening_balance: v.opening_balance, remarks: nul(v.remarks),
  };
  if (id) {
    // opening balance is the accounting base for the ledger: freeze it once the party has ledger entries
    const { count } = await a.supabase.from("party_ledger").select("id", { count: "exact", head: true }).eq("party_id", id);
    if ((count ?? 0) > 0) {
      const { data: cur } = await a.supabase.from("parties").select("opening_balance").eq("id", id).single();
      if (cur && Number(cur.opening_balance) !== v.opening_balance) return fail("Opening balance cannot be changed after ledger entries exist. Post a ledger adjustment instead.");
    }
    const { error } = await a.supabase.from("parties").update(row).eq("id", id);
    if (error) return fail(friendlyError(error));
    revalidatePath("/admin/parties");
    return ok({ id });
  }
  const { data, error } = await a.supabase.from("parties").insert(row).select("id").single();
  if (error) return fail(friendlyError(error));
  revalidatePath("/admin/parties");
  return ok({ id: data.id as string });
}

export async function setPartyActive(id: string, active: boolean): Promise<ActionResult<unknown>> {
  const a = await actionContext("party.manage");
  if ("error" in a) return fail(a.error);
  const { error } = await a.supabase.from("parties").update({ is_active: active }).eq("id", id);
  if (error) return fail(friendlyError(error));
  revalidatePath("/admin/parties"); revalidatePath(`/admin/parties/${id}`);
  return ok({});
}

const loginSchema = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email"), password: z.string().min(10, "Password must be at least 10 characters").max(100) });

/** Creates the customer's Supabase login and binds it to the party. Service-role use is confined to this function. */
export async function createCustomerLogin(partyId: string, email: string, password: string): Promise<ActionResult<unknown>> {
  const a = await actionContext("staff.manage");
  if ("error" in a) return fail(a.error);
  const p = loginSchema.safeParse({ email, password });
  if (!p.success) return fail(p.error.issues[0].message);
  const { data: party } = await a.supabase.from("parties").select("id,name,user_id,is_active").eq("id", partyId).maybeSingle();
  if (!party) return fail("Party not found.");
  if (party.user_id) return fail("This party already has a login.");

  const admin = createAdminClient();
  const created = await admin.auth.admin.createUser({ email: p.data.email, password: p.data.password, email_confirm: true });
  if (created.error || !created.data.user) return fail(created.error?.message.includes("registered") ? "That email is already used by another account." : (created.error?.message ?? "Could not create login"));
  const uid = created.data.user.id;
  const undo = async () => { await admin.auth.admin.deleteUser(uid); };

  const prof = await admin.from("profiles").insert({ id: uid, full_name: party.name, is_active: true });
  if (prof.error) { await undo(); return fail(friendlyError(prof.error)); }
  const role = await admin.from("user_roles").insert({ user_id: uid, role: "customer", created_by: a.ctx.userId });
  const link = role.error ? role : await admin.from("parties").update({ user_id: uid }).eq("id", partyId).is("user_id", null);
  if (role.error || link.error) { await undo(); return fail(friendlyError(role.error ?? link.error)); }
  revalidatePath(`/admin/parties/${partyId}`); revalidatePath("/admin/customers");
  return ok({});
}

export async function resetLoginPassword(userId: string, password: string): Promise<ActionResult<unknown>> {
  const a = await actionContext("staff.manage");
  if ("error" in a) return fail(a.error);
  if (password.length < 10) return fail("Password must be at least 10 characters");
  const { data: role } = await a.supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  if (!role) return fail("User not found.");
  if (role.role === "super_admin" && a.ctx.role !== "super_admin") return fail("Only the Owner can reset the Owner's password.");
  const r = await createAdminClient().auth.admin.updateUserById(userId, { password });
  return r.error ? fail(r.error.message) : ok({});
}

export async function setLoginActive(userId: string, active: boolean): Promise<ActionResult<unknown>> {
  const a = await actionContext("staff.manage");
  if ("error" in a) return fail(a.error);
  if (userId === a.ctx.userId) return fail("You cannot disable your own account.");
  const { data: role } = await a.supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  if (role?.role === "super_admin" && a.ctx.role !== "super_admin") return fail("Only the Owner can change the Owner's account.");
  const { error } = await a.supabase.from("profiles").update({ is_active: active }).eq("id", userId);
  if (error) return fail(friendlyError(error));
  revalidatePath("/admin/customers"); revalidatePath("/admin/staff");
  return ok({});
}
