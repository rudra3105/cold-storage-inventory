import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. BYPASSES RLS. Server-only (the `server-only` import makes any
 * client-side import a build error). Use exclusively inside server actions that have
 * already verified the caller's permission, e.g. creating staff / customer logins.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
