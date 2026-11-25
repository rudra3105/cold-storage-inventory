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
-- =====================================================================
-- 0002  Helpers, audit triggers, append-only guards, stock invariant
-- =====================================================================

-- ---------- identity helpers (SECURITY DEFINER so RLS can call them) -
create function app.user_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select ur.role
  from public.user_roles ur
  join public.profiles p on p.id = ur.user_id
  where ur.user_id = auth.uid() and p.is_active
$$;

create function app.is_internal() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.user_role() in ('super_admin','manager','staff','accountant'), false)
$$;

create function app.has_permission(p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when app.user_role() is null then false
    when app.user_role() = 'super_admin' then true
    else coalesce((select rp.allowed from public.role_permissions rp
                   where rp.role = app.user_role() and rp.permission = p_permission), false)
  end
$$;

create function app.current_party_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.parties p
  where p.user_id = auth.uid() and p.is_active and app.user_role() = 'customer'
$$;

create function app.require_permission(p_permission text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not app.has_permission(p_permission) then
    raise exception 'Permission denied: %', p_permission using errcode = '42501';
  end if;
end $$;

create function app.business_today() returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce((select timezone from public.business_settings limit 1), 'UTC'))::date
$$;

-- ---------- document numbers ----------------------------------------
-- e.g. INW/2026-27/00001 ; financial year runs 1 Apr - 31 Mar.
create function app.fy_label(p_date date) returns text
language sql immutable set search_path = '' as $$
  select case when extract(month from p_date) >= 4
    then extract(year from p_date)::int || '-' || lpad(((extract(year from p_date)::int + 1) % 100)::text, 2, '0')
    else (extract(year from p_date)::int - 1) || '-' || lpad((extract(year from p_date)::int % 100)::text, 2, '0')
  end
$$;

create function app.next_doc_no(p_type text, p_prefix text, p_date date, p_use_fy boolean default true)
returns text language plpgsql security definer set search_path = '' as $$
declare v_fy text := case when p_use_fy then app.fy_label(p_date) else 'ALL' end; v_n bigint;
begin
  insert into public.doc_counters as c (doc_type, fy, last_no) values (p_type, v_fy, 1)
  on conflict (doc_type, fy) do update set last_no = c.last_no + 1
  returning last_no into v_n;
  return case when p_use_fy then p_prefix || '/' || v_fy || '/' || lpad(v_n::text, 5, '0')
              else p_prefix || '-' || lpad(v_n::text, 4, '0') end;
end $$;

-- ---------- generic row triggers ------------------------------------
create function app.set_audit_columns() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.created_at := coalesce(new.created_at, now());
  else
    new.created_by := old.created_by;      -- immutable
    new.created_at := old.created_at;
  end if;
  if to_jsonb(new) ? 'updated_at' then
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;

create function app.audit_row_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_old jsonb; v_new jsonb; v_id text;
begin
  if tg_op in ('UPDATE','DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then v_new := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and v_old = v_new then return new; end if;
  v_id := coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'user_id', v_old ->> 'user_id');
  insert into public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), lower(tg_op), tg_table_name, v_id, v_old, v_new);
  return coalesce(new, old);
end $$;

create function app.audit_event(p_action text, p_table text, p_record text, p_meta jsonb default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (user_id, action, table_name, record_id, meta)
  values (auth.uid(), p_action, p_table, p_record, p_meta)
$$;

create function app.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only; % is not allowed', tg_table_name, tg_op using errcode = '42501';
end $$;

-- attach audit-column + audit-log triggers
do $$
declare t text;
begin
  foreach t in array array['profiles','parties','products','chambers','floors','racks','inward_transactions',
    'outward_transactions','outward_requests','charge_types','party_rates','invoices','receipts','payments','business_settings']
  loop
    execute format('create trigger trg_%1$s_cols before insert or update on public.%1$s for each row execute function app.set_audit_columns()', t);
  end loop;
  foreach t in array array['profiles','user_roles','role_permissions','parties','products','chambers','floors','racks',
    'inward_transactions','inward_items','outward_transactions','outward_items','outward_requests','stock_adjustments',
    'charge_types','party_rates','invoices','invoice_items','receipts','receipt_allocations','payments','business_settings','attachments']
  loop
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$s for each row execute function app.audit_row_change()', t);
  end loop;
  -- append-only tables
  foreach t in array array['stock_movements','stock_adjustments','party_ledger','audit_logs']
  loop
    execute format('create trigger trg_%1$s_noupd before update or delete on public.%1$s for each row execute function app.forbid_mutation()', t);
    execute format('create trigger trg_%1$s_notrunc before truncate on public.%1$s for each statement execute function app.forbid_mutation()', t);
  end loop;
end $$;

-- ---------- location helpers ----------------------------------------
create function app.location_label(p_rack uuid) returns text
language sql stable security definer set search_path = '' as $$
  select c.code || ' / Floor ' || f.floor_no || ' / ' || r.code
  from public.racks r join public.floors f on f.id = r.floor_id join public.chambers c on c.id = f.chamber_id
  where r.id = p_rack
$$;

-- racks may not move between floors, and may not be deactivated while holding stock
create function app.guard_rack_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_bags bigint; v_kgs numeric;
begin
  if new.floor_id <> old.floor_id then
    raise exception 'A rack cannot be moved to another floor (stock history is tied to its location)' using errcode = '23514';
  end if;
  if old.is_active and not new.is_active then
    select coalesce(sum(bags),0), coalesce(sum(kgs),0) into v_bags, v_kgs from public.stock_movements where rack_id = new.id;
    if v_bags <> 0 or v_kgs <> 0 then
      raise exception 'Cannot deactivate rack %: it still holds % bags / % kg', new.code, v_bags, v_kgs using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger trg_racks_guard before update on public.racks for each row execute function app.guard_rack_change();

create function app.guard_floor_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_bags bigint;
begin
  if new.chamber_id <> old.chamber_id then
    raise exception 'A floor cannot be moved to another chamber' using errcode = '23514';
  end if;
  if old.is_active and not new.is_active then
    select coalesce(sum(m.bags),0) into v_bags from public.stock_movements m join public.racks r on r.id = m.rack_id where r.floor_id = new.id;
    if v_bags <> 0 then raise exception 'Cannot deactivate a floor that still holds stock (% bags)', v_bags using errcode = '23514'; end if;
  end if;
  return new;
end $$;
create trigger trg_floors_guard before update on public.floors for each row execute function app.guard_floor_change();

create function app.guard_chamber_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_bags bigint;
begin
  if old.is_active and not new.is_active then
    select coalesce(sum(m.bags),0) into v_bags from public.stock_movements m
      join public.racks r on r.id = m.rack_id join public.floors f on f.id = r.floor_id where f.chamber_id = new.id;
    if v_bags <> 0 then raise exception 'Cannot deactivate a chamber that still holds stock (% bags)', v_bags using errcode = '23514'; end if;
  end if;
  return new;
end $$;
create trigger trg_chambers_guard before update on public.chambers for each row execute function app.guard_chamber_change();

-- ---------- THE STOCK INVARIANT -------------------------------------
-- 1) every ledger insert takes a per-(party,product,rack) advisory lock, so concurrent
--    writers for the same stock position are serialised until their transaction ends;
-- 2) after any decreasing insert, the running balance by date for that position must
--    never be negative (bags OR kgs) - this also rejects back-dated oversell and
--    cancelling an inward whose stock has already left.
create function app.lock_stock_key(p_party uuid, p_product uuid, p_rack uuid) returns void
language sql security definer set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended(p_party::text || '|' || p_product::text || '|' || p_rack::text, 0))
$$;

create function app.stock_lock_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.lock_stock_key(new.party_id, new.product_id, new.rack_id);
  return new;
end $$;
create trigger trg_stock_movements_lock before insert on public.stock_movements
  for each row execute function app.stock_lock_before_insert();

create function app.assert_stock_nonnegative() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_bad record;
begin
  select t.d, t.run_bags, t.run_kgs into v_bad
  from (
    select movement_date as d,
           sum(sum(bags)) over (order by movement_date) as run_bags,
           sum(sum(kgs))  over (order by movement_date) as run_kgs
    from public.stock_movements
    where party_id = new.party_id and product_id = new.product_id and rack_id = new.rack_id
    group by movement_date
  ) t
  where t.run_bags < 0 or t.run_kgs < 0
  order by t.d limit 1;

  if found then
    raise exception 'Insufficient stock: % at % would go negative on % (% bags / % kg)',
      (select name from public.products where id = new.product_id),
      app.location_label(new.rack_id), v_bad.d, v_bad.run_bags, v_bad.run_kgs
      using errcode = '23514';
  end if;
  return null;
end $$;
create trigger trg_stock_movements_nonneg after insert on public.stock_movements
  for each row when (new.bags < 0 or new.kgs < 0)
  execute function app.assert_stock_nonnegative();

-- ---------- stock views (security_invoker => RLS of the caller applies)
create view public.stock_balances with (security_invoker = true) as
select
  m.party_id, m.product_id, m.rack_id, r.floor_id, f.chamber_id,
  coalesce(sum(m.bags) filter (where m.movement_type in ('inward','inward_reversal')), 0)::bigint        as inward_bags,
  coalesce(-sum(m.bags) filter (where m.movement_type in ('outward','outward_reversal')), 0)::bigint     as outward_bags,
  coalesce(sum(m.bags) filter (where m.movement_type = 'adjustment'), 0)::bigint                         as adjustment_bags,
  sum(m.bags)::bigint                                                                                    as available_bags,
  coalesce(sum(m.kgs) filter (where m.movement_type in ('inward','inward_reversal')), 0)::numeric(16,3)  as inward_kgs,
  coalesce(-sum(m.kgs) filter (where m.movement_type in ('outward','outward_reversal')), 0)::numeric(16,3) as outward_kgs,
  coalesce(sum(m.kgs) filter (where m.movement_type = 'adjustment'), 0)::numeric(16,3)                   as adjustment_kgs,
  sum(m.kgs)::numeric(16,3)                                                                              as available_kgs
from public.stock_movements m
join public.racks r  on r.id = m.rack_id
join public.floors f on f.id = r.floor_id
group by m.party_id, m.product_id, m.rack_id, r.floor_id, f.chamber_id;

create view public.party_ledger_balances with (security_invoker = true) as
select p.id as party_id,
       p.opening_balance,
       coalesce(sum(l.debit),0)::numeric(14,2)  as total_debit,
       coalesce(sum(l.credit),0)::numeric(14,2) as total_credit,
       (p.opening_balance + coalesce(sum(l.debit),0) - coalesce(sum(l.credit),0))::numeric(14,2) as balance
