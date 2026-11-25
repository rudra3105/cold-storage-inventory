import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AppRole = "super_admin" | "manager" | "staff" | "accountant" | "customer";
export const INTERNAL_ROLES: AppRole[] = ["super_admin", "manager", "staff", "accountant"];

export type AuthContext = {
  userId: string;
  email: string | null;
  fullName: string;
  role: AppRole;
  permissions: Set<string>;
  partyId: string | null;       // customers only
  can: (permission: string) => boolean;
};

/** Validated session + role + permissions. Returns null if signed out, inactive, or role-less. */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();     // server-validated, never trust getSession() alone
  if (!auth.user) return null;

  const [{ data: profile }, { data: roleRow }] = await Promise.all([
    supabase.from("profiles").select("full_name,is_active").eq("id", auth.user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", auth.user.id).maybeSingle(),
  ]);
  if (!profile?.is_active || !roleRow) return null;
  const role = roleRow.role as AppRole;

  let permissions = new Set<string>();
  let partyId: string | null = null;
  if (role === "super_admin") {
    const { data } = await supabase.from("permissions_catalog").select("key");
    permissions = new Set((data ?? []).map((r) => r.key as string));
  } else if (role === "customer") {
    const { data } = await supabase.from("parties").select("id").eq("user_id", auth.user.id).eq("is_active", true).maybeSingle();
    if (!data) return null;                                  // inactive customer account
    partyId = data.id as string;
  } else {
    const { data } = await supabase.from("role_permissions").select("permission").eq("role", role).eq("allowed", true);
    permissions = new Set((data ?? []).map((r) => r.permission as string));
  }
  return {
    userId: auth.user.id, email: auth.user.email ?? null, fullName: profile.full_name as string,
    role, permissions, partyId, can: (p) => permissions.has(p),
  };
});

export async function requireInternal(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (ctx.role === "customer") redirect("/portal");
  return ctx;
}

export async function requireCustomer(): Promise<AuthContext & { partyId: string }> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (ctx.role !== "customer" || !ctx.partyId) redirect("/admin");
  return ctx as AuthContext & { partyId: string };
}

export async function requirePermission(permission: string): Promise<AuthContext> {
  const ctx = await requireInternal();
  if (!ctx.can(permission)) redirect("/admin?denied=1");
  return ctx;
}
