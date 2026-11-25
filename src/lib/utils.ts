import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const IN = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
export const fmtNum = (n: number | string | null | undefined) => (n == null || n === "" ? "—" : IN.format(Number(n)));
export const fmtKg = (n: number | string | null | undefined) => (n == null || n === "" ? "—" : `${IN.format(Number(n))} kg`);
export const fmtMoney = (n: number | string | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(n));
export const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