from public.parties p
left join public.party_ledger l on l.party_id = p.id
group by p.id, p.opening_balance;

-- ---------- auto codes for masters ----------------------------------
create function app.assign_party_code() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.party_code is null or length(trim(new.party_code)) = 0 then
    new.party_code := app.next_doc_no('party', 'P', current_date, false);
  end if;
  return new;
end $$;
create trigger trg_parties_code before insert on public.parties for each row execute function app.assign_party_code();

create function app.assign_product_code() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.product_code is null or length(trim(new.product_code)) = 0 then
    new.product_code := app.next_doc_no('product', 'PR', current_date, false);
  end if;
  return new;
end $$;
create trigger trg_products_code before insert on public.products for each row execute function app.assign_product_code();
-- =====================================================================
-- 0003  Transactional stock RPCs. These are the ONLY write path for
--       inward / outward / adjustments / requests. Everything runs in a
--       single database transaction; any error rolls the whole call back.
-- =====================================================================

-- shared line validation: returns normalized values or raises
create function app.validate_line(p_item jsonb, p_line int, out o_product uuid, out o_rack uuid,
                                  out o_bags int, out o_kpb numeric, out o_wp numeric, out o_wl numeric)
language plpgsql security definer set search_path = '' as $$
declare v_bags numeric; v_kpb numeric;
begin
  o_product := nullif(p_item ->> 'product_id', '')::uuid;
  o_rack    := nullif(p_item ->> 'rack_id', '')::uuid;
  if o_product is null or not exists (select 1 from public.products where id = o_product and is_active) then
    raise exception 'Line %: select an active product', p_line using errcode = '22023';
  end if;
  if o_rack is null or not exists (
       select 1 from public.racks r join public.floors f on f.id = r.floor_id join public.chambers c on c.id = f.chamber_id
       where r.id = o_rack and r.is_active and f.is_active and c.is_active) then
    raise exception 'Line %: select an active chamber / floor / rack', p_line using errcode = '22023';
  end if;
  v_bags := (p_item ->> 'bags')::numeric;
  v_kpb  := (p_item ->> 'kgs_per_bag')::numeric;
  if v_bags is null or v_bags <= 0 or v_bags <> trunc(v_bags) or v_bags > 1000000 then
    raise exception 'Line %: bags must be a whole number greater than 0', p_line using errcode = '22023';
  end if;
  if v_kpb is null or v_kpb <= 0 or v_kpb > 10000 then
    raise exception 'Line %: kgs per bag must be greater than 0', p_line using errcode = '22023';
  end if;
  o_bags := v_bags::int;
  o_kpb  := round(v_kpb, 3);
  o_wp   := coalesce(nullif(p_item ->> 'wages_party', '')::numeric, 0);
  o_wl   := coalesce(nullif(p_item ->> 'wages_labour', '')::numeric, 0);
  if o_wp < 0 or o_wl < 0 then
    raise exception 'Line %: wages cannot be negative', p_line using errcode = '22023';
  end if;
end $$;

create function app.clean_vehicle(p_v text) returns text
language sql immutable set search_path = '' as $$
  select nullif(upper(regexp_replace(coalesce(p_v, ''), '\s+', '', 'g')), '')
$$;

-- ======================= INWARD =======================================
create function public.create_inward(p_header jsonb, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_date date; v_party uuid; v_client uuid; v_existing public.inward_transactions;
  v_id uuid; v_no text; v_item jsonb; v_line int := 0; v_l record;
  v_wb numeric; v_tbags bigint := 0; v_tkgs numeric := 0;
begin
  perform app.require_permission('inward.create');
  if p_header is null or jsonb_typeof(p_header) <> 'object' then
    raise exception 'Inward header is required' using errcode = '22023'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product line' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'Too many lines (max 100)' using errcode = '22023'; end if;

  v_date  := coalesce(nullif(p_header ->> 'inward_date', '')::date, app.business_today());
  if v_date > app.business_today() then raise exception 'Inward date cannot be in the future' using errcode = '22023'; end if;
  if v_date < date '2000-01-01' then raise exception 'Inward date is not valid' using errcode = '22023'; end if;
  v_party := nullif(p_header ->> 'party_id', '')::uuid;
  if v_party is null or not exists (select 1 from public.parties where id = v_party and is_active) then
    raise exception 'Select an active party' using errcode = '22023'; end if;
  v_wb := nullif(p_header ->> 'wb_kgs', '')::numeric;
  if v_wb is not null and v_wb < 0 then raise exception 'Weighbridge kgs cannot be negative' using errcode = '22023'; end if;

  v_client := nullif(p_header ->> 'client_request_id', '')::uuid;
  if v_client is not null then
    select * into v_existing from public.inward_transactions where client_request_id = v_client;
    if found then
      if v_existing.created_by is distinct from v_uid then raise exception 'Request id already used' using errcode = '42501'; end if;
      return jsonb_build_object('id', v_existing.id, 'inward_no', v_existing.inward_no, 'duplicate', true);
    end if;
  end if;

  -- validate every line BEFORE consuming a document number
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;
    perform app.validate_line(v_item, v_line);
  end loop;

  v_no := app.next_doc_no('inward', 'INW', v_date);
  begin
    insert into public.inward_transactions (inward_no, inward_date, party_id, vehicle_no, wb_kgs, remarks, client_request_id)
    values (v_no, v_date, v_party, app.clean_vehicle(p_header ->> 'vehicle_no'), v_wb,
            nullif(trim(p_header ->> 'remarks'), ''), v_client)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Duplicate submission in progress - please retry' using errcode = '40001';
  end;

  v_line := 0;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;
    select * into v_l from app.validate_line(v_item, v_line);
    insert into public.inward_items (inward_id, line_no, product_id, rack_id, bags, kgs_per_bag, wages_party, wages_labour, remarks)
    values (v_id, v_line, v_l.o_product, v_l.o_rack, v_l.o_bags, v_l.o_kpb, v_l.o_wp, v_l.o_wl, nullif(trim(v_item ->> 'remarks'), ''));

    insert into public.stock_movements (movement_type, movement_date, party_id, product_id, rack_id, bags, kgs, inward_id)
    values ('inward', v_date, v_party, v_l.o_product, v_l.o_rack, v_l.o_bags, v_l.o_bags * v_l.o_kpb, v_id);

    insert into public.labour_records (kind, record_date, party_id, product_id, inward_id, bags, wages_labour, wages_party, created_by)
    values ('inward', v_date, v_party, v_l.o_product, v_id, v_l.o_bags, v_l.o_wl, v_l.o_wp, v_uid);

    v_tbags := v_tbags + v_l.o_bags;
    v_tkgs  := v_tkgs + v_l.o_bags * v_l.o_kpb;
  end loop;

  return jsonb_build_object('id', v_id, 'inward_no', v_no, 'total_bags', v_tbags, 'total_kgs', v_tkgs, 'duplicate', false);
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    raise exception 'Invalid input: %', sqlerrm using errcode = '22023';
end $$;

create function public.cancel_inward(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_doc public.inward_transactions; v_m record; v_n int := 0;
begin
  perform app.require_permission('inward.cancel');
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'A cancellation reason is required' using errcode = '22023'; end if;
  select * into v_doc from public.inward_transactions where id = p_id for update;
  if not found then raise exception 'Inward not found' using errcode = 'P0002'; end if;
  if v_doc.status = 'cancelled' then raise exception 'Inward % is already cancelled', v_doc.inward_no using errcode = '22023'; end if;

  for v_m in
    select m.* from public.stock_movements m
    where m.inward_id = p_id and m.movement_type = 'inward'
      and not exists (select 1 from public.stock_movements r where r.reversal_of = m.id)
    order by m.id
  loop
    insert into public.stock_movements (movement_type, movement_date, party_id, product_id, rack_id, bags, kgs, inward_id, reversal_of)
    values ('inward_reversal', v_m.movement_date, v_m.party_id, v_m.product_id, v_m.rack_id, -v_m.bags, -v_m.kgs, p_id, v_m.id);
    v_n := v_n + 1;
  end loop;

  update public.labour_records set status = 'cancelled' where inward_id = p_id;
  update public.inward_transactions
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = trim(p_reason)
   where id = p_id;
  perform app.audit_event('cancel', 'inward_transactions', p_id::text,
          jsonb_build_object('inward_no', v_doc.inward_no, 'reason', trim(p_reason), 'movements_reversed', v_n));
  return jsonb_build_object('id', p_id, 'inward_no', v_doc.inward_no, 'status', 'cancelled');
end $$;

-- ======================= OUTWARD ======================================
create function public.create_outward(p_header jsonb, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_date date; v_party uuid; v_client uuid; v_existing public.outward_transactions;
  v_req uuid; v_reqrow public.outward_requests;
  v_id uuid; v_no text; v_item jsonb; v_line int := 0; v_l record; v_k record;
  v_ab bigint; v_ak numeric; v_tbags bigint := 0; v_tkgs numeric := 0;
begin
  perform app.require_permission('outward.create');
  if p_header is null or jsonb_typeof(p_header) <> 'object' then
    raise exception 'Outward header is required' using errcode = '22023'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product line' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'Too many lines (max 100)' using errcode = '22023'; end if;

  v_date := coalesce(nullif(p_header ->> 'outward_date', '')::date, app.business_today());
  if v_date > app.business_today() then raise exception 'Outward date cannot be in the future' using errcode = '22023'; end if;
  if v_date < date '2000-01-01' then raise exception 'Outward date is not valid' using errcode = '22023'; end if;
  v_party := nullif(p_header ->> 'party_id', '')::uuid;
  if v_party is null or not exists (select 1 from public.parties where id = v_party and is_active) then
    raise exception 'Select an active party' using errcode = '22023'; end if;

  v_client := nullif(p_header ->> 'client_request_id', '')::uuid;
  if v_client is not null then
    select * into v_existing from public.outward_transactions where client_request_id = v_client;
    if found then
      if v_existing.created_by is distinct from v_uid then raise exception 'Request id already used' using errcode = '42501'; end if;
      return jsonb_build_object('id', v_existing.id, 'outward_no', v_existing.outward_no, 'duplicate', true);
    end if;
  end if;

  v_req := nullif(p_header ->> 'outward_request_id', '')::uuid;
  if v_req is not null then
    select * into v_reqrow from public.outward_requests where id = v_req for update;
    if not found or v_reqrow.party_id <> v_party then raise exception 'Outward request does not belong to this party' using errcode = '22023'; end if;
    if v_reqrow.status <> 'approved' then raise exception 'Only an approved request can be fulfilled (current status: %)', v_reqrow.status using errcode = '22023'; end if;
  end if;

  -- 1) validate lines
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;
    perform app.validate_line(v_item, v_line);
  end loop;

  -- 2) lock every affected stock position in a fixed order (prevents deadlocks + serialises overselling)
  for v_k in
    select distinct (i.value ->> 'product_id')::uuid as product_id, (i.value ->> 'rack_id')::uuid as rack_id
    from jsonb_array_elements(p_items) i order by 1, 2
  loop
    perform app.lock_stock_key(v_party, v_k.product_id, v_k.rack_id);
  end loop;

  -- 3) friendly availability check on the aggregated request per position
  for v_k in
    select (i.value ->> 'product_id')::uuid as product_id, (i.value ->> 'rack_id')::uuid as rack_id,
           sum((i.value ->> 'bags')::numeric) as bags,
           sum((i.value ->> 'bags')::numeric * (i.value ->> 'kgs_per_bag')::numeric) as kgs
    from jsonb_array_elements(p_items) i group by 1, 2
  loop
    select coalesce(sum(bags), 0), coalesce(sum(kgs), 0) into v_ab, v_ak
    from public.stock_movements where party_id = v_party and product_id = v_k.product_id and rack_id = v_k.rack_id;
    if v_k.bags > v_ab or v_k.kgs > v_ak then
      raise exception 'Insufficient stock for % at %: available % bags / % kg, requested % bags / % kg',
        (select name from public.products where id = v_k.product_id), app.location_label(v_k.rack_id),
        v_ab, v_ak, v_k.bags, round(v_k.kgs, 3) using errcode = '23514';
    end if;
  end loop;

  v_no := app.next_doc_no('outward', 'OUT', v_date);
  begin
    insert into public.outward_transactions (outward_no, outward_date, party_id, vehicle_no, remarks, outward_request_id, client_request_id)
    values (v_no, v_date, v_party, app.clean_vehicle(p_header ->> 'vehicle_no'), nullif(trim(p_header ->> 'remarks'), ''), v_req, v_client)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Duplicate submission in progress - please retry' using errcode = '40001';
  end;

  v_line := 0;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;
    select * into v_l from app.validate_line(v_item, v_line);
    insert into public.outward_items (outward_id, line_no, product_id, rack_id, bags, kgs_per_bag, wages_party, wages_labour, remarks)
    values (v_id, v_line, v_l.o_product, v_l.o_rack, v_l.o_bags, v_l.o_kpb, v_l.o_wp, v_l.o_wl, nullif(trim(v_item ->> 'remarks'), ''));

    -- the ledger trigger re-verifies the running balance (final safety net)
    insert into public.stock_movements (movement_type, movement_date, party_id, product_id, rack_id, bags, kgs, outward_id)
    values ('outward', v_date, v_party, v_l.o_product, v_l.o_rack, -v_l.o_bags, -(v_l.o_bags * v_l.o_kpb), v_id);

    insert into public.labour_records (kind, record_date, party_id, product_id, outward_id, bags, wages_labour, wages_party, created_by)
    values ('outward', v_date, v_party, v_l.o_product, v_id, v_l.o_bags, v_l.o_wl, v_l.o_wp, v_uid);

    v_tbags := v_tbags + v_l.o_bags;
    v_tkgs  := v_tkgs + v_l.o_bags * v_l.o_kpb;
  end loop;

  if v_req is not null then
    update public.outward_requests set status = 'fulfilled', fulfilled_outward_id = v_id where id = v_req;
  end if;

  return jsonb_build_object('id', v_id, 'outward_no', v_no, 'total_bags', v_tbags, 'total_kgs', v_tkgs, 'duplicate', false);
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    raise exception 'Invalid input: %', sqlerrm using errcode = '22023';
end $$;

