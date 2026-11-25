# Development Plan — Cold Storage Management System

Status legend: ✅ done and verified · 🟡 partly done · ⬜ not started

## Guiding rules
1. **The stock ledger is the only source of truth.** `stock_movements` is append-only; balances are always computed from it. Nothing writes a balance.
2. **All stock/document writes go through transactional SQL functions** (`create_inward`, `create_outward`, `cancel_*`, `post_stock_adjustment`, request RPCs). No role — not even Owner — has direct INSERT/UPDATE/DELETE on those tables.
3. **Isolation is enforced in Postgres (RLS)**, not in React. Customer queries are scoped by `party_id = app.current_party_id()`.
4. **Nothing is shown unless it works.** Navigation lists only routes that exist (`ready` flag in `src/lib/nav.ts`).

## Status (everything built in one pass)

| Module | Status |
|---|---|
| Foundation: auth, roles, configurable permissions, RLS, schema, audit, PWA | ✅ |
| Party master (+ customer login), product master, chambers/floors/racks | ✅ |
| Inward / Outward: multi-line, printable receipt, modify, cancel (reversal), Make New / Show All / Add Product / Refresh | ✅ |
| Inventory (ledger-computed), adjustments with reason, history | ✅ |
| Billing: invoices (draft → issue → cancel), receipts with allocations, payments, party ledger, charge types and party rates | ✅ (no formula assumed; see Open questions) |
| Reports: Ledger, Inward/Outward registers (+daily), Stock register (+monthly), Labour inward/outward, Cold Stock-Party, Party-wise, Party history, Floor-wise (all 15 floors), Transaction summary — filters, print, PDF, Excel, CSV | ✅ |
| Rojmel | 🟡 provisional layout; meaning must be confirmed with the client |
| Customer portal: overview, inventory, transactions (All/Inward/Outward), documents (invoices, receipts, statements PDF/Excel), outward requests | ✅ |
| Admin: dashboard, outward-request review, customer logins, staff, settings + role-permission matrix, audit logs | ✅ |
| PWA: manifest, service worker, offline page, no offline stock writes | ✅ |
| Verified against a real Supabase project (Auth/PostgREST/Storage round-trip) | ⬜ not possible in the build sandbox; first run is the integration check |

Routes: `/admin/{parties,products,storage,inward,outward,inventory,invoices,receipts,payments,rates,requests,reports,customers,staff,settings,audit}` and `/portal/{,inventory,transactions,documents,requests}`; downloads at `/api/pdf/[kind]/[id]` and `/api/export/[slug]?format=pdf|xlsx|csv`.

## Known limitations
- PDFs use standard Latin-1 fonts: non-Latin text (e.g. Gujarati/Hindi names) prints as `?`; `₹` prints as `Rs.`. Excel/CSV keep full Unicode. Embedding a Unicode font is the fix.
- Notifications are written to the database (`notifications`) but there is no in-app notification UI yet.
- No strict Content-Security-Policy yet (other security headers are set).
- Reports page through PostgREST with a 50k-row safety cap; move heavy ones to SQL functions if data grows.
- The attachments table exists in the schema but has no UI.
- Password reset for customers/staff is done by an administrator (no self-service email flow).

## Key design decisions (and why)
- **Stock position = (party, product, rack)**; chamber/floor are derived from the rack, so every unit is traceable Chamber → Floor → Rack. Racks cannot move floors and cannot be deactivated while holding stock.
- **Both bags and kgs are tracked and both must stay ≥ 0.** Outward is validated on each.
- **Concurrency:** every ledger insert takes `pg_advisory_xact_lock` on the stock position; a post-insert trigger re-verifies the running balance *by date* never goes negative (this also blocks back-dated oversell and cancelling an inward whose stock already left). Verified with a mutation test (removing the lock makes the race tests fail).
- **Cancellation = reversal rows**, never deletion. Reversals carry the original movement date so registers for past dates treat a cancelled document as if it never happened; the audit log records who/why/when.
- **Document numbers** `INW/2026-27/00001` (financial year Apr–Mar), gapless: numbers are only consumed by successful transactions. Side effect: creating documents of one type is serialised on its counter row — fine for one warehouse, noted for scale.
- **Idempotency:** `client_request_id` on inward/outward so a mobile retry never double-posts.
- **Dates:** documents may be back-dated but never future-dated; "today" uses the business time zone (default Asia/Kolkata).
- **Permissions are data:** `role_permissions` (editable by Owner) drive create/cancel/adjust/review rights; Owner always has all.
- **cacheComponents is off** in Next config: stock must never be served from a render cache.
- **Service worker** caches only static assets; page navigations are network-only with an offline notice. There is deliberately **no offline write queue**.

## Open questions — need client confirmation before finalising
1. **Old-software screenshots were not received** with the brief. Fields were built from the written field list; the layout/labels should be compared against the screenshots.
2. **Rojmel**: exact meaning and layout (daily cash book? daily stock movement journal?). A provisional daily journal exists and is labelled provisional.
3. **Receipt vs Payment**: built as *Receipt = money received from a party*, *Payment = money paid out* (labour, refunds, expenses). Confirm.
4. **Billing**: charge types are seeded (Storage, Handling, Labour, Loading/Unloading, Other) with *no* formula. Need: how storage is charged (per bag/kg, per day/month/season, minimum charge?), GST applicability and rates, invoice numbering format.
5. **Wages / Party vs Wages / Labour** and **WB Kgs**: implemented as wages per product line (party-charged and labour-paid) and WB kgs once per vehicle on the inward header. Confirm meaning, and whether WB kgs should be validated against total kgs.
6. **Partial-bag / kg residue**: if bags reach 0 but kgs remain (different bag weights in/out), the residual stays until a recorded adjustment. Confirm whether bags or kgs is the primary unit.
7. **Edit / modify rules** for inward/outward after save (who, how long, effect on invoices already raised). Built: permissions `inward.update` / `outward.update` (Manager by default); modify never lets stock go negative, and the audit trail keeps the original.
8. **Opening stock migration** from M.N. AGRO FRESH: provide an export, or enter as back-dated inward.
9. **Customer logins**: email or mobile as the username? (Supabase password login is built; mobile/OTP login needs an SMS provider = paid.)
10. **Rack visibility to customers** is a setting (`customer_can_see_rack`, default on).
11. **Business details** (name, address, GSTIN, logo, invoice terms) for receipts and invoices.

## What was verified
- DB migrations `supabase/migrations/0001…0009` apply cleanly to PostgreSQL 16.
- 65 automated tests (`npm test`): stock integrity, concurrency races, RLS isolation, modify, billing, reports, permissions, and PDF/Excel/CSV generation. `MUTATE_NO_LOCK=1 npm test` makes the race tests fail, proving they have teeth.
- `tsc --noEmit`, ESLint (0 errors) and `next build` pass; the production server redirects unauthenticated users and serves the PWA assets.
- **Not verifiable in the build sandbox:** real Supabase Auth/PostgREST/Storage round-trips. Expect small integration fixes on first run against your project (README § First run).
