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
  businessName: string;
  can: (permission: string) => boolean;
};

type SessionRow = { user_id: string; full_name: string; role: AppRole; party_id: string | null; permissions: string[]; business_name: string };

/** Older databases (migration 0010 not applied yet): same answer, a few more round-trips. */
async function legacySession(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<SessionRow | null> {
  const [{ data: profile }, { data: roleRow }, { data: biz }] = await Promise.all([
    supabase.from("profiles").select("full_name,is_active").eq("id", userId).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
    supabase.from("business_settings").select("business_name").maybeSingle(),
  ]);
  if (!profile?.is_active || !roleRow) return null;
  const role = roleRow.role as AppRole;
  let permissions: string[] = []; let partyId: string | null = null;
  if (role === "super_admin") {
    const { data } = await supabase.from("permissions_catalog").select("key");
    permissions = (data ?? []).map((r) => r.key as string);
  } else if (role === "customer") {
    const { data } = await supabase.from("parties").select("id").eq("user_id", userId).eq("is_active", true).maybeSingle();
    if (!data) return null;
    partyId = data.id as string;
  } else {
    const { data } = await supabase.from("role_permissions").select("permission").eq("role", role).eq("allowed", true);
    permissions = (data ?? []).map((r) => r.permission as string);
  }
  return { user_id: userId, full_name: profile.full_name as string, role, party_id: partyId, permissions, business_name: (biz?.business_name as string | undefined) ?? "Cold Storage" };
}

/**
 * Validated session + role + permissions. Returns null if signed out, inactive, or role-less.
 * Speed: the token is verified locally (getClaims: signature + expiry, no network call on current Supabase
 * projects) and everything else comes from ONE database call (app_session). Database RLS is still the real
 * data boundary, and role/permissions are read live from the database on every request.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return null;

  let row: SessionRow | null;
  const { data, error } = await supabase.rpc("app_session");
  if (error) row = await legacySession(supabase, userId);
  else row = (data as SessionRow | null) ?? null;
  if (!row) return null;

  const permissions = new Set<string>(row.permissions ?? []);
  return {
    userId: row.user_id, email: (claimsData?.claims?.email as string | undefined) ?? null, fullName: row.full_name,
    role: row.role, permissions, partyId: row.party_id, businessName: row.business_name, can: (p) => permissions.has(p),
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