create function public.cancel_outward(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_doc public.outward_transactions; v_m record; v_n int := 0;
begin
  perform app.require_permission('outward.cancel');
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'A cancellation reason is required' using errcode = '22023'; end if;
  select * into v_doc from public.outward_transactions where id = p_id for update;
  if not found then raise exception 'Outward not found' using errcode = 'P0002'; end if;
  if v_doc.status = 'cancelled' then raise exception 'Outward % is already cancelled', v_doc.outward_no using errcode = '22023'; end if;

  for v_m in
    select m.* from public.stock_movements m
    where m.outward_id = p_id and m.movement_type = 'outward'
      and not exists (select 1 from public.stock_movements r where r.reversal_of = m.id)
    order by m.id
  loop
    insert into public.stock_movements (movement_type, movement_date, party_id, product_id, rack_id, bags, kgs, outward_id, reversal_of)
    values ('outward_reversal', v_m.movement_date, v_m.party_id, v_m.product_id, v_m.rack_id, -v_m.bags, -v_m.kgs, p_id, v_m.id);
    v_n := v_n + 1;
  end loop;

  update public.labour_records set status = 'cancelled' where outward_id = p_id;
  update public.outward_transactions
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = trim(p_reason)
   where id = p_id;
  if v_doc.outward_request_id is not null then
    update public.outward_requests set status = 'approved', fulfilled_outward_id = null
     where id = v_doc.outward_request_id and status = 'fulfilled';
  end if;
  perform app.audit_event('cancel', 'outward_transactions', p_id::text,
          jsonb_build_object('outward_no', v_doc.outward_no, 'reason', trim(p_reason), 'movements_reversed', v_n));
  return jsonb_build_object('id', p_id, 'outward_no', v_doc.outward_no, 'status', 'cancelled');
end $$;

-- ======================= ADJUSTMENTS ==================================
create function public.post_stock_adjustment(p_party uuid, p_product uuid, p_rack uuid,
                                             p_bags_delta int, p_kgs_delta numeric, p_date date, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_no text; v_date date := coalesce(p_date, app.business_today());
begin
  perform app.require_permission('stock.adjust');
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'A reason (min 5 characters) is required' using errcode = '22023'; end if;
  if coalesce(p_bags_delta, 0) = 0 and coalesce(p_kgs_delta, 0) = 0 then raise exception 'Adjustment cannot be zero' using errcode = '22023'; end if;
  if v_date > app.business_today() then raise exception 'Adjustment date cannot be in the future' using errcode = '22023'; end if;
  if not exists (select 1 from public.parties where id = p_party) then raise exception 'Unknown party' using errcode = '22023'; end if;
  if not exists (select 1 from public.products where id = p_product) then raise exception 'Unknown product' using errcode = '22023'; end if;
  if not exists (select 1 from public.racks where id = p_rack) then raise exception 'Unknown rack' using errcode = '22023'; end if;

  v_no := app.next_doc_no('adjustment', 'ADJ', v_date);
  insert into public.stock_adjustments (adj_no, adj_date, party_id, product_id, rack_id, bags_delta, kgs_delta, reason)
  values (v_no, v_date, p_party, p_product, p_rack, coalesce(p_bags_delta, 0), coalesce(p_kgs_delta, 0), trim(p_reason))
  returning id into v_id;
  insert into public.stock_movements (movement_type, movement_date, party_id, product_id, rack_id, bags, kgs, adjustment_id)
  values ('adjustment', v_date, p_party, p_product, p_rack, coalesce(p_bags_delta, 0), coalesce(p_kgs_delta, 0), v_id);
  return jsonb_build_object('id', v_id, 'adj_no', v_no);
end $$;

-- ======================= OUTWARD REQUESTS (customer) ==================
create function app.notify_users_with_permission(p_permission text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, title, body, link)
  select ur.user_id, p_title, p_body, p_link
  from public.user_roles ur join public.profiles p on p.id = ur.user_id and p.is_active
  where ur.role <> 'customer'
    and (ur.role = 'super_admin' or exists (select 1 from public.role_permissions rp
         where rp.role = ur.role and rp.permission = p_permission and rp.allowed))
$$;

create function public.create_outward_request(p_product uuid, p_bags int, p_preferred_date date, p_remarks text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_party uuid := app.current_party_id(); v_avail bigint; v_id uuid; v_no text; v_pname text;
begin
  if v_party is null then raise exception 'Only an active customer account can submit requests' using errcode = '42501'; end if;
  if not coalesce((select outward_requests_enabled from public.business_settings limit 1), false) then
    raise exception 'Outward requests are currently disabled' using errcode = '42501'; end if;
  if p_bags is null or p_bags <= 0 then raise exception 'Quantity must be greater than 0' using errcode = '22023'; end if;
  if p_preferred_date is not null and p_preferred_date < app.business_today() then
    raise exception 'Preferred dispatch date cannot be in the past' using errcode = '22023'; end if;
  if not exists (select 1 from public.products where id = p_product and is_active) then
    raise exception 'Select a valid product' using errcode = '22023'; end if;

  select coalesce(sum(bags), 0) into v_avail from public.stock_movements where party_id = v_party and product_id = p_product;
  -- bags already promised to other open requests
  v_avail := v_avail - coalesce((select sum(bags_requested) from public.outward_requests
                                  where party_id = v_party and product_id = p_product and status in ('pending','approved')), 0);
  if p_bags > v_avail then
    raise exception 'Requested quantity exceeds your available stock (% bags free after open requests)', greatest(v_avail, 0) using errcode = '23514'; end if;

  v_no := app.next_doc_no('request', 'REQ', app.business_today());
  insert into public.outward_requests (request_no, party_id, product_id, bags_requested, preferred_date, remarks, created_by)
  values (v_no, v_party, p_product, p_bags, p_preferred_date, nullif(trim(p_remarks), ''), auth.uid())
  returning id into v_id;

  select name into v_pname from public.products where id = p_product;
  perform app.notify_users_with_permission('request.review', 'New outward request ' || v_no,
          (select name from public.parties where id = v_party) || ' requested ' || p_bags || ' bags of ' || v_pname, '/admin/requests');
  return jsonb_build_object('id', v_id, 'request_no', v_no);
end $$;

create function public.review_outward_request(p_id uuid, p_approve boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_r public.outward_requests; v_uid uuid;
begin
  perform app.require_permission('request.review');
  select * into v_r from public.outward_requests where id = p_id for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if v_r.status <> 'pending' then raise exception 'Request % is already %', v_r.request_no, v_r.status using errcode = '22023'; end if;
  if not p_approve and (p_note is null or length(trim(p_note)) < 3) then
    raise exception 'A reason is required when rejecting' using errcode = '22023'; end if;
  update public.outward_requests
     set status = case when p_approve then 'approved' else 'rejected' end::public.request_status,
         reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(trim(p_note), '')
   where id = p_id;
  select user_id into v_uid from public.parties where id = v_r.party_id;
  if v_uid is not null then
    insert into public.notifications (user_id, title, body, link)
    values (v_uid, 'Request ' || v_r.request_no || (case when p_approve then ' approved' else ' rejected' end),
            nullif(trim(p_note), ''), '/portal/requests');
  end if;
  return jsonb_build_object('id', p_id, 'status', case when p_approve then 'approved' else 'rejected' end);
end $$;

create function public.cancel_outward_request(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_party uuid := app.current_party_id(); v_r public.outward_requests;
begin
  select * into v_r from public.outward_requests where id = p_id for update;
  if not found or v_party is null or v_r.party_id <> v_party then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if v_r.status <> 'pending' then raise exception 'Only pending requests can be cancelled' using errcode = '22023'; end if;
  update public.outward_requests set status = 'cancelled' where id = p_id;
  return jsonb_build_object('id', p_id, 'status', 'cancelled');
end $$;

-- ---------- lock down function execution ----------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public','app') loop
    execute format('revoke all on function %s from public, anon', f.sig);
  end loop;
end $$;
grant execute on function
  public.create_inward(jsonb, jsonb), public.cancel_inward(uuid, text),
  public.create_outward(jsonb, jsonb), public.cancel_outward(uuid, text),
  public.post_stock_adjustment(uuid, uuid, uuid, int, numeric, date, text),
  public.create_outward_request(uuid, int, date, text),
  public.review_outward_request(uuid, boolean, text),
  public.cancel_outward_request(uuid)
to authenticated;
-- app.* helpers used inside RLS policies / column defaults need to be callable by signed-in users
grant execute on function app.user_role(), app.is_internal(), app.has_permission(text),
  app.current_party_id(), app.business_today(), app.next_doc_no(text, text, date, boolean),
  app.location_label(uuid) to authenticated;
-- =====================================================================
-- 0004  Row Level Security + privilege lockdown
-- Model:
--   * internal roles (super_admin/manager/staff/accountant) read operational data
--   * customers read ONLY rows whose party_id = their own party
--   * stock/ledger/document tables have NO write policies: all writes go through
--     the SECURITY DEFINER RPCs in 0003, and table privileges are revoked as well.
-- =====================================================================

-- start from zero for anon; authenticated gets only what policies + grants allow
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- write-protected tables: nobody writes directly
revoke insert, update, delete, truncate on
  public.inward_transactions, public.inward_items, public.outward_transactions, public.outward_items,
  public.stock_movements, public.stock_adjustments, public.labour_records, public.outward_requests,
  public.party_ledger, public.audit_logs, public.doc_counters, public.user_roles, public.role_permissions,
  public.permissions_catalog
from authenticated;
revoke all on public.doc_counters from authenticated;
-- notifications: users may only flip is_read on their own rows
revoke insert, update, delete, truncate on public.notifications from authenticated;
grant update (is_read) on public.notifications to authenticated;
-- master data: no deletes (deactivate instead)
revoke delete, truncate on public.parties, public.products, public.chambers, public.floors, public.racks,
  public.invoices, public.receipts, public.payments, public.profiles, public.business_settings from authenticated;
revoke insert, delete, truncate on public.business_settings from authenticated;

-- ---------- identity -------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or app.is_internal());
create policy profiles_update_staff on public.profiles for update to authenticated
  using (app.has_permission('staff.manage')) with check (app.has_permission('staff.manage'));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and is_active);
revoke update on public.profiles from authenticated;
grant update (full_name, phone, is_active) on public.profiles to authenticated;

create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or app.has_permission('staff.manage'));

create policy perm_catalog_select on public.permissions_catalog for select to authenticated using (true);
create policy role_permissions_select on public.role_permissions for select to authenticated
  using (app.is_internal());

create policy settings_select on public.business_settings for select to authenticated using (true);
create policy settings_update on public.business_settings for update to authenticated
  using (app.has_permission('settings.manage')) with check (app.has_permission('settings.manage'));

-- ---------- masters --------------------------------------------------
create policy parties_select on public.parties for select to authenticated
  using (app.is_internal() or id = app.current_party_id());
create policy parties_insert on public.parties for insert to authenticated with check (app.has_permission('party.manage'));
create policy parties_update on public.parties for update to authenticated
  using (app.has_permission('party.manage')) with check (app.has_permission('party.manage'));

create policy products_select on public.products for select to authenticated using (app.user_role() is not null);
create policy products_insert on public.products for insert to authenticated with check (app.has_permission('product.manage'));
create policy products_update on public.products for update to authenticated
  using (app.has_permission('product.manage')) with check (app.has_permission('product.manage'));

-- locations are shared warehouse layout (no customer data)
create policy chambers_select on public.chambers for select to authenticated using (app.user_role() is not null);
create policy floors_select   on public.floors   for select to authenticated using (app.user_role() is not null);
create policy racks_select    on public.racks    for select to authenticated using (app.user_role() is not null);
create policy chambers_write on public.chambers for insert to authenticated with check (app.has_permission('location.manage'));
create policy chambers_upd   on public.chambers for update to authenticated using (app.has_permission('location.manage')) with check (app.has_permission('location.manage'));
create policy floors_write   on public.floors   for insert to authenticated with check (app.has_permission('location.manage'));
create policy floors_upd     on public.floors   for update to authenticated using (app.has_permission('location.manage')) with check (app.has_permission('location.manage'));
create policy racks_write    on public.racks    for insert to authenticated with check (app.has_permission('location.manage'));
create policy racks_upd      on public.racks    for update to authenticated using (app.has_permission('location.manage')) with check (app.has_permission('location.manage'));

-- ---------- stock documents + ledger (read-only) ---------------------
create policy inward_select on public.inward_transactions for select to authenticated
  using (app.is_internal() or party_id = app.current_party_id());
create policy inward_items_select on public.inward_items for select to authenticated
  using (exists (select 1 from public.inward_transactions t where t.id = inward_id));   -- inherits parent RLS
create policy outward_select on public.outward_transactions for select to authenticated
  using (app.is_internal() or party_id = app.current_party_id());
create policy outward_items_select on public.outward_items for select to authenticated
  using (exists (select 1 from public.outward_transactions t where t.id = outward_id));
create policy movements_select on public.stock_movements for select to authenticated
  using (app.is_internal() or party_id = app.current_party_id());
create policy adjustments_select on public.stock_adjustments for select to authenticated
  using (app.is_internal());
create policy requests_select on public.outward_requests for select to authenticated
  using (app.is_internal() or party_id = app.current_party_id());
create policy labour_select on public.labour_records for select to authenticated
  using (app.has_permission('labour.view'));

-- ---------- billing --------------------------------------------------
create policy charge_types_select on public.charge_types for select to authenticated using (app.is_internal());
create policy charge_types_write  on public.charge_types for insert to authenticated with check (app.has_permission('billing.manage'));
create policy charge_types_upd    on public.charge_types for update to authenticated using (app.has_permission('billing.manage')) with check (app.has_permission('billing.manage'));
create policy party_rates_select  on public.party_rates for select to authenticated using (app.has_permission('billing.view'));
create policy party_rates_write   on public.party_rates for insert to authenticated with check (app.has_permission('billing.manage'));
create policy party_rates_upd     on public.party_rates for update to authenticated using (app.has_permission('billing.manage')) with check (app.has_permission('billing.manage'));

-- customers only see invoices that were actually issued (never drafts)
create policy invoices_select on public.invoices for select to authenticated
  using (app.has_permission('billing.view') or (party_id = app.current_party_id() and status in ('issued','cancelled')));
create policy invoice_items_select on public.invoice_items for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id));
create policy receipts_select on public.receipts for select to authenticated
  using (app.has_permission('billing.view') or party_id = app.current_party_id());
