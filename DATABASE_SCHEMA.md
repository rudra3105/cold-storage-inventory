# Database schema

PostgreSQL (Supabase). Migrations in `supabase/migrations`, applied in order. Private helper functions live in schema `app` (not exposed by the API); callable RPCs live in `public`.

## Tables
| Group | Tables |
|---|---|
| Identity | `profiles` (1:1 `auth.users`), `user_roles` (one role per user), `permissions_catalog`, `role_permissions`, `business_settings` (singleton) |
| Masters | `parties` (`user_id` = customer login), `products` |
| Locations | `chambers` → `floors` → `racks` (all data-driven; seeded: A/B/C × floors 1–5; racks defined by the client) |
| Inward | `inward_transactions` (header) → `inward_items` (lines; `total_kgs = bags × kgs_per_bag` is a generated column) |
| Outward | `outward_requests` (customer) → `outward_transactions` → `outward_items` |
| Ledger | `stock_movements` (**append-only**, signed bags/kgs), `stock_adjustments` (append-only, reason required) |
| Labour | `labour_records` (written by the inward/outward RPCs; cancelled with the document) |
| Billing | `charge_types`, `party_rates`, `invoices`, `invoice_items` (amount generated), `receipts`, `receipt_allocations`, `payments`, `party_ledger` (**append-only**) |
| Support | `attachments`, `notifications`, `audit_logs` (**append-only**), `doc_counters` |

Money: `numeric(14,2)`; rates `numeric(12,4)`; weights `numeric(14,3)`; bags `integer`.

## Views
- `stock_balances` — per (party, product, rack) with floor/chamber: inward, outward, adjustment and available bags/kgs. `security_invoker`, so RLS of the caller applies (customers see only themselves).
- `party_ledger_balances` — opening balance + debits − credits. Sign convention: **positive = party owes us**.

## Invariants (enforced by the database)
1. `stock_movements` rows can never be updated, deleted or truncated (trigger).
2. Signs by type: inward / outward-reversal > 0; outward / inward-reversal < 0; exactly one source document per movement.
3. After any decreasing movement, the running balance by date for that (party, product, rack) is ≥ 0 in **both bags and kgs** (trigger, under a per-position advisory lock).
4. One reversal per movement (`unique(reversal_of)`).
5. A rack cannot change floor, nor be deactivated while it holds stock; same for floor/chamber deactivation.
6. Document numbers are unique and allocated inside the same transaction as the document.

## Write path (RPCs, all `SECURITY DEFINER`, `search_path=''`, permission-checked, executable by `authenticated` only)
`create_inward`, `cancel_inward`, `create_outward`, `cancel_outward`, `post_stock_adjustment`, `create_outward_request`, `review_outward_request`, `cancel_outward_request`. Read helper: `dashboard_summary()` (SECURITY INVOKER).
Planned: `update_inward`, `update_outward` (modify), invoice/receipt/payment RPCs.

## Permissions (defaults; editable in `role_permissions`; Owner always has all)
| Permission | Manager | Staff | Accountant |
|---|---|---|---|
| inward.create / outward.create | ✔ | ✔ | – |
| inward.update / outward.update | ✔ | – | – |
| inward.cancel / outward.cancel / stock.adjust | – | – | – |
| request.review | ✔ | – | – |
| location.manage | ✔ | – | – |
| party.manage / product.manage | – | – | – |
| billing.view / billing.manage | – | – | ✔ |
| labour.view / reports.view | ✔ | – | ✔ |
| staff.manage / settings.manage / audit.view | – | – | – |

## RLS summary
| Data | Internal roles | Customer |
|---|---|---|
| parties, stock_movements, inward/outward documents, outward_requests | all (operational) | own `party_id` only |
| invoices | with `billing.view` | own, **issued/cancelled only** (never drafts) |
| receipts, payments, party_ledger | with `billing.view` | own party only |
| products, chambers/floors/racks | read | read (shared reference data, no customer data) |
| audit_logs | `audit.view` | none |
| stock_adjustments, labour_records, rates, charge types | by permission | none |
| any write to stock/ledger/document tables | **none — RPC only** | none |

A customer is bound to a party through `parties.user_id` (unique). Deactivating the party or the profile removes all access immediately (policies call `app.current_party_id()` / `app.user_role()` live, not JWT claims).

## Later migrations
- `0007_modify_and_billing.sql` — `update_inward`, `update_outward` (insert new rows first, then reversals; outward modify returns stock before validating), `set_role_permission` (Owner only), permissions `inward.update` / `outward.update`.
- `0008_billing.sql` — view `invoice_balances`; `save_invoice` (drafts), `issue_invoice` (assigns number, debits ledger), `cancel_invoice` (blocked while receipts are allocated), `create_receipt` (+allocations, over-allocation checks), `cancel_receipt`, `create_payment`, `cancel_payment`, `ledger_statement`.
- `0009_reports.sql` — views `v_inward_lines`, `v_outward_lines`, `v_stock_detail`, `v_labour`; functions `stock_register`, `floor_report` (all 15 floors), `rojmel` (provisional).

## Speed design (migration 0010)
- `stock_movements` stays the only source of truth. `stock_position` is a small table (one row per party + product + rack) updated by a trigger inside the same transaction as every ledger insert; `stock_balances` reads from it. `select * from public.verify_stock_position()` (run as database owner) compares it to the ledger and must return no rows.
- RLS policies evaluate role helpers once per query (`(select app.is_internal())`), not once per row.
- `app_session()` returns profile, role, permissions, party and business name in one call; the app verifies the login token locally (`getClaims`).
- Measured locally on 3,000,000 ledger rows: stock totals / home summary 13 ms (previously minutes), stock list 1 ms, one month of movements 21 ms.
