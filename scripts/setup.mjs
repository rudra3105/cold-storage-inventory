// One-command setup + start:  npm run go
// 1) asks for anything missing (DB password, service key, owner login) 2) applies DB migrations
// 3) creates the Owner 4) starts the app. Safe to re-run: applied migrations are skipped.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { spawn } from "node:child_process";
import pg from "pg";

const ENV = ".env.local";
const read = () => Object.fromEntries((fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8") : "").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const save = (k, v) => { let t = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8") : ""; t = new RegExp(`^${k}=`, "m").test(t) ? t.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : t + (t.endsWith("\n") || !t ? "" : "\n") + `${k}=${v}\n`; fs.writeFileSync(ENV, t); };
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q, def) => ((await rl.question(q + (def ? ` [${def}]` : "") + ": ")).trim() || def || "");

const env = read();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY || url.includes("YOUR-")) { console.error(`Fill NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in ${ENV} first.`); process.exit(1); }
const ref = new URL(url).hostname.split(".")[0];

// ---- database ----
let conn = env.DATABASE_URL;
if (!conn) {
  console.log("\nDatabase password = the one you set when creating the Supabase project (Settings -> Database to reset). Not saved to disk.");
  const pw = await ask("Database password");
  conn = `postgresql://postgres:${encodeURIComponent(pw)}@db.${ref}.supabase.co:5432/postgres`;
}
let client;
const connect = async (c) => { const x = new pg.Client({ connectionString: c, ssl: { rejectUnauthorized: false } }); await x.connect(); return x; };
try { client = await connect(conn); }
catch (e) {
  console.error(`\nCould not connect: ${e.message}`);
  console.log("If it says ENOTFOUND / ENETUNREACH your network lacks IPv6. In Supabase click 'Connect' -> 'Session pooler' and copy that URI (replace [YOUR-PASSWORD]).");
  conn = await ask("Paste Session pooler URI (or press Enter to quit)");
  if (!conn) process.exit(1);
  client = await connect(conn);
}
console.log("Connected to database.");
await client.query(`create table if not exists public._applied_migrations (name text primary key, applied_at timestamptz not null default now());
  alter table public._applied_migrations enable row level security; revoke all on public._applied_migrations from anon, authenticated;`);
const done = new Set((await client.query("select name from public._applied_migrations")).rows.map((r) => r.name));
const dir = "supabase/migrations";
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  if (done.has(f)) { console.log(`  skip   ${f}`); continue; }
  try {
    await client.query("begin"); await client.query(fs.readFileSync(path.join(dir, f), "utf8"));
    await client.query("insert into public._applied_migrations(name) values ($1)", [f]); await client.query("commit");
    console.log(`  applied ${f}`);
  } catch (e) { await client.query("rollback"); console.error(`\nMigration ${f} failed: ${e.message}\nNothing from this file was kept. If tables already exist from an earlier attempt, reset the project's schema (Supabase SQL: drop schema public cascade; create schema public;) and re-run.`); process.exit(1); }
}
const hasOwner = (await client.query("select 1 from public.user_roles where role = 'super_admin' limit 1")).rowCount > 0;

// ---- owner (created directly in the database: no API key needed) ----
if (!hasOwner) {
  console.log("\nCreate the Owner login (you will sign in with this).");
  const email = (await ask("Owner email")).toLowerCase(); const name = await ask("Owner name", "Owner");
  let password = ""; while (password.length < 12) { password = await ask("Owner password (min 12 chars)"); }
  try {
    await client.query("begin");
    const ex = await client.query("select id from auth.users where lower(email) = $1", [email]);
    let id = ex.rows[0]?.id;
    if (!id) {
      id = (await client.query(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
        values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1, extensions.crypt($2, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '') returning id`, [email, password])).rows[0].id;
      await client.query(`insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        values (gen_random_uuid(), $1::uuid, $1::uuid::text, jsonb_build_object('sub', $1::uuid::text, 'email', $2::text, 'email_verified', true), 'email', now(), now(), now())`, [id, email]);
    } else { await client.query("update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')), email_confirmed_at = coalesce(email_confirmed_at, now()) where id = $1", [id, password]); }
    await client.query("insert into public.profiles (id, full_name, is_active) values ($1, $2, true) on conflict (id) do update set full_name = excluded.full_name, is_active = true", [id, name]);
    await client.query("insert into public.user_roles (user_id, role) values ($1, 'super_admin') on conflict (user_id) do update set role = 'super_admin'", [id]);
    await client.query("commit");
    console.log(`Owner ready: ${email}`);
  } catch (e) { await client.query("rollback"); console.error("Could not create the Owner:", e.message); process.exit(1); }
} else console.log("Owner already exists.");
await client.end();

// ---- optional: secret key, only needed later to create staff / customer logins from inside the app ----
const clean = (v) => (v || "").replace(/^["']|["']$/g, "").trim();
let service = clean(read().SUPABASE_SERVICE_ROLE_KEY);
const looksValid = (k) => k.length > 30 && !/\s/.test(k) && k !== clean(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
if (!looksValid(service)) {
  console.log("\nOptional: to create staff/customer logins inside the app, paste your SECRET key (Supabase -> Settings -> API Keys, starts with sb_secret_ or eyJ). Press Enter to skip.");
  service = clean(await ask("Secret key"));
  if (looksValid(service)) save("SUPABASE_SERVICE_ROLE_KEY", service);
  else if (service) console.log("That does not look like a secret key; skipped. You can add it later in .env.local.");
}
rl.close();
console.log("\nStarting the app at http://localhost:3000 ...\n");
spawn("npx", ["next", "dev"], { stdio: "inherit", shell: true });