create policy receipt_alloc_select on public.receipt_allocations for select to authenticated
  using (exists (select 1 from public.receipts r where r.id = receipt_id));
create policy payments_select on public.payments for select to authenticated
  using (app.has_permission('billing.view') or (party_id is not null and party_id = app.current_party_id()));
create policy ledger_select on public.party_ledger for select to authenticated
  using (app.has_permission('billing.view') or party_id = app.current_party_id());

-- ---------- misc -----------------------------------------------------
create policy attachments_select on public.attachments for select to authenticated
  using (app.is_internal() or (party_id is not null and party_id = app.current_party_id()));
create policy attachments_insert on public.attachments for insert to authenticated
  with check (app.is_internal() and uploaded_by = auth.uid());
create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy audit_select on public.audit_logs for select to authenticated using (app.has_permission('audit.view'));

-- billing tables: writes only via policy-checked direct DML for drafts is NOT enabled yet;
-- invoice/receipt/payment RPCs arrive in Phase 4. Until then block direct writes.
revoke insert, update on public.invoices, public.invoice_items, public.receipts,
  public.receipt_allocations, public.payments from authenticated;
-- =====================================================================
-- 0005  Reference data: permissions, role defaults, settings, 3 chambers x 5 floors
-- Racks are NOT seeded: the client defines them in the app.
-- =====================================================================
insert into public.permissions_catalog (key, category, description) values
  ('party.manage',   'Master',    'Create / edit parties'),
  ('product.manage', 'Master',    'Create / edit products'),
  ('location.manage','Storage',   'Manage chambers, floors and racks'),
  ('inward.create',  'Inward',    'Create inward entries'),
  ('inward.cancel',  'Inward',    'Cancel inward entries (reverses stock)'),
  ('outward.create', 'Outward',   'Create outward entries'),
  ('outward.cancel', 'Outward',   'Cancel outward entries (restores stock)'),
  ('stock.adjust',   'Inventory', 'Post stock adjustments'),
  ('request.review', 'Outward',   'Approve / reject customer outward requests'),
  ('billing.view',   'Billing',   'View invoices, receipts, payments, ledgers'),
  ('billing.manage', 'Billing',   'Create / cancel invoices, receipts, payments; manage rates'),
  ('labour.view',    'Reports',   'View labour registers'),
  ('reports.view',   'Reports',   'Open operational reports'),
  ('staff.manage',   'Admin',     'Manage staff and customer logins'),
  ('settings.manage','Admin',     'Edit business settings'),
  ('audit.view',     'Admin',     'View audit logs');

-- defaults (super_admin always has everything; these are editable in Settings)
insert into public.role_permissions (role, permission, allowed)
select r.role, p.key,
  case r.role
    when 'manager' then p.key in ('location.manage','inward.create','outward.create','request.review','labour.view','reports.view')
    when 'staff' then p.key in ('inward.create','outward.create')
    when 'accountant' then p.key in ('billing.view','billing.manage','labour.view','reports.view')
    else false end
