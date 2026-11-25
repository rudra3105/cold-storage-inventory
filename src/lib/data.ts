import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Opt = { id: string; label: string };
export type Rack = { id: string; code: string; floor_id: string; is_active: boolean; capacity_bags: number | null };
export type Floor = { id: string; chamber_id: string; floor_no: number; is_active: boolean };
export type Chamber = { id: string; code: string; name: string; is_active: boolean; sort_order: number };
export type Product = { id: string; name: string; default_kgs_per_bag: number | null; default_unit: string; is_active: boolean };
export type Party = { id: string; name: string; party_code: string; city: string | null; is_active: boolean };

/** Reference data used by every transaction form. RLS applies (customers get only what they may read). */
export async function loadMasters(opts: { includeInactive?: boolean } = {}) {
  const supabase = await createClient();
  const [parties, products, chambers, floors, racks] = await Promise.all([
    supabase.from("parties").select("id,name,party_code,city,is_active").order("name"),
    supabase.from("products").select("id,name,default_kgs_per_bag,default_unit,is_active").order("name"),
    supabase.from("chambers").select("id,code,name,is_active,sort_order").order("sort_order").order("code"),
    supabase.from("floors").select("id,chamber_id,floor_no,is_active").order("floor_no"),
    supabase.from("racks").select("id,code,floor_id,is_active,capacity_bags").order("code"),
  ]);
  const err = parties.error ?? products.error ?? chambers.error ?? floors.error ?? racks.error;
  if (err) throw new Error(`Could not load master data: ${err.message}`);
  const keep = <T extends { is_active: boolean }>(l: T[] | null) => (l ?? []).filter((x) => opts.includeInactive || x.is_active);
  return {
    parties: keep(parties.data as Party[]), products: keep(products.data as Product[]),
    chambers: keep(chambers.data as Chamber[]), floors: keep(floors.data as Floor[]), racks: keep(racks.data as Rack[]),
  };
}

export function today() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });   // YYYY-MM-DD in business time zone
}
export function monthStart() { return today().slice(0, 8) + "01"; }

export function one<T>(v: T | T[] | null | undefined): T | null { return Array.isArray(v) ? (v[0] ?? null) : (v ?? null); }
export function qp(v: string | string[] | undefined): string | undefined { const s = Array.isArray(v) ? v[0] : v; return s && s.trim() ? s.trim() : undefined; }
export function isUuid(v: string | undefined) { return !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v); }
export function isDate(v: string | undefined) { return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v); }
