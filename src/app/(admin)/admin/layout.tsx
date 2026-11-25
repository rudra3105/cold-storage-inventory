import { requireInternal } from "@/lib/auth/context";
import { signOut } from "@/lib/auth/actions";
import { ADMIN_NAV } from "@/lib/nav";
import { ROLE_LABEL, toShellNav } from "@/lib/shell-data";
import { AppShell } from "@/components/shell/app-shell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireInternal();           // authoritative gate (proxy is only optimistic)
  return (
    <AppShell nav={toShellNav(ADMIN_NAV, ctx)} businessName={ctx.businessName} userName={ctx.fullName} roleLabel={ROLE_LABEL[ctx.role]} signOutAction={signOut}>
      {children}
    </AppShell>
  );
}