from (values ('manager'::public.app_role),('staff'),('accountant')) as r(role)
cross join public.permissions_catalog p;

insert into public.business_settings (id, business_name) values (true, 'Cold Storage');

insert into public.chambers (code, name, sort_order) values ('A','Chamber A',1),('B','Chamber B',2),('C','Chamber C',3);
insert into public.floors (chamber_id, floor_no, name)
select c.id, n, 'Floor ' || n from public.chambers c cross join generate_series(1, 5) n;

insert into public.charge_types (code, name, basis) values
  ('STORAGE','Storage charges','manual'),('HANDLING','Handling charges','manual'),
  ('LABOUR','Labour charges','manual'),('LOADING','Loading / unloading charges','manual'),
  ('OTHER','Other charges','manual');
-- =====================================================================
-- 0006  Dashboard aggregates. SECURITY INVOKER: runs under the caller's RLS,
--       so a customer calling it only ever aggregates their own stock.
-- =====================================================================
create function public.dashboard_summary() returns jsonb
language sql stable security invoker set search_path = '' as $$
  with today as (select app.business_today() as d),
  bal as (select * from public.stock_balances),
  tot as (
    select coalesce(sum(available_bags),0)::bigint as bags, coalesce(sum(available_kgs),0)::numeric as kgs,
           coalesce(sum(inward_bags),0)::bigint as in_bags, coalesce(sum(outward_bags),0)::bigint as out_bags,
           count(distinct product_id) filter (where available_bags > 0) as products_in_stock,
           count(distinct party_id)   filter (where available_bags > 0) as parties_in_stock
    from bal
  ),
  mv_today as (
    select coalesce(sum(m.bags) filter (where m.movement_type in ('inward','inward_reversal')),0)::bigint   as in_bags,
           coalesce(sum(m.kgs)  filter (where m.movement_type in ('inward','inward_reversal')),0)::numeric  as in_kgs,
           coalesce(-sum(m.bags) filter (where m.movement_type in ('outward','outward_reversal')),0)::bigint  as out_bags,
           coalesce(-sum(m.kgs)  filter (where m.movement_type in ('outward','outward_reversal')),0)::numeric as out_kgs
    from public.stock_movements m, today where m.movement_date = today.d
  ),
  rack_use as (
    select count(*) filter (where r.is_active) as total_racks,
           count(*) filter (where r.is_active and coalesce(b.bags,0) > 0) as occupied_racks,
           coalesce(sum(r.capacity_bags) filter (where r.is_active and r.capacity_bags is not null),0)::bigint as capacity_bags,
           coalesce(sum(b.bags) filter (where r.is_active and r.capacity_bags is not null),0)::bigint as bags_in_capacity_racks
    from public.racks r
    left join (select rack_id, sum(available_bags) as bags from bal group by rack_id) b on b.rack_id = r.id
  ),
  by_chamber as (
    select c.id, c.code, c.name, coalesce(sum(b.available_bags),0)::bigint as bags, coalesce(sum(b.available_kgs),0)::numeric as kgs
    from public.chambers c left join bal b on b.chamber_id = c.id
    where c.is_active group by c.id, c.code, c.name order by c.sort_order, c.code
  ),
  by_floor as (
    select c.code as chamber_code, f.floor_no, coalesce(sum(b.available_bags),0)::bigint as bags, coalesce(sum(b.available_kgs),0)::numeric as kgs
    from public.floors f join public.chambers c on c.id = f.chamber_id left join bal b on b.floor_id = f.id
    where f.is_active and c.is_active group by c.code, c.sort_order, f.floor_no order by c.sort_order, c.code, f.floor_no
  )
  select jsonb_build_object(
    'parties',        (select count(*) from public.parties where is_active),
    'products',       (select count(*) from public.products where is_active),
    'stock_bags',     (select bags from tot),
    'stock_kgs',      (select kgs from tot),
    'products_in_stock', (select products_in_stock from tot),
    'parties_in_stock',  (select parties_in_stock from tot),
    'today_inward_bags',  (select in_bags from mv_today),  'today_inward_kgs',  (select in_kgs from mv_today),
    'today_outward_bags', (select out_bags from mv_today), 'today_outward_kgs', (select out_kgs from mv_today),
    'total_racks',    (select total_racks from rack_use), 'occupied_racks', (select occupied_racks from rack_use),
    'capacity_bags',  (select capacity_bags from rack_use), 'bags_in_capacity_racks', (select bags_in_capacity_racks from rack_use),
    'pending_requests', (select count(*) from public.outward_requests where status = 'pending'),
    'by_chamber', coalesce((select jsonb_agg(to_jsonb(x)) from by_chamber x), '[]'::jsonb),
    'by_floor',   coalesce((select jsonb_agg(to_jsonb(x)) from by_floor x), '[]'::jsonb)
  )
$$;
revoke all on function public.dashboard_summary() from public, anon;
grant execute on function public.dashboard_summary() to authenticated;
-- =====================================================================
-- 0007  Modify inward/outward, billing (invoice/receipt/payment) with ledger,
--       role-permission admin RPC
-- =====================================================================
insert into public.permissions_catalog (key, category, description) values
  ('inward.update',  'Inward',  'Modify saved inward entries'),
  ('outward.update', 'Outward', 'Modify saved outward entries')
on conflict do nothing;
insert into public.role_permissions (role, permission, allowed)
select r.role, p.key, (r.role = 'manager')
from (values ('manager'::public.app_role),('staff'),('accountant')) r(role)
cross join (values ('inward.update'),('outward.update')) p(key)
on conflict do nothing;

-- ======================= MODIFY INWARD ================================
create function public.update_inward(p_id uuid, p_header jsonb, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_doc public.inward_transactions; v_date date; v_party uuid; v_wb numeric; v_item jsonb; v_line int := 0; v_l record; v_k record;
  v_old jsonb; v_m record; v_tbags bigint := 0; v_tkgs numeric := 0; v_old_ids uuid[];
begin
  perform app.require_permission('inward.update');
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product line' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 100 then raise exception 'Too many lines (max 100)' using errcode = '22023'; end if;
  select * into v_doc from public.inward_transactions where id = p_id for update;
  if not found then raise exception 'Inward not found' using errcode = 'P0002'; end if;
  if v_doc.status = 'cancelled' then raise exception 'A cancelled inward cannot be modified' using errcode = '22023'; end if;

  v_date := coalesce(nullif(p_header ->> 'inward_date', '')::date, v_doc.inward_date);
  if v_date > app.business_today() then raise exception 'Inward date cannot be in the future' using errcode = '22023'; end if;
  if v_date < date '2000-01-01' then raise exception 'Inward date is not valid' using errcode = '22023'; end if;
  v_party := coalesce(nullif(p_header ->> 'party_id', '')::uuid, v_doc.party_id);
  if not exists (select 1 from public.parties where id = v_party and (is_active or id = v_doc.party_id)) then
    raise exception 'Select an active party' using errcode = '22023'; end if;
  v_wb := nullif(p_header ->> 'wb_kgs', '')::numeric;
  if v_wb is not null and v_wb < 0 then raise exception 'Weighbridge kgs cannot be negative' using errcode = '22023'; end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_line := v_line + 1; perform app.validate_line(v_item, v_line);
  end loop;

  -- lock every affected position (old + new) in a fixed order
  for v_k in
    select distinct party_id, product_id, rack_id from (
      select m.party_id, m.product_id, m.rack_id from public.stock_movements m where m.inward_id = p_id
      union all
      select v_party, (i.value ->> 'product_id')::uuid, (i.value ->> 'rack_id')::uuid from jsonb_array_elements(p_items) i
    ) s order by 1, 2, 3
  loop perform app.lock_stock_key(v_k.party_id, v_k.product_id, v_k.rack_id); end loop;

  select jsonb_build_object('header', to_jsonb(v_doc),
           'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.line_no) from public.inward_items i where i.inward_id = p_id), '[]'::jsonb))
    into v_old;

  select coalesce(array_agg(m.id order by m.id), '{}') into v_old_ids from public.stock_movements m
   where m.inward_id = p_id and m.movement_type = 'inward' and not exists (select 1 from public.stock_movements r where r.reversal_of = m.id);

  -- 1) additions first (positive), 2) then reversals: guarantees intermediate states never undershoot the final one
  v_line := 0;
  delete from public.inward_items where inward_id = p_id;
  delete from public.labour_records where inward_id = p_id and kind = 'inward';
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;
    select * into v_l from app.validate_line(v_item, v_line);
    insert into public.inward_items (inward_id, line_no, product_id, rack_id, bags, kgs_per_bag, wages_party, wages_labour, remarks)
    values (p_id, v_line, v_l.o_product, v_l.o_rack, v_l.o_bags, v_l.o_kpb, v_l.o_wp, v_l.o_wl, nullif(trim(v_item ->> 'remarks'), ''));
    insert into public.stock_movements (movement_type, movement_date, party_id, product_id, rack_id, bags, kgs, inward_id)
    values ('inward', v_date, v_party, v_l.o_product, v_l.o_rack, v_l.o_bags, v_l.o_bags * v_l.o_kpb, p_id);
    insert into public.labour_records (kind, record_date, party_id, product_id, inward_id, bags, wages_labour, wages_party, created_by)
    values ('inward', v_date, v_party, v_l.o_product, p_id, v_l.o_bags, v_l.o_wl, v_l.o_wp, auth.uid());
    v_tbags := v_tbags + v_l.o_bags; v_tkgs := v_tkgs + v_l.o_bags * v_l.o_kpb;
  end loop;

  for v_m in select m.* from public.stock_movements m where m.id = any(v_old_ids) order by m.id loop
    insert into public.stock_movements (movement_type, movement_date, party_id, product_id, rack_id, bags, kgs, inward_id, reversal_of)
    values ('inward_reversal', v_m.movement_date, v_m.party_id, v_m.product_id, v_m.rack_id, -v_m.bags, -v_m.kgs, p_id, v_m.id);
  end loop;

  update public.inward_transactions
     set inward_date = v_date, party_id = v_party, vehicle_no = app.clean_vehicle(p_header ->> 'vehicle_no'),
         wb_kgs = v_wb, remarks = nullif(trim(p_header ->> 'remarks'), '')
   where id = p_id;
  perform app.audit_event('modify', 'inward_transactions', p_id::text, jsonb_build_object('inward_no', v_doc.inward_no, 'before', v_old));
  return jsonb_build_object('id', p_id, 'inward_no', v_doc.inward_no, 'total_bags', v_tbags, 'total_kgs', v_tkgs);
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    raise exception 'Invalid input: %', sqlerrm using errcode = '22023';
end $$;

