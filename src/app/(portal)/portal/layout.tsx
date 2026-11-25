import { requireCustomer } from "@/lib/auth/context";
import { signOut } from "@/lib/auth/actions";
import { PORTAL_NAV } from "@/lib/nav";
import { getBusinessName, ROLE_LABEL, toShellNav } from "@/lib/shell-data";
import { AppShell } from "@/components/shell/app-shell";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCustomer();
  const businessName = await getBusinessName();
  return (
    <AppShell nav={toShellNav(PORTAL_NAV, ctx)} businessName={businessName} userName={ctx.fullName} roleLabel={ROLE_LABEL[ctx.role]} signOutAction={signOut}>
      {children}
    </AppShell>
  );
}
