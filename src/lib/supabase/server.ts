import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";

/** Per-request Supabase client acting as the signed-in user (RLS applies). */
export async function createClient() {
  const store = await cookies();     // first: marks the render as request-bound (dynamic) before anything can throw
  const env = publicEnv();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          /* called from a Server Component: the proxy refreshes the session instead */
        }
      },
    },
  });
}