-- ======================= MODIFY OUTWARD ===============================
create function public.update_outward(p_id uuid, p_header jsonb, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_doc public.outward_transactions; v_date date; v_party uuid; v_item jsonb; v_line int := 0; v_l record; v_k record; v_m record;
  v_old jsonb; v_tbags bigint := 0; v_tkgs numeric := 0; v_old_ids uuid[]; v_ab bigint; v_ak numeric;
begin
  perform app.require_permission('outward.update');
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product line' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 100 then raise exception 'Too many lines (max 100)' using errcode = '22023'; end if;
  select * into v_doc from public.outward_transactions where id = p_id for update;
  if not found then raise exception 'Outward not found' using errcode = 'P0002'; end if;
  if v_doc.status = 'cancelled' then raise exception 'A cancelled outward cannot be modified' using errcode = '22023'; end if;

  v_date := coalesce(nullif(p_header ->> 'outward_date', '')::date, v_doc.outward_date);
  if v_date > app.business_today() then raise exception 'Outward date cannot be in the future' using errcode = '22023'; end if;
  if v_date < date '2000-01-01' then raise exception 'Outward date is not valid' using errcode = '22023'; end if;
  v_party := v_doc.party_id;                                  -- party of a dispatched outward cannot change; cancel and re-enter instead
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_line := v_line + 1; perform app.validate_line(v_item, v_line);
  end loop;

  for v_k in
    select distinct product_id, rack_id from (
      select m.product_id, m.rack_id from public.stock_movements m where m.outward_id = p_id
      union all
      select (i.value ->> 'product_id')::uuid, (i.value ->> 'rack_id')::uuid from jsonb_array_elements(p_items) i
    ) s order by 1, 2
  loop perform app.lock_stock_key(v_party, v_k.product_id, v_k.rack_id); end loop;

  select jsonb_build_object('header', to_jsonb(v_doc),
           'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.line_no) from public.outward_items i where i.outward_id = p_id), '[]'::jsonb))
    into v_old;
  select coalesce(array_agg(m.id order by m.id), '{}') into v_old_ids from public.stock_movements m
   where m.outward_id = p_id and m.movement_type = 'outward' and not exists (select 1 from public.stock_movements r where r.reversal_of = m.id);

  -- 1) give the old quantities back (positive), 2) validate availability, 3) post the new dispatch
  for v_m in select m.* from public.stock_movements m where m.id = any(v_old_ids) order by m.id loop
    insert into public.stock_movements (movement_type, movement_date, party_id, product_id, rack_id, bags, kgs, outward_id, reversal_of)
    values ('outward_reversal', v_m.movement_date, v_m.party_id, v_m.product_id, v_m.rack_id, -v_m.bags, -v_m.kgs, p_id, v_m.id);
  end loop;

  for v_k in
    select (i.value ->> 'product_id')::uuid as product_id, (i.value ->> 'rack_id')::uuid as rack_id,
           sum((i.value ->> 'bags')::numeric) as bags, sum((i.value ->> 'bags')::numeric * (i.value ->> 'kgs_per_bag')::numeric) as kgs
    from jsonb_array_elements(p_items) i group by 1, 2
  loop
    select coalesce(sum(bags), 0), coalesce(sum(kgs), 0) into v_ab, v_ak
    from public.stock_movements where party_id = v_party and product_id = v_k.product_id and rack_id = v_k.rack_id;
    if v_k.bags > v_ab or v_k.kgs > v_ak then
      raise exception 'Insufficient stock for % at %: available % bags / % kg, requested % bags / % kg',
        (select name from public.products where id = v_k.product_id), app.location_label(v_k.rack_id), v_ab, v_ak, v_k.bags, round(v_k.kgs, 3)
        using errcode = '23514';
    end if;
  end loop;

  v_line := 0;
  delete from public.outward_items where outward_id = p_id;
  delete from public.labour_records where outward_id = p_id and kind = 'outward';
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;
    select * into v_l from app.validate_line(v_item, v_line);
    insert into public.outward_items (outward_id, line_no, product_id, rack_id, bags, kgs_per_bag, wages_party, wages_labour, remarks)
    values (p_id, v_line, v_l.o_product, v_l.o_rack, v_l.o_bags, v_l.o_kpb, v_l.o_wp, v_l.o_wl, nullif(trim(v_item ->> 'remarks'), ''));
    insert into public.stock_movements (movement_type, movement_date, party_id, product_id, rack_id, bags, kgs, outward_id)
    values ('outward', v_date, v_party, v_l.o_product, v_l.o_rack, -v_l.o_bags, -(v_l.o_bags * v_l.o_kpb), p_id);
    insert into public.labour_records (kind, record_date, party_id, product_id, outward_id, bags, wages_labour, wages_party, created_by)
    values ('outward', v_date, v_party, v_l.o_product, p_id, v_l.o_bags, v_l.o_wl, v_l.o_wp, auth.uid());
    v_tbags := v_tbags + v_l.o_bags; v_tkgs := v_tkgs + v_l.o_bags * v_l.o_kpb;
  end loop;

  update public.outward_transactions
     set outward_date = v_date, vehicle_no = app.clean_vehicle(p_header ->> 'vehicle_no'), remarks = nullif(trim(p_header ->> 'remarks'), '')
   where id = p_id;
  perform app.audit_event('modify', 'outward_transactions', p_id::text, jsonb_build_object('outward_no', v_doc.outward_no, 'before', v_old));
  return jsonb_build_object('id', p_id, 'outward_no', v_doc.outward_no, 'total_bags', v_tbags, 'total_kgs', v_tkgs);
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    raise exception 'Invalid input: %', sqlerrm using errcode = '22023';
end $$;

