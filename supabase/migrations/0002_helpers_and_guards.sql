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
