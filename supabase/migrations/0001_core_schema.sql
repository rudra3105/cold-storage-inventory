-- =====================================================================
-- 0001  Core schema: enums, masters, locations, transactions, ledgers
-- Stock is NEVER stored as an editable balance. The append-only table
-- public.stock_movements is the single source of truth.
-- =====================================================================

create schema if not exists app;                 -- private helpers (not exposed by PostgREST)
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- ---------- enums ----------------------------------------------------
create type public.app_role as enum ('super_admin','manager','staff','accountant','customer');
create type public.movement_type as enum ('inward','outward','adjustment','inward_reversal','outward_reversal');
create type public.doc_status as enum ('active','cancelled');
create type public.request_status as enum ('pending','approved','rejected','fulfilled','cancelled');
create type public.invoice_status as enum ('draft','issued','cancelled');

-- ---------- identity -------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null check (length(trim(full_name)) > 0),
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

create table public.user_roles (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  role        public.app_role not null,
  created_at  timestamptz not null default now(),
  created_by  uuid
);

create table public.permissions_catalog (
  key          text primary key,
  category     text not null,
  description  text not null
);

create table public.role_permissions (
  role        public.app_role not null,
  permission  text not null references public.permissions_catalog(key) on delete cascade,
  allowed     boolean not null default false,
  primary key (role, permission)
);

create table public.business_settings (
  id                        boolean primary key default true check (id),   -- singleton row
  business_name             text not null default 'Cold Storage',
  address                   text,
  phone                     text,
  email                     text,
  gst_number                text,
  logo_path                 text,
  timezone                  text not null default 'Asia/Kolkata',
  customer_can_see_rack     boolean not null default true,
  outward_requests_enabled  boolean not null default true,
  invoice_terms             text,
  created_at                timestamptz not null default now(),
  created_by                uuid,
  updated_at                timestamptz not null default now(),
  updated_by                uuid
);

-- ---------- document numbering (gapless per type + financial year) ---
create table public.doc_counters (
  doc_type  text not null,
  fy        text not null,
  last_no   bigint not null default 0,
  primary key (doc_type, fy)
);

