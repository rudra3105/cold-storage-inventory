// Creates (or repairs) the first Super Admin. Run once after the migrations:
//   npm run bootstrap:admin -- owner@example.com 'a-strong-password' 'Owner Name'
// Uses the service-role key from .env.local. Never expose that key to the browser.
import { createClient } from "@supabase/supabase-js";

const [email, password, fullName = "Owner"] = process.argv.slice(2);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!email || !password || !url || !key) {
  console.error("Usage: npm run bootstrap:admin -- <email> <password> [full name]\nNeeds NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
if (password.length < 12) { console.error("Use a password of at least 12 characters."); process.exit(1); }

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

let userId;
const created = await sb.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error) {
  if (!/already|registered|exists/i.test(created.error.message)) { console.error("Could not create user:", created.error.message); process.exit(1); }
  const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  userId = data?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
  if (!userId) { console.error("User exists but could not be located."); process.exit(1); }
  console.log("Auth user already existed; ensuring profile and role.");
} else {
  userId = created.data.user.id;
}

const p = await sb.from("profiles").upsert({ id: userId, full_name: fullName, is_active: true });
if (p.error) { console.error("profiles:", p.error.message); process.exit(1); }
const r = await sb.from("user_roles").upsert({ user_id: userId, role: "super_admin" });
if (r.error) { console.error("user_roles:", r.error.message); process.exit(1); }
console.log(`Super Admin ready: ${email} (${userId})`);
