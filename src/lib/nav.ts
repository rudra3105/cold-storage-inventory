import { BarChart3, Boxes, ClipboardList, FileText, LayoutDashboard, Package, Settings, Users, Warehouse, ScrollText, ArrowDownToLine, ArrowUpFromLine, Receipt, HandCoins, Wallet, Percent, UserCog, type LucideIcon } from "lucide-react";
import type { AuthContext } from "@/lib/auth/context";

export type NavItem = {
  label: string;
  /** Small second line: the traditional/technical word, so old and new names both make sense. */
  hint?: string;
  /** Shown in the phone bottom bar. */
  primary?: boolean;
  /** Signal colour: goods in (green) or goods out (saffron). */
  tone?: "in" | "out";
  /** Section heading in the menu. */
  group?: string;
  href: string;
  icon: LucideIcon;
  /** Only routes that exist and work are `ready`. Flip a flag when its phase ships. */
  ready: boolean;
  /** Visible only if the user holds this permission (super_admin holds all). */
  permission?: string;
  /** Visible only for these roles. */
  roles?: AuthContext["role"][];
};

export const ADMIN_NAV: NavItem[] = [
  { label: "Home", href: "/admin", icon: LayoutDashboard, ready: true, primary: true },

  { group: "Daily work", label: "Goods In", hint: "Inward", href: "/admin/inward", icon: ArrowDownToLine, ready: true, primary: true, tone: "in" },
  { group: "Daily work", label: "Goods Out", hint: "Outward", href: "/admin/outward", icon: ArrowUpFromLine, ready: true, primary: true, tone: "out" },
  { group: "Daily work", label: "Stock", hint: "What is in the warehouse", href: "/admin/inventory", icon: Boxes, ready: true, primary: true },
  { group: "Daily work", label: "Customer Requests", hint: "Goods customers asked for", href: "/admin/requests", icon: ClipboardList, ready: true, permission: "request.review" },

  { group: "Money", label: "Bills", hint: "Invoices", href: "/admin/invoices", icon: Receipt, ready: true, permission: "billing.view" },
  { group: "Money", label: "Money Received", hint: "Receipts", href: "/admin/receipts", icon: HandCoins, ready: true, permission: "billing.view" },
  { group: "Money", label: "Money Paid", hint: "Payments", href: "/admin/payments", icon: Wallet, ready: true, permission: "billing.view" },

  { group: "Reports", label: "Reports", hint: "Print or download", href: "/admin/reports", icon: BarChart3, ready: true, permission: "reports.view" },

  { group: "Setup", label: "Parties", hint: "Customers", href: "/admin/parties", icon: Users, ready: true },
  { group: "Setup", label: "Products", hint: "Items stored", href: "/admin/products", icon: Package, ready: true },
  { group: "Setup", label: "Storage Rooms", hint: "Chambers, floors, racks", href: "/admin/storage", icon: Warehouse, ready: true },
  { group: "Setup", label: "Charges & Rates", hint: "Prices for bills", href: "/admin/rates", icon: Percent, ready: true, permission: "billing.manage" },

  { group: "Owner", label: "Staff", hint: "Employees and access", href: "/admin/staff", icon: UserCog, ready: true, permission: "staff.manage" },
  { group: "Owner", label: "Settings", hint: "Business details", href: "/admin/settings", icon: Settings, ready: true, permission: "settings.manage" },
  { group: "Owner", label: "Activity Log", hint: "Who did what", href: "/admin/audit", icon: ScrollText, ready: true, permission: "audit.view" },
];

export const PORTAL_NAV: NavItem[] = [
  { label: "My Stock", hint: "What I have stored", href: "/portal", primary: true, icon: Boxes, ready: true },
  { label: "My History", hint: "Goods in and out", href: "/portal/transactions", primary: true, icon: ArrowDownToLine, ready: true },
  { label: "Bills & Payments", hint: "Statements, invoices", href: "/portal/documents", primary: true, icon: FileText, ready: true },
  { label: "Request Goods", hint: "Ask for delivery", href: "/portal/requests", primary: true, icon: ClipboardList, ready: true },
];

export function visibleNav(items: NavItem[], ctx: AuthContext) {
  return items.filter((i) => i.ready && (!i.permission || ctx.can(i.permission)) && (!i.roles || i.roles.includes(ctx.role)));
}
