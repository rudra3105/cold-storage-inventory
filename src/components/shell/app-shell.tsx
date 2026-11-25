"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { BrandMark } from "./brand-mark";

export type ShellNavItem = { label: string; hint?: string; group?: string; primary?: boolean; tone?: "in" | "out"; href: string; icon: React.ReactNode };

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

export function AppShell({
  nav, businessName, userName, roleLabel, signOutAction, children,
}: {
  nav: ShellNavItem[]; businessName: string; userName: string; roleLabel: string; signOutAction: () => Promise<void>; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/admin" || href === "/portal" ? pathname === href : pathname.startsWith(href));
  const bottom = nav.filter((n) => n.primary).slice(0, 4);
  const needsMenu = nav.length > bottom.length;

  const tile = (item: ShellNavItem, active: boolean) => (
    <span className={cn(
      "flex size-9 shrink-0 items-center justify-center rounded-[9px] [&_svg]:size-5",
      active ? "bg-primary text-white" : item.tone === "in" ? "bg-in-soft text-in" : item.tone === "out" ? "bg-out-soft text-out" : "bg-muted text-muted-foreground",
    )}>{item.icon}</span>
  );

  const navList = (
    <nav className="flex flex-1 flex-col overflow-y-auto px-3 py-4" aria-label="Main menu">
      {nav.map((item, idx) => {
        const active = isActive(item.href);
        return (
          <div key={item.href}>
            {item.group && item.group !== nav[idx - 1]?.group && <p className="mt-5 mb-1.5 px-3 text-sm font-bold text-muted-foreground">{item.group}</p>}
            <Link
              href={item.href}
              onClick={() => setOpen(false)}
              aria-current={active ? "page" : undefined}
              className={cn("flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-muted", active && "bg-primary-soft hover:bg-primary-soft")}
            >
              {tile(item, active)}
              <span className="min-w-0 leading-tight">
                <span className={cn("block truncate text-base", active ? "font-bold text-primary" : "font-semibold")}>{item.label}</span>
                {item.hint && <span className="block truncate text-[13px] text-muted-foreground">{item.hint}</span>}
              </span>
            </Link>
          </div>
        );
      })}
    </nav>
  );

  const account = (
    <div className="border-t p-3">
      <div className="flex items-center gap-3 px-2 py-2">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-bold text-primary">{initials(userName)}</span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[15px] font-semibold">{userName}</p>
          <p className="text-sm text-muted-foreground">{roleLabel}</p>
        </div>
      </div>
      <form action={signOutAction}>
        <Button type="submit" variant="ghost" size="sm" className="mt-1 w-full justify-start text-muted-foreground"><LogOut /> Sign out</Button>
      </form>
    </div>
  );

  const brand = (
    <div className="flex h-16 items-center gap-3 border-b px-5">
      <BrandMark />
      <span className="truncate text-base font-bold leading-tight">{businessName}</span>
    </div>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="no-print sticky top-0 hidden h-dvh w-72 shrink-0 flex-col border-r bg-card md:flex">
        {brand}{navList}{account}
      </aside>

      {open && <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <aside className={cn("no-print fixed inset-y-0 left-0 z-50 flex w-80 max-w-[88vw] flex-col bg-card transition-transform md:hidden", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex items-center justify-between pr-2">
          {brand}
          <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close menu"><X /></Button>
        </div>
        {navList}{account}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card px-4 md:hidden">
          <BrandMark className="size-8" />
          <span className="truncate text-base font-bold">{businessName}</span>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-28 md:px-10 md:py-9">{children}</main>
        <InstallPrompt />
      </div>

      <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden" style={{ gridTemplateColumns: `repeat(${bottom.length + (needsMenu ? 1 : 0)}, minmax(0, 1fr))` }} aria-label="Quick menu">
        {bottom.map((item) => {
          const active = isActive(item.href);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={cn("flex flex-col items-center gap-1 py-2.5 text-[13px] font-semibold [&_svg]:size-6", active ? "text-primary" : item.tone === "in" ? "text-in" : item.tone === "out" ? "text-out" : "text-muted-foreground")}>
              {item.icon}<span className="max-w-full truncate px-1">{item.label}</span>
            </Link>
          );
        })}
        {needsMenu && (
          <button type="button" onClick={() => setOpen(true)} className="flex flex-col items-center gap-1 py-2.5 text-[13px] font-semibold text-muted-foreground [&_svg]:size-6"><Menu /><span>More</span></button>
        )}
      </nav>
    </div>
  );
}
