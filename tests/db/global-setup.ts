import { execFileSync } from "node:child_process";
import path from "node:path";

/** Rebuilds the local TEST database from supabase/migrations before the suite runs. */
export default function setup() {
  const adminUrl = process.env.ADMIN_URL ?? "postgres://cs_admin:cs_admin_pw@127.0.0.1:5432/postgres";
  execFileSync(path.resolve(__dirname, "../../scripts/db-reset.sh"), [], {
    env: { ...process.env, ADMIN_URL: adminUrl, DB_NAME: "coldstore_test" },
    stdio: "inherit",
  });
  process.env.TEST_DB_URL = adminUrl.replace(/\/[^/]*$/, "/coldstore_test");
  // Mutation check (dev only): MUTATE_NO_LOCK=1 disables the per-stock-position lock; the concurrency tests MUST then fail.
  if (process.env.MUTATE_NO_LOCK === "1") {
    execFileSync("psql", [process.env.TEST_DB_URL, "-v", "ON_ERROR_STOP=1", "-q", "-c",
      "create or replace function app.lock_stock_key(p_party uuid, p_product uuid, p_rack uuid) returns void language plpgsql as 'begin end'"], { stdio: "inherit" });
  }
}