-- ======================= ROLE PERMISSIONS (owner only) ================
create function public.set_role_permission(p_role public.app_role, p_permission text, p_allowed boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if app.user_role() is distinct from 'super_admin' then raise exception 'Only the Owner can change permissions' using errcode = '42501'; end if;
  if p_role in ('super_admin', 'customer') then raise exception 'Permissions of this role are fixed' using errcode = '22023'; end if;
  insert into public.role_permissions (role, permission, allowed) values (p_role, p_permission, p_allowed)
  on conflict (role, permission) do update set allowed = excluded.allowed;
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('update_inward','update_outward','set_role_permission') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
-- =====================================================================
-- 0008  Billing: invoices, receipts, payments, party ledger.
-- Kept apart from inventory: nothing here reads or writes stock.
-- Ledger sign convention: debit = party owes us more; credit = party paid / we owe them.
-- =====================================================================
create view public.invoice_balances with (security_invoker = true) as
select i.id as invoice_id, i.invoice_no, i.invoice_date, i.due_date, i.party_id, i.status,
       coalesce(t.subtotal, 0)::numeric(14,2) as subtotal,
       coalesce(t.tax, 0)::numeric(14,2)      as tax_total,
       (coalesce(t.subtotal, 0) + coalesce(t.tax, 0))::numeric(14,2) as total,
       coalesce(p.paid, 0)::numeric(14,2)     as paid,
       (coalesce(t.subtotal, 0) + coalesce(t.tax, 0) - coalesce(p.paid, 0))::numeric(14,2) as outstanding,
       case when i.status <> 'issued' then i.status::text
            when coalesce(p.paid, 0) = 0 then 'unpaid'
            when coalesce(p.paid, 0) >= coalesce(t.subtotal, 0) + coalesce(t.tax, 0) then 'paid'
            else 'partial' end as payment_status
from public.invoices i
left join (select invoice_id, sum(amount) subtotal, sum(tax_amount) tax from public.invoice_items group by invoice_id) t on t.invoice_id = i.id
left join (select a.invoice_id, sum(a.amount) paid from public.receipt_allocations a
           join public.receipts r on r.id = a.receipt_id and r.status = 'active' group by a.invoice_id) p on p.invoice_id = i.id;

-- ---------- draft invoice (create or replace lines while still a draft)
create function public.save_invoice(p_id uuid, p_header jsonb, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_id; v_party uuid; v_date date; v_due date; v_item jsonb; v_line int := 0; v_status public.invoice_status;
        v_qty numeric; v_rate numeric; v_tax numeric; v_desc text;
begin
  perform app.require_permission('billing.manage');
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one invoice line' using errcode = '22023'; end if;
  v_party := nullif(p_header ->> 'party_id', '')::uuid;
  v_date  := coalesce(nullif(p_header ->> 'invoice_date', '')::date, app.business_today());
  v_due   := nullif(p_header ->> 'due_date', '')::date;
  if v_due is not null and v_due < v_date then raise exception 'Due date cannot be before the invoice date' using errcode = '22023'; end if;

  if v_id is null then
    if v_party is null or not exists (select 1 from public.parties where id = v_party and is_active) then
      raise exception 'Select an active party' using errcode = '22023'; end if;
    insert into public.invoices (invoice_date, due_date, party_id, period_from, period_to, notes)
    values (v_date, v_due, v_party, nullif(p_header ->> 'period_from', '')::date, nullif(p_header ->> 'period_to', '')::date, nullif(trim(p_header ->> 'notes'), ''))
    returning id into v_id;
  else
    select status into v_status from public.invoices where id = v_id for update;
    if not found then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
    if v_status <> 'draft' then raise exception 'Only a draft invoice can be edited (issued invoices are cancelled and re-raised)' using errcode = '22023'; end if;
    update public.invoices set invoice_date = v_date, due_date = v_due, period_from = nullif(p_header ->> 'period_from', '')::date,
           period_to = nullif(p_header ->> 'period_to', '')::date, notes = nullif(trim(p_header ->> 'notes'), '') where id = v_id;
    delete from public.invoice_items where invoice_id = v_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;
    v_desc := trim(coalesce(v_item ->> 'description', ''));
    v_qty := (v_item ->> 'quantity')::numeric; v_rate := (v_item ->> 'rate')::numeric; v_tax := coalesce(nullif(v_item ->> 'tax_percent', '')::numeric, 0);
    if v_desc = '' then raise exception 'Line %: description is required', v_line using errcode = '22023'; end if;
    if v_qty is null or v_qty < 0 or v_rate is null or v_rate < 0 then raise exception 'Line %: quantity and rate must be 0 or more', v_line using errcode = '22023'; end if;
    if v_tax < 0 or v_tax > 100 then raise exception 'Line %: tax % must be between 0 and 100', v_line, v_tax using errcode = '22023'; end if;
    insert into public.invoice_items (invoice_id, line_no, description, charge_type_id, quantity, unit, rate, tax_percent)
    values (v_id, v_line, v_desc, nullif(v_item ->> 'charge_type_id', '')::uuid, v_qty, nullif(trim(v_item ->> 'unit'), ''), v_rate, v_tax);
  end loop;
  return jsonb_build_object('id', v_id);
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    raise exception 'Invalid input: %', sqlerrm using errcode = '22023';
end $$;

-- ---------- issue: number assigned here, ledger debit posted in same transaction
create function public.issue_invoice(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_inv public.invoices; v_total numeric; v_no text;
begin
  perform app.require_permission('billing.manage');
  select * into v_inv from public.invoices where id = p_id for update;
  if not found then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  if v_inv.status <> 'draft' then raise exception 'Invoice is already %', v_inv.status using errcode = '22023'; end if;
  select coalesce(sum(amount + tax_amount), 0) into v_total from public.invoice_items where invoice_id = p_id;
  if v_total <= 0 then raise exception 'Invoice total must be greater than 0' using errcode = '22023'; end if;
  v_no := app.next_doc_no('invoice', 'INV', v_inv.invoice_date);
  update public.invoices set status = 'issued', invoice_no = v_no where id = p_id;
  insert into public.party_ledger (party_id, entry_date, entry_type, invoice_id, debit, narration)
  values (v_inv.party_id, v_inv.invoice_date, 'invoice', p_id, v_total, 'Invoice ' || v_no);
  return jsonb_build_object('id', p_id, 'invoice_no', v_no, 'total', v_total);
end $$;

create function public.cancel_invoice(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_inv public.invoices; v_total numeric;
begin
  perform app.require_permission('billing.manage');
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'A cancellation reason is required' using errcode = '22023'; end if;
  select * into v_inv from public.invoices where id = p_id for update;
  if not found then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  if v_inv.status = 'cancelled' then raise exception 'Invoice is already cancelled' using errcode = '22023'; end if;
  if v_inv.status = 'issued' then
    if exists (select 1 from public.receipt_allocations a join public.receipts r on r.id = a.receipt_id and r.status = 'active' where a.invoice_id = p_id) then
      raise exception 'Cancel the receipts allocated to this invoice first' using errcode = '23514'; end if;
    select coalesce(sum(amount + tax_amount), 0) into v_total from public.invoice_items where invoice_id = p_id;
    insert into public.party_ledger (party_id, entry_date, entry_type, invoice_id, credit, narration)
    values (v_inv.party_id, app.business_today(), 'invoice_reversal', p_id, v_total, 'Cancelled invoice ' || v_inv.invoice_no || ': ' || trim(p_reason));
  end if;
  update public.invoices set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = trim(p_reason) where id = p_id;
  perform app.audit_event('cancel', 'invoices', p_id::text, jsonb_build_object('invoice_no', v_inv.invoice_no, 'reason', trim(p_reason)));
  return jsonb_build_object('id', p_id, 'status', 'cancelled');
end $$;

-- ---------- receipts (money in) with optional allocation to invoices
create function public.create_receipt(p_header jsonb, p_allocations jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_party uuid; v_date date; v_amt numeric; v_mode text; v_id uuid; v_no text; v_a record; v_alloc_total numeric := 0; v_out numeric;
begin
  perform app.require_permission('billing.manage');
  v_party := nullif(p_header ->> 'party_id', '')::uuid;
  v_date := coalesce(nullif(p_header ->> 'receipt_date', '')::date, app.business_today());
  v_amt := (p_header ->> 'amount')::numeric; v_mode := p_header ->> 'payment_mode';
  if v_party is null or not exists (select 1 from public.parties where id = v_party) then raise exception 'Select a party' using errcode = '22023'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'Amount must be greater than 0' using errcode = '22023'; end if;
  if v_mode is null or v_mode not in ('cash','bank_transfer','upi','cheque','other') then raise exception 'Select a payment mode' using errcode = '22023'; end if;
  if v_date > app.business_today() then raise exception 'Receipt date cannot be in the future' using errcode = '22023'; end if;

  v_no := app.next_doc_no('receipt', 'RCP', v_date);
  insert into public.receipts (receipt_no, receipt_date, party_id, amount, payment_mode, reference_no, remarks)
  values (v_no, v_date, v_party, v_amt, v_mode, nullif(trim(p_header ->> 'reference_no'), ''), nullif(trim(p_header ->> 'remarks'), ''))
  returning id into v_id;

  for v_a in
    select (a.value ->> 'invoice_id')::uuid as invoice_id, sum((a.value ->> 'amount')::numeric) as amount
    from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) a group by 1 order by 1
  loop
    if v_a.amount is null or v_a.amount <= 0 then raise exception 'Allocation amount must be greater than 0' using errcode = '22023'; end if;
    perform 1 from public.invoices where id = v_a.invoice_id and party_id = v_party and status = 'issued' for update;
    if not found then raise exception 'Allocation refers to an invoice that is not an issued invoice of this party' using errcode = '22023'; end if;
    select outstanding into v_out from public.invoice_balances where invoice_id = v_a.invoice_id;
    if v_a.amount > v_out then raise exception 'Allocation % exceeds the outstanding % on the invoice', v_a.amount, v_out using errcode = '23514'; end if;
    insert into public.receipt_allocations (receipt_id, invoice_id, amount) values (v_id, v_a.invoice_id, v_a.amount);
    v_alloc_total := v_alloc_total + v_a.amount;
  end loop;
  if v_alloc_total > v_amt then raise exception 'Allocations (%) exceed the receipt amount (%)', v_alloc_total, v_amt using errcode = '23514'; end if;

  insert into public.party_ledger (party_id, entry_date, entry_type, receipt_id, credit, narration)
  values (v_party, v_date, 'receipt', v_id, v_amt, 'Receipt ' || v_no);
  return jsonb_build_object('id', v_id, 'receipt_no', v_no, 'unallocated', v_amt - v_alloc_total);
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    raise exception 'Invalid input: %', sqlerrm using errcode = '22023';
end $$;

create function public.cancel_receipt(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_r public.receipts;
begin
  perform app.require_permission('billing.manage');
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'A cancellation reason is required' using errcode = '22023'; end if;
  select * into v_r from public.receipts where id = p_id for update;
  if not found then raise exception 'Receipt not found' using errcode = 'P0002'; end if;
  if v_r.status = 'cancelled' then raise exception 'Receipt is already cancelled' using errcode = '22023'; end if;
  update public.receipts set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = trim(p_reason) where id = p_id;
  insert into public.party_ledger (party_id, entry_date, entry_type, receipt_id, debit, narration)
  values (v_r.party_id, app.business_today(), 'receipt_reversal', p_id, v_r.amount, 'Cancelled receipt ' || v_r.receipt_no || ': ' || trim(p_reason));
  perform app.audit_event('cancel', 'receipts', p_id::text, jsonb_build_object('receipt_no', v_r.receipt_no, 'reason', trim(p_reason)));
  return jsonb_build_object('id', p_id, 'status', 'cancelled');
end $$;

-- ---------- payments (money out)
create function public.create_payment(p_header jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_party uuid; v_date date; v_amt numeric; v_mode text; v_payee text; v_id uuid; v_no text;
begin
  perform app.require_permission('billing.manage');
  v_party := nullif(p_header ->> 'party_id', '')::uuid;
  v_date := coalesce(nullif(p_header ->> 'payment_date', '')::date, app.business_today());
  v_amt := (p_header ->> 'amount')::numeric; v_mode := p_header ->> 'payment_mode'; v_payee := trim(coalesce(p_header ->> 'payee_name', ''));
  if v_party is not null and not exists (select 1 from public.parties where id = v_party) then raise exception 'Unknown party' using errcode = '22023'; end if;
  if v_party is not null and v_payee = '' then select name into v_payee from public.parties where id = v_party; end if;
  if v_payee = '' then raise exception 'Payee name is required' using errcode = '22023'; end if;
  if v_amt is null or v_amt <= 0 then raise exception 'Amount must be greater than 0' using errcode = '22023'; end if;
  if v_mode is null or v_mode not in ('cash','bank_transfer','upi','cheque','other') then raise exception 'Select a payment mode' using errcode = '22023'; end if;
  if v_date > app.business_today() then raise exception 'Payment date cannot be in the future' using errcode = '22023'; end if;
  v_no := app.next_doc_no('payment', 'PAY', v_date);
  insert into public.payments (payment_no, payment_date, party_id, payee_name, purpose, amount, payment_mode, reference_no, remarks)
  values (v_no, v_date, v_party, v_payee, nullif(trim(p_header ->> 'purpose'), ''), v_amt, v_mode, nullif(trim(p_header ->> 'reference_no'), ''), nullif(trim(p_header ->> 'remarks'), ''))
  returning id into v_id;
  if v_party is not null then
    insert into public.party_ledger (party_id, entry_date, entry_type, payment_id, debit, narration)
    values (v_party, v_date, 'payment', v_id, v_amt, 'Payment ' || v_no);
  end if;
  return jsonb_build_object('id', v_id, 'payment_no', v_no);
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
    raise exception 'Invalid input: %', sqlerrm using errcode = '22023';
end $$;

create function public.cancel_payment(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_p public.payments;
begin
  perform app.require_permission('billing.manage');
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'A cancellation reason is required' using errcode = '22023'; end if;
  select * into v_p from public.payments where id = p_id for update;
  if not found then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  if v_p.status = 'cancelled' then raise exception 'Payment is already cancelled' using errcode = '22023'; end if;
  update public.payments set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = trim(p_reason) where id = p_id;
  if v_p.party_id is not null then
    insert into public.party_ledger (party_id, entry_date, entry_type, payment_id, credit, narration)
    values (v_p.party_id, app.business_today(), 'payment_reversal', p_id, v_p.amount, 'Cancelled payment ' || v_p.payment_no || ': ' || trim(p_reason));
  end if;
  perform app.audit_event('cancel', 'payments', p_id::text, jsonb_build_object('payment_no', v_p.payment_no, 'reason', trim(p_reason)));
  return jsonb_build_object('id', p_id, 'status', 'cancelled');
end $$;

-- ---------- ledger statement with running balance
create function public.ledger_statement(p_party uuid, p_from date, p_to date)
returns table (entry_date date, entry_type text, narration text, debit numeric, credit numeric, balance numeric)
language sql stable security invoker set search_path = '' as $$
  with opening as (
    select (select opening_balance from public.parties where id = p_party)
         + coalesce((select sum(debit - credit) from public.party_ledger where party_id = p_party and entry_date < p_from), 0) as bal
  ), rows as (
    select l.entry_date, l.entry_type, l.narration, l.debit, l.credit, l.created_at, l.id
    from public.party_ledger l where l.party_id = p_party and l.entry_date between p_from and p_to
  )
  select x.entry_date, x.entry_type, x.narration, x.debit, x.credit, x.balance from (
    select 0 as ord, p_from as entry_date, 'opening'::text as entry_type, 'Opening balance'::text as narration,
           null::numeric as debit, null::numeric as credit, (select bal from opening) as balance, null::timestamptz as created_at, null::uuid as id
    union all
    select 1, r.entry_date, r.entry_type, r.narration, r.debit, r.credit,
           (select bal from opening) + sum(r.debit - r.credit) over (order by r.entry_date, r.created_at, r.id), r.created_at, r.id
    from rows r
  ) x
  order by x.ord, x.entry_date, x.created_at, x.id
$$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('save_invoice','issue_invoice','cancel_invoice','create_receipt','cancel_receipt','create_payment','cancel_payment','ledger_statement') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
-- =====================================================================
-- 0009  Reporting views/functions. All SECURITY INVOKER => RLS applies, so the
--       same objects serve admin reports AND the customer portal safely.
-- =====================================================================
create view public.v_inward_lines with (security_invoker = true) as
select t.id as doc_id, t.inward_no as doc_no, t.inward_date as doc_date, t.status, t.cancel_reason, t.party_id, p.name as party_name,
       t.vehicle_no, t.wb_kgs, t.remarks as doc_remarks, t.created_at,
       i.id as line_id, i.line_no, i.product_id, pr.name as product_name, i.rack_id, r.code as rack_code, f.id as floor_id, f.floor_no,
       c.id as chamber_id, c.code as chamber_code, i.bags, i.kgs_per_bag, i.total_kgs, i.wages_party, i.wages_labour
from public.inward_transactions t
join public.inward_items i on i.inward_id = t.id
join public.parties p on p.id = t.party_id
join public.products pr on pr.id = i.product_id
join public.racks r on r.id = i.rack_id
join public.floors f on f.id = r.floor_id
join public.chambers c on c.id = f.chamber_id;

create view public.v_outward_lines with (security_invoker = true) as
select t.id as doc_id, t.outward_no as doc_no, t.outward_date as doc_date, t.status, t.cancel_reason, t.party_id, p.name as party_name,
       t.vehicle_no, t.remarks as doc_remarks, t.created_at,
       i.id as line_id, i.line_no, i.product_id, pr.name as product_name, i.rack_id, r.code as rack_code, f.id as floor_id, f.floor_no,
       c.id as chamber_id, c.code as chamber_code, i.bags, i.kgs_per_bag, i.total_kgs, i.wages_party, i.wages_labour
from public.outward_transactions t
join public.outward_items i on i.outward_id = t.id
join public.parties p on p.id = t.party_id
join public.products pr on pr.id = i.product_id
join public.racks r on r.id = i.rack_id
join public.floors f on f.id = r.floor_id
join public.chambers c on c.id = f.chamber_id;

create view public.v_stock_detail with (security_invoker = true) as
select b.*, p.name as party_name, p.party_code, pr.name as product_name, pr.category, r.code as rack_code, f.floor_no, c.code as chamber_code
from public.stock_balances b
join public.parties p on p.id = b.party_id
join public.products pr on pr.id = b.product_id
join public.racks r on r.id = b.rack_id
join public.floors f on f.id = b.floor_id
join public.chambers c on c.id = b.chamber_id;

create view public.v_labour with (security_invoker = true) as
select l.id, l.kind, l.record_date, l.status, l.party_id, p.name as party_name, l.product_id, pr.name as product_name,
       coalesce(i.inward_no, o.outward_no) as doc_no, l.bags, l.wages_labour, l.wages_party
from public.labour_records l
join public.parties p on p.id = l.party_id
join public.products pr on pr.id = l.product_id
left join public.inward_transactions i on i.id = l.inward_id
left join public.outward_transactions o on o.id = l.outward_id;

-- Stock register: opening / inward / outward / adjustment / closing for a period (net of cancellations)
create function public.stock_register(p_from date, p_to date, p_party uuid default null, p_product uuid default null,
                                      p_chamber uuid default null, p_floor uuid default null)
returns table (party_id uuid, party_name text, product_id uuid, product_name text,
               opening_bags bigint, opening_kgs numeric, inward_bags bigint, inward_kgs numeric,
               outward_bags bigint, outward_kgs numeric, adjustment_bags bigint, adjustment_kgs numeric,
               closing_bags bigint, closing_kgs numeric)
language sql stable security invoker set search_path = '' as $$
  select m.party_id, p.name, m.product_id, pr.name,
    coalesce(sum(m.bags) filter (where m.movement_date < p_from), 0)::bigint,
    coalesce(sum(m.kgs)  filter (where m.movement_date < p_from), 0)::numeric,
    coalesce(sum(m.bags) filter (where m.movement_date between p_from and p_to and m.movement_type in ('inward','inward_reversal')), 0)::bigint,
    coalesce(sum(m.kgs)  filter (where m.movement_date between p_from and p_to and m.movement_type in ('inward','inward_reversal')), 0)::numeric,
    coalesce(-sum(m.bags) filter (where m.movement_date between p_from and p_to and m.movement_type in ('outward','outward_reversal')), 0)::bigint,
    coalesce(-sum(m.kgs)  filter (where m.movement_date between p_from and p_to and m.movement_type in ('outward','outward_reversal')), 0)::numeric,
    coalesce(sum(m.bags) filter (where m.movement_date between p_from and p_to and m.movement_type = 'adjustment'), 0)::bigint,
    coalesce(sum(m.kgs)  filter (where m.movement_date between p_from and p_to and m.movement_type = 'adjustment'), 0)::numeric,
    coalesce(sum(m.bags) filter (where m.movement_date <= p_to), 0)::bigint,
    coalesce(sum(m.kgs)  filter (where m.movement_date <= p_to), 0)::numeric
  from public.stock_movements m
  join public.parties p on p.id = m.party_id
  join public.products pr on pr.id = m.product_id
  join public.racks r on r.id = m.rack_id
  join public.floors f on f.id = r.floor_id
  where (p_party is null or m.party_id = p_party) and (p_product is null or m.product_id = p_product)
    and (p_chamber is null or f.chamber_id = p_chamber) and (p_floor is null or f.id = p_floor)
  group by m.party_id, p.name, m.product_id, pr.name
  having coalesce(sum(m.bags) filter (where m.movement_date <= p_to), 0) <> 0
      or coalesce(sum(m.bags) filter (where m.movement_date between p_from and p_to), 0) <> 0
      or coalesce(sum(m.bags) filter (where m.movement_date < p_from), 0) <> 0
  order by p.name, pr.name
$$;

-- Floor-wise report: current stock plus movements in the period, for every active floor (incl. empty ones)
create function public.floor_report(p_from date, p_to date)
returns table (chamber_code text, floor_id uuid, floor_no int, current_bags bigint, current_kgs numeric,
               inward_bags bigint, inward_kgs numeric, outward_bags bigint, outward_kgs numeric, parties bigint, products bigint)
language sql stable security invoker set search_path = '' as $$
  select c.code, f.id, f.floor_no,
    coalesce(sum(m.bags), 0)::bigint, coalesce(sum(m.kgs), 0)::numeric,
    coalesce(sum(m.bags) filter (where m.movement_date between p_from and p_to and m.movement_type in ('inward','inward_reversal')), 0)::bigint,
    coalesce(sum(m.kgs)  filter (where m.movement_date between p_from and p_to and m.movement_type in ('inward','inward_reversal')), 0)::numeric,
    coalesce(-sum(m.bags) filter (where m.movement_date between p_from and p_to and m.movement_type in ('outward','outward_reversal')), 0)::bigint,
    coalesce(-sum(m.kgs)  filter (where m.movement_date between p_from and p_to and m.movement_type in ('outward','outward_reversal')), 0)::numeric,
    count(distinct m.party_id) filter (where m.id is not null and m.movement_date <= app.business_today()
         and exists (select 1 from public.stock_balances b where b.floor_id = f.id and b.party_id = m.party_id and b.available_bags > 0)),
    count(distinct m.product_id) filter (where m.id is not null
         and exists (select 1 from public.stock_balances b where b.floor_id = f.id and b.product_id = m.product_id and b.available_bags > 0))
  from public.floors f
  join public.chambers c on c.id = f.chamber_id
  left join public.racks r on r.floor_id = f.id
  left join public.stock_movements m on m.rack_id = r.id
  where f.is_active and c.is_active
  group by c.code, c.sort_order, f.id, f.floor_no
  order by c.sort_order, c.code, f.floor_no
$$;

-- Rojmel (PROVISIONAL daily journal - layout to be confirmed with the client)
create function public.rojmel(p_date date)
returns table (kind text, ref_no text, party_name text, description text, bags bigint, kgs numeric, amount_in numeric, amount_out numeric, status text)
language sql stable security invoker set search_path = '' as $$
  select j.kind, j.ref_no, j.party_name, j.description, j.bags, j.kgs, j.amount_in, j.amount_out, j.status from (
    select 'Inward'::text, t.inward_no, p.name, string_agg(pr.name || ' x' || i.bags, ', ' order by i.line_no), sum(i.bags)::bigint, sum(i.total_kgs)::numeric, null::numeric, null::numeric, t.status::text, t.created_at
    from public.inward_transactions t join public.inward_items i on i.inward_id = t.id join public.parties p on p.id = t.party_id join public.products pr on pr.id = i.product_id
    where t.inward_date = p_date group by t.id, p.name
    union all
    select 'Outward', t.outward_no, p.name, string_agg(pr.name || ' x' || i.bags, ', ' order by i.line_no), sum(i.bags)::bigint, sum(i.total_kgs)::numeric, null, null, t.status::text, t.created_at
    from public.outward_transactions t join public.outward_items i on i.outward_id = t.id join public.parties p on p.id = t.party_id join public.products pr on pr.id = i.product_id
    where t.outward_date = p_date group by t.id, p.name
    union all
    select 'Receipt', r.receipt_no, p.name, r.payment_mode || coalesce(' ' || r.reference_no, ''), null, null, r.amount, null, r.status::text, r.created_at
    from public.receipts r join public.parties p on p.id = r.party_id where r.receipt_date = p_date
    union all
    select 'Payment', y.payment_no, y.payee_name, coalesce(y.purpose, y.payment_mode), null, null, null, y.amount, y.status::text, y.created_at
    from public.payments y where y.payment_date = p_date
  ) j(kind, ref_no, party_name, description, bags, kgs, amount_in, amount_out, status, created_at)
  order by j.created_at
$$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('stock_register','floor_report','rojmel') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
