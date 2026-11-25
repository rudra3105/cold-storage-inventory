import "server-only";
import { createElement } from "react";
import { createClient } from "@/lib/supabase/server";
import type { AuthContext } from "@/lib/auth/context";
import { visibleNav, type NavItem } from "@/lib/nav";
import type { ShellNavItem } from "@/components/shell/app-shell";

export const ROLE_LABEL: Record<AuthContext["role"], string> = {
  super_admin: "Owner", manager: "Manager", staff: "Warehouse Staff", accountant: "Accountant", customer: "Customer",
};

export async function getBusinessName() {
  const supabase = await createClient();
  const { data } = await supabase.from("business_settings").select("business_name").maybeSingle();
  return (data?.business_name as string | undefined) ?? "Cold Storage";
}

export function toShellNav(items: NavItem[], ctx: AuthContext): ShellNavItem[] {
  return visibleNav(items, ctx).map((i) => ({ label: i.label, hint: i.hint, group: i.group, primary: i.primary, tone: i.tone, href: i.href, icon: createElement(i.icon) }));
}
