# Cold Storage Management System

Next.js 16 (App Router, TypeScript strict) · Tailwind 4 · Supabase (Postgres, Auth, RLS) · installable PWA.
Three experiences on one database: **admin/manager/accountant**, **warehouse staff (mobile friendly)**, **customer portal**.

See `DEVELOPMENT_PLAN.md` (status, limitations, open client questions) and `DATABASE_SCHEMA.md`.

All modules are implemented: masters, storage, inward/outward, inventory, billing, reports with PDF/Excel/CSV export, customer portal, staff, settings, audit logs, PWA.

## Requirements
Node 22+, a free Supabase project, (for tests) a local PostgreSQL 16.

## First run
1. **Create a Supabase project** (supabase.com → New project). Note *Project URL*, *anon/publishable key*, *service_role key* (Settings → API).
2. **Apply the database.** Either
   - Supabase CLI: `supabase link --project-ref <ref> && supabase db push`, or
   - SQL Editor: run `supabase/migrations/0001…0009` **in order**.
3. `cp .env.example .env.local` and fill in the three values. `SUPABASE_SERVICE_ROLE_KEY` is server-only — never prefix it with `NEXT_PUBLIC_`, never commit it.
4. `npm install`
5. **Create the first Owner:** `npm run bootstrap:admin -- owner@yourdomain.com 'a-long-password' 'Owner Name'`
6. `npm run dev` → http://localhost:3000, sign in.
7. Supabase → Authentication → Providers: keep *Email* on; **disable public sign-ups** (accounts are created by the office); set the Site URL to your deployed domain.

## Scripts
| | |
|---|---|
| `npm run dev / build / start` | run the app |
| `npm run typecheck`, `npm run lint` | static checks |
| `npm test` | database tests (rebuilds local test DB `coldstore_test` from the migrations first) |
| `npm run check` | typecheck + lint + tests + production build |

### Running the DB tests
Needs a local PostgreSQL superuser. Defaults to `postgres://cs_admin:cs_admin_pw@127.0.0.1:5432/postgres`; override with `ADMIN_URL`. The reset script refuses any database whose name does not contain `test`, `local` or `dev`. `supabase/tests/00_supabase_shim.sql` emulates `auth.uid()` and the Supabase roles for plain Postgres — it is test-only and never part of migrations.

What the tests prove (65): party/product creation and codes; inward totals; stock increases; partial outward; oversell rejected (bags **and** kgs) without burning a document number; party/floor/chamber totals equal the ledger; customer isolation across every table and view; customer cannot write by any route; cancellation reverses stock and is audited; cancelling an inward whose stock already left is rejected; back-dated oversell rejected; ledger append-only even for a superuser; **20 simultaneous outwards cannot oversell**; outward-vs-cancel and outward-vs-adjustment races resolve to exactly one winner; idempotent retries; gapless numbering under concurrency; permissions are configurable; inactive users/customers lose access; request workflow never deducts stock until the outward is made; modify never undershoots stock; invoices, receipts, ledger and reports reconcile; exports render. A mutation run (`MUTATE_NO_LOCK=1 npm test`) disables the lock and the race tests fail, confirming they have teeth.

## Deploying (Vercel + Supabase)
Import the repo into Vercel, set the three env vars, deploy. No other services are required. Free tiers are fine for development/testing; check current Vercel/Supabase terms before running a commercial client on them (Vercel Hobby is non-commercial; Supabase free projects pause after inactivity and have no daily backups — use a paid plan for production).

## Security notes
- RLS is enabled on every table; `anon` has no table privileges; stock/ledger/document tables have no write privileges for any API role.
- Server code re-validates the session with `auth.getUser()` on every request; `proxy.ts` is only an optimistic redirect.
- Service-role client is isolated in `src/lib/supabase/admin.ts` behind `server-only`.
- Security headers set in `next.config.ts`. A strict CSP is not configured yet.

## Quickest start
`npm install` then `npm run go` — asks for the secret key, DB password and an Owner login once, applies all migrations, creates the Owner and starts the app.

Note: `npm run go` creates the Owner directly in the database; the secret key is optional (only for creating staff/customer logins inside the app).

## For daily users
See `USER_GUIDE.md` — a one-page plain-language guide. The menu is grouped as: Home · Daily work (Goods In, Goods Out, Stock) · Money · Reports · Setup · Owner. Each item shows its traditional name underneath (Inward, Outward, Invoices…).
