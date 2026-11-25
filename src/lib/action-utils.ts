import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getAuthContext, type AuthContext } from "@/lib/auth/context";

export type ActionResult<T = Record<string, unknown>> = { ok: true; data: T } | { ok: false; error: string };
export const ok = <T,>(data: T): ActionResult<T> => ({ ok: true, data });
export const fail = (error: string): ActionResult<never> => ({ ok: false, error });

/** Turn a Postgres/PostgREST error into a message a warehouse clerk can act on. */
export function friendlyError(e: { message?: string; code?: string; details?: string } | null | undefined): string {
  const m = e?.message ?? "Something went wrong";
  if (e?.code === "42501" || /row-level security/i.test(m)) return /Permission denied: (.+)/.exec(m) ? m : "You do not have permission to do this.";
  if (e?.code === "23505") {
    if (/parties_name_city_uq/.test(m)) return "A party with this name and city already exists.";
    if (/products_name_uq/.test(m)) return "A product with this name already exists.";
    if (/racks_floor_id_code_key/.test(m)) return "This floor already has a rack with that code.";
    if (/chambers_code_key/.test(m)) return "A chamber with that code already exists.";
    return "This record already exists.";
  }
  if (e?.code === "23503") return "This record is referenced by other data and cannot be changed this way.";
  if (e?.code === "23514" && /gst_number/.test(m)) return "GST number format is invalid.";
  if (e?.code === "40001") return "Another submission is in progress, please retry.";
  return m.replace(/^Invalid input: /, "Invalid input: ");
}

/** Signed-in context for a server action: re-validates the session and (optionally) a permission. */
export async function actionContext(permission?: string): Promise<{ ctx: AuthContext; supabase: Awaited<ReturnType<typeof createClient>> } | { error: string }> {
  const ctx = await getAuthContext();
  if (!ctx) return { error: "Your session has expired. Please sign in again." };
  if (permission && !ctx.can(permission)) return { error: "You do not have permission to do this." };
  return { ctx, supabase: await createClient() };
}

export async function callRpc<T = Record<string, unknown>>(permission: string | null, fn: string, args: Record<string, unknown>): Promise<ActionResult<T>> {
  const a = await actionContext(permission ?? undefined);
  if ("error" in a) return fail(a.error);
  const { data, error } = await a.supabase.rpc(fn, args);
  if (error) return fail(friendlyError(error));
  return ok(data as T);
}