-- ---------- masters --------------------------------------------------
create table public.parties (
  id               uuid primary key default gen_random_uuid(),
  party_code       text not null unique,
  name             text not null check (length(trim(name)) > 0),
  contact_person   text,
  mobile           text,
  email            text,
  address          text,
  city             text,
  state            text,
  gst_number       text check (gst_number is null or gst_number ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  opening_balance  numeric(14,2) not null default 0,   -- signed: + = party owes us (Dr), - = we owe party (Cr)
  user_id          uuid unique references auth.users(id) on delete set null,  -- customer login
  is_active        boolean not null default true,
  remarks          text,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid
);
create unique index parties_name_city_uq on public.parties (lower(trim(name)), lower(coalesce(trim(city),'')));
create index parties_user_idx on public.parties (user_id);

create table public.products (
  id                   uuid primary key default gen_random_uuid(),
  product_code         text not null unique,
  name                 text not null check (length(trim(name)) > 0),
  category             text,
  description          text,
  default_unit         text not null default 'BAG',
  default_kgs_per_bag  numeric(10,3) check (default_kgs_per_bag is null or default_kgs_per_bag > 0),
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  created_by           uuid,
  updated_at           timestamptz not null default now(),
  updated_by           uuid
);
create unique index products_name_uq on public.products (lower(trim(name)));

-- ---------- locations: chamber -> floor -> rack (fully data-driven) --
create table public.chambers (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

create table public.floors (
  id          uuid primary key default gen_random_uuid(),
  chamber_id  uuid not null references public.chambers(id) on delete restrict,
  floor_no    int  not null check (floor_no > 0),
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  unique (chamber_id, floor_no)
);
create index floors_chamber_idx on public.floors (chamber_id);

create table public.racks (
  id            uuid primary key default gen_random_uuid(),
  floor_id      uuid not null references public.floors(id) on delete restrict,
  code          text not null check (length(trim(code)) > 0),
  capacity_bags int check (capacity_bags is null or capacity_bags > 0),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  unique (floor_id, code)
);
create index racks_floor_idx on public.racks (floor_id);

-- ---------- inward ---------------------------------------------------
create table public.inward_transactions (
  id                 uuid primary key default gen_random_uuid(),
  inward_no          text not null unique,
  inward_date        date not null,
  party_id           uuid not null references public.parties(id) on delete restrict,
  vehicle_no         text,
  wb_kgs             numeric(14,3) check (wb_kgs is null or wb_kgs >= 0),   -- weighbridge kgs
  remarks            text,
  status             public.doc_status not null default 'active',
  cancelled_at       timestamptz,
  cancelled_by       uuid,
  cancel_reason      text,
  client_request_id  uuid unique,                                           -- idempotency for retries
  created_at         timestamptz not null default now(),
  created_by         uuid,
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create index inward_party_date_idx on public.inward_transactions (party_id, inward_date desc);
create index inward_date_idx on public.inward_transactions (inward_date desc);

create table public.inward_items (
  id             uuid primary key default gen_random_uuid(),
  inward_id      uuid not null references public.inward_transactions(id) on delete cascade,
  line_no        int  not null check (line_no > 0),
  product_id     uuid not null references public.products(id) on delete restrict,
  rack_id        uuid not null references public.racks(id) on delete restrict,
  bags           int  not null check (bags > 0),
  kgs_per_bag    numeric(10,3) not null check (kgs_per_bag > 0),
  total_kgs      numeric(14,3) generated always as (bags * kgs_per_bag) stored,
  wages_party    numeric(12,2) not null default 0 check (wages_party  >= 0),
  wages_labour   numeric(12,2) not null default 0 check (wages_labour >= 0),
  remarks        text,
  unique (inward_id, line_no)
);
create index inward_items_product_idx on public.inward_items (product_id);
create index inward_items_rack_idx on public.inward_items (rack_id);

-- ---------- outward requests (customer initiated) --------------------
create table public.outward_requests (
  id                    uuid primary key default gen_random_uuid(),
  request_no            text not null unique,
  party_id              uuid not null references public.parties(id) on delete restrict,
  product_id            uuid not null references public.products(id) on delete restrict,
  bags_requested        int  not null check (bags_requested > 0),
  preferred_date        date,
  remarks               text,
  status                public.request_status not null default 'pending',
  reviewed_by           uuid,
  reviewed_at           timestamptz,
  review_note           text,
  fulfilled_outward_id  uuid,                       -- FK added after outward table
  created_at            timestamptz not null default now(),
  created_by            uuid,
  updated_at            timestamptz not null default now(),
  updated_by            uuid
);
create index outward_requests_party_idx on public.outward_requests (party_id, created_at desc);
create index outward_requests_status_idx on public.outward_requests (status);

-- ---------- outward --------------------------------------------------
create table public.outward_transactions (
  id                  uuid primary key default gen_random_uuid(),
  outward_no          text not null unique,
  outward_date        date not null,
  party_id            uuid not null references public.parties(id) on delete restrict,
  vehicle_no          text,
  remarks             text,
  outward_request_id  uuid references public.outward_requests(id) on delete set null,
  status              public.doc_status not null default 'active',
  cancelled_at        timestamptz,
  cancelled_by        uuid,
  cancel_reason       text,
  client_request_id   uuid unique,
  created_at          timestamptz not null default now(),
  created_by          uuid,
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create index outward_party_date_idx on public.outward_transactions (party_id, outward_date desc);
create index outward_date_idx on public.outward_transactions (outward_date desc);

alter table public.outward_requests
  add constraint outward_requests_fulfilled_fk
  foreign key (fulfilled_outward_id) references public.outward_transactions(id) on delete set null;

create table public.outward_items (
  id             uuid primary key default gen_random_uuid(),
  outward_id     uuid not null references public.outward_transactions(id) on delete cascade,
  line_no        int  not null check (line_no > 0),
  product_id     uuid not null references public.products(id) on delete restrict,
  rack_id        uuid not null references public.racks(id) on delete restrict,
  bags           int  not null check (bags > 0),
  kgs_per_bag    numeric(10,3) not null check (kgs_per_bag > 0),
  total_kgs      numeric(14,3) generated always as (bags * kgs_per_bag) stored,
  wages_party    numeric(12,2) not null default 0 check (wages_party  >= 0),
  wages_labour   numeric(12,2) not null default 0 check (wages_labour >= 0),
  remarks        text,
  unique (outward_id, line_no)
);
create index outward_items_product_idx on public.outward_items (product_id);
create index outward_items_rack_idx on public.outward_items (rack_id);

-- ---------- stock adjustments ---------------------------------------
create table public.stock_adjustments (
  id          uuid primary key default gen_random_uuid(),
  adj_no      text not null unique,
  adj_date    date not null,
  party_id    uuid not null references public.parties(id) on delete restrict,
  product_id  uuid not null references public.products(id) on delete restrict,
  rack_id     uuid not null references public.racks(id) on delete restrict,
  bags_delta  int not null,
  kgs_delta   numeric(14,3) not null,
  reason      text not null check (length(trim(reason)) >= 5),
  created_at  timestamptz not null default now(),
  created_by  uuid,
  check (bags_delta <> 0 or kgs_delta <> 0)
);

-- ---------- THE STOCK LEDGER (append-only) ---------------------------
create table public.stock_movements (
  id              uuid primary key default gen_random_uuid(),
  movement_type   public.movement_type not null,
  movement_date   date not null,
  party_id        uuid not null references public.parties(id)  on delete restrict,
  product_id      uuid not null references public.products(id) on delete restrict,
  rack_id         uuid not null references public.racks(id)    on delete restrict,
  bags            int           not null,       -- signed
  kgs             numeric(14,3) not null,       -- signed
  inward_id       uuid references public.inward_transactions(id)  on delete restrict,
  outward_id      uuid references public.outward_transactions(id) on delete restrict,
  adjustment_id   uuid references public.stock_adjustments(id)    on delete restrict,
  reversal_of     uuid references public.stock_movements(id)      on delete restrict,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  -- sign rules per movement type
  constraint movement_sign_chk check (
       (movement_type in ('inward','outward_reversal')  and bags > 0 and kgs > 0)
    or (movement_type in ('outward','inward_reversal')  and bags < 0 and kgs < 0)
    or (movement_type = 'adjustment' and (bags <> 0 or kgs <> 0))
  ),
  -- exactly one source document, and it must match the type
  constraint movement_source_chk check (
       (movement_type in ('inward','inward_reversal')   and inward_id   is not null and outward_id is null and adjustment_id is null)
    or (movement_type in ('outward','outward_reversal') and outward_id  is not null and inward_id  is null and adjustment_id is null)
    or (movement_type = 'adjustment'                    and adjustment_id is not null and inward_id is null and outward_id is null)
  ),
  constraint movement_reversal_chk check ((movement_type in ('inward_reversal','outward_reversal')) = (reversal_of is not null))
);
create unique index stock_movements_reversal_uq on public.stock_movements (reversal_of) where reversal_of is not null;
create index stock_movements_key_idx   on public.stock_movements (party_id, product_id, rack_id, movement_date);
create index stock_movements_date_idx  on public.stock_movements (movement_date);
create index stock_movements_rack_idx  on public.stock_movements (rack_id);
create index stock_movements_inward_idx  on public.stock_movements (inward_id)  where inward_id  is not null;
create index stock_movements_outward_idx on public.stock_movements (outward_id) where outward_id is not null;

-- ---------- labour ---------------------------------------------------
create table public.labour_records (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('inward','outward')),
  record_date   date not null,
  party_id      uuid not null references public.parties(id)  on delete restrict,
  product_id    uuid not null references public.products(id) on delete restrict,
  inward_id     uuid references public.inward_transactions(id)  on delete cascade,
  outward_id    uuid references public.outward_transactions(id) on delete cascade,
  bags          int not null,
  wages_labour  numeric(12,2) not null default 0,
  wages_party   numeric(12,2) not null default 0,
  status        public.doc_status not null default 'active',
  created_at    timestamptz not null default now(),
  created_by    uuid,
  check ((kind = 'inward' and inward_id is not null and outward_id is null)
      or (kind = 'outward' and outward_id is not null and inward_id is null))
);
create index labour_date_idx on public.labour_records (kind, record_date);
create index labour_party_idx on public.labour_records (party_id);

-- ---------- billing --------------------------------------------------
create table public.charge_types (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  basis         text not null default 'manual' check (basis in ('manual','flat','per_bag','per_kg','per_bag_per_day','per_kg_per_day','per_bag_per_month','per_kg_per_month')),
  default_rate  numeric(12,4) check (default_rate is null or default_rate >= 0),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);

create table public.party_rates (            -- customer-specific rate overrides
  id              uuid primary key default gen_random_uuid(),
  party_id        uuid not null references public.parties(id) on delete cascade,
  charge_type_id  uuid not null references public.charge_types(id) on delete restrict,
  product_id      uuid references public.products(id) on delete restrict,
  rate            numeric(12,4) not null check (rate >= 0),
  effective_from  date not null default current_date,
  effective_to    date,
  notes           text,
  created_at      timestamptz not null default now(),
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  check (effective_to is null or effective_to >= effective_from)
);
create index party_rates_party_idx on public.party_rates (party_id);

create table public.invoices (
  id            uuid primary key default gen_random_uuid(),
  invoice_no    text unique,                 -- assigned when issued (keeps issued numbers gapless)
  invoice_date  date not null,
  due_date      date,
  party_id      uuid not null references public.parties(id) on delete restrict,
  period_from   date,
  period_to     date,
  status        public.invoice_status not null default 'draft',
  notes         text,
  cancelled_at  timestamptz,
  cancelled_by  uuid,
  cancel_reason text,
  created_at    timestamptz not null default now(),
  created_by    uuid,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  check (status <> 'issued' or invoice_no is not null),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create index invoices_party_idx on public.invoices (party_id, invoice_date desc);

create table public.invoice_items (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references public.invoices(id) on delete cascade,
  line_no         int not null check (line_no > 0),
  description     text not null,
  charge_type_id  uuid references public.charge_types(id) on delete set null,
  quantity        numeric(14,3) not null check (quantity >= 0),
  unit            text,
  rate            numeric(12,4) not null check (rate >= 0),
  tax_percent     numeric(5,2) not null default 0 check (tax_percent >= 0 and tax_percent <= 100),
  amount          numeric(14,2) generated always as (round(quantity * rate, 2)) stored,
  tax_amount      numeric(14,2) generated always as (round(round(quantity * rate, 2) * tax_percent / 100, 2)) stored,
  unique (invoice_id, line_no)
);

create table public.receipts (               -- money RECEIVED from a party
  id             uuid primary key default gen_random_uuid(),
  receipt_no     text not null unique,
  receipt_date   date not null,
  party_id       uuid not null references public.parties(id) on delete restrict,
  amount         numeric(14,2) not null check (amount > 0),
  payment_mode   text not null check (payment_mode in ('cash','bank_transfer','upi','cheque','other')),
  reference_no   text,
  remarks        text,
  status         public.doc_status not null default 'active',
  cancelled_at   timestamptz,
  cancelled_by   uuid,
  cancel_reason  text,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create index receipts_party_idx on public.receipts (party_id, receipt_date desc);

create table public.receipt_allocations (
  id          uuid primary key default gen_random_uuid(),
  receipt_id  uuid not null references public.receipts(id) on delete cascade,
  invoice_id  uuid not null references public.invoices(id) on delete restrict,
  amount      numeric(14,2) not null check (amount > 0),
  unique (receipt_id, invoice_id)
);

create table public.payments (               -- money PAID OUT (labour, refunds, expenses)
  id             uuid primary key default gen_random_uuid(),
  payment_no     text not null unique,
  payment_date   date not null,
  party_id       uuid references public.parties(id) on delete restrict,   -- null for non-party payees
  payee_name     text not null,
  purpose        text,
  amount         numeric(14,2) not null check (amount > 0),
  payment_mode   text not null check (payment_mode in ('cash','bank_transfer','upi','cheque','other')),
  reference_no   text,
  remarks        text,
  status         public.doc_status not null default 'active',
  cancelled_at   timestamptz,
  cancelled_by   uuid,
  cancel_reason  text,
  created_at     timestamptz not null default now(),
  created_by     uuid,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create index payments_party_idx on public.payments (party_id, payment_date desc);

create table public.party_ledger (           -- append-only; balance = opening + sum(debit) - sum(credit)
  id          uuid primary key default gen_random_uuid(),
  party_id    uuid not null references public.parties(id) on delete restrict,
  entry_date  date not null,
  entry_type  text not null check (entry_type in ('invoice','invoice_reversal','receipt','receipt_reversal','payment','payment_reversal','adjustment')),
  invoice_id  uuid references public.invoices(id) on delete restrict,
  receipt_id  uuid references public.receipts(id) on delete restrict,
  payment_id  uuid references public.payments(id) on delete restrict,
  debit       numeric(14,2) not null default 0 check (debit  >= 0),
  credit      numeric(14,2) not null default 0 check (credit >= 0),
  narration   text,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  check ((debit > 0) <> (credit > 0))
);
create index party_ledger_party_idx on public.party_ledger (party_id, entry_date, created_at);

-- ---------- misc -----------------------------------------------------
create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  bucket       text not null default 'documents',
  path         text not null,
  file_name    text not null,
  mime_type    text,
  size_bytes   bigint check (size_bytes is null or size_bytes >= 0),
  party_id     uuid references public.parties(id) on delete restrict,   -- owner party (drives customer visibility)
  entity_type  text,
  entity_id    uuid,
  uploaded_by  uuid,
  created_at   timestamptz not null default now(),
  unique (bucket, path)
);
create index attachments_party_idx on public.attachments (party_id);

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  body        text,
  link        text,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, is_read, created_at desc);

create table public.audit_logs (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  user_id     uuid,
  action      text not null,
  table_name  text not null,
  record_id   text,
  old_data    jsonb,
  new_data    jsonb,
  meta        jsonb
);
create index audit_logs_table_idx on public.audit_logs (table_name, record_id);
create index audit_logs_at_idx on public.audit_logs (at desc);
create index audit_logs_user_idx on public.audit_logs (user_id);
