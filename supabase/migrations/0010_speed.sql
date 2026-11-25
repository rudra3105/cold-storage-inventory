-- =====================================================================
-- 0010  Speed
--  * public.stock_position: running balance per (party, product, rack), maintained by a
--    trigger on every ledger insert (same transaction, same locks). The ledger stays the
--    source of truth; public.verify_stock_position() proves the two agree.
--    public.stock_balances now reads this small table instead of summing the whole ledger.
--  * public.app_session(): sign-in context (profile, role, permissions, party, business
--    name) in ONE database call instead of five.
-- =====================================================================

create table public.stock_position (
  party_id    uuid not null references public.parties(id)  on delete restrict,
  product_id  uuid not null references public.products(id) on delete restrict,
  rack_id     uuid not null references public.racks(id)    on delete restrict,
  inward_bags bigint        not null default 0,
  outward_bags bigint       not null default 0,
  adjustment_bags bigint    not null default 0,
  available_bags bigint     not null default 0,
  inward_kgs  numeric(16,3) not null default 0,
  outward_kgs numeric(16,3) not null default 0,
  adjustment_kgs numeric(16,3) not null default 0,
  available_kgs numeric(16,3) not null default 0,
  primary key (party_id, product_id, rack_id)
);
create index stock_position_rack_idx    on public.stock_position (rack_id);
create index stock_position_product_idx on public.stock_position (product_id);

create function app.apply_stock_position() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_in  boolean := new.movement_type in ('inward','inward_reversal');
  v_out boolean := new.movement_type in ('outward','outward_reversal');
  v_adj boolean := new.movement_type = 'adjustment';
begin
  insert into public.stock_position as s
    (party_id, product_id, rack_id, inward_bags, outward_bags, adjustment_bags, available_bags,
     inward_kgs, outward_kgs, adjustment_kgs, available_kgs)
  values (new.party_id, new.product_id, new.rack_id,
     case when v_in  then new.bags else 0 end, case when v_out then -new.bags else 0 end, case when v_adj then new.bags else 0 end, new.bags,
     case when v_in  then new.kgs  else 0 end, case when v_out then -new.kgs  else 0 end, case when v_adj then new.kgs  else 0 end, new.kgs)
  on conflict (party_id, product_id, rack_id) do update set
     inward_bags     = s.inward_bags     + excluded.inward_bags,
     outward_bags    = s.outward_bags    + excluded.outward_bags,
     adjustment_bags = s.adjustment_bags + excluded.adjustment_bags,
     available_bags  = s.available_bags  + excluded.available_bags,
     inward_kgs      = s.inward_kgs      + excluded.inward_kgs,
     outward_kgs     = s.outward_kgs     + excluded.outward_kgs,
     adjustment_kgs  = s.adjustment_kgs  + excluded.adjustment_kgs,
     available_kgs   = s.available_kgs   + excluded.available_kgs;
  return null;
end $$;
create trigger trg_stock_movements_position after insert on public.stock_movements
  for each row execute function app.apply_stock_position();

-- backfill from the existing ledger
insert into public.stock_position
select m.party_id, m.product_id, m.rack_id,
  coalesce(sum(m.bags) filter (where m.movement_type in ('inward','inward_reversal')), 0),
  coalesce(-sum(m.bags) filter (where m.movement_type in ('outward','outward_reversal')), 0),
  coalesce(sum(m.bags) filter (where m.movement_type = 'adjustment'), 0),
  sum(m.bags),
  coalesce(sum(m.kgs) filter (where m.movement_type in ('inward','inward_reversal')), 0),
  coalesce(-sum(m.kgs) filter (where m.movement_type in ('outward','outward_reversal')), 0),
  coalesce(sum(m.kgs) filter (where m.movement_type = 'adjustment'), 0),
  sum(m.kgs)
from public.stock_movements m group by m.party_id, m.product_id, m.rack_id;

-- same privileges/RLS model as the ledger: read-only, customers see only their own party
alter table public.stock_position enable row level security;
revoke all on public.stock_position from anon, authenticated;
grant select on public.stock_position to authenticated;
create policy stock_position_select on public.stock_position for select to authenticated
  using (app.is_internal() or party_id = app.current_party_id());

-- same columns, names and types as before: dependent views and the app keep working
create or replace view public.stock_balances with (security_invoker = true) as
select s.party_id, s.product_id, s.rack_id, r.floor_id, f.chamber_id,
  s.inward_bags, s.outward_bags, s.adjustment_bags, s.available_bags,
  s.inward_kgs, s.outward_kgs, s.adjustment_kgs, s.available_kgs
from public.stock_position s
join public.racks r  on r.id = s.rack_id
join public.floors f on f.id = r.floor_id;

-- proof that the fast table equals the ledger (returns the positions that DISAGREE; expect none)
create function public.verify_stock_position()
returns table (party_id uuid, product_id uuid, rack_id uuid, ledger_bags bigint, table_bags bigint, ledger_kgs numeric, table_kgs numeric)
language sql stable security definer set search_path = '' as $$
  select coalesce(l.party_id, s.party_id), coalesce(l.product_id, s.product_id), coalesce(l.rack_id, s.rack_id),
         coalesce(l.bags, 0)::bigint, coalesce(s.available_bags, 0), coalesce(l.kgs, 0), coalesce(s.available_kgs, 0)
  from (select m.party_id, m.product_id, m.rack_id, sum(m.bags)::bigint as bags, sum(m.kgs) as kgs
          from public.stock_movements m group by 1, 2, 3) l
  full join public.stock_position s on s.party_id = l.party_id and s.product_id = l.product_id and s.rack_id = l.rack_id
  where coalesce(l.bags, 0) <> coalesce(s.available_bags, 0) or coalesce(l.kgs, 0) <> coalesce(s.available_kgs, 0)
$$;
revoke all on function public.verify_stock_position() from public, anon, authenticated;

-- one-call sign-in context
create function public.app_session() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_role public.app_role; v_name text; v_active boolean; v_party uuid; v_perms jsonb;
begin
  if v_uid is null then return null; end if;
  select p.full_name, p.is_active into v_name, v_active from public.profiles p where p.id = v_uid;
  select ur.role into v_role from public.user_roles ur where ur.user_id = v_uid;
  if v_name is null or not v_active or v_role is null then return null; end if;
  if v_role = 'super_admin' then
    select coalesce(jsonb_agg(key), '[]') into v_perms from public.permissions_catalog;
  elsif v_role = 'customer' then
    select id into v_party from public.parties where user_id = v_uid and is_active;
    if v_party is null then return null; end if;
    v_perms := '[]';
  else
    select coalesce(jsonb_agg(permission), '[]') into v_perms from public.role_permissions where role = v_role and allowed;
  end if;
  return jsonb_build_object('user_id', v_uid, 'full_name', v_name, 'role', v_role, 'party_id', v_party, 'permissions', v_perms,
    'business_name', coalesce((select business_name from public.business_settings limit 1), 'Cold Storage'));
end $$;
revoke all on function public.app_session() from public, anon;
grant execute on function public.app_session() to authenticated;

-- ---------- RLS speed: evaluate role/identity helpers ONCE per query, not once per row ----------
-- (wrapping a stable function call in (select ...) turns it into a one-time initplan; the rule
--  itself is unchanged, so who can see what stays exactly the same)
do $$
declare p record; v_q text; v_c text;
begin
  for p in select schemaname, tablename, policyname, qual, with_check from pg_policies where schemaname = 'public' loop
    if coalesce(p.qual,'') ~* '\(\s*select\s+(app\.|auth\.)' or coalesce(p.with_check,'') ~* '\(\s*select\s+(app\.|auth\.)' then continue; end if;   -- already optimised
    v_q := p.qual; v_c := p.with_check;
    if v_q is not null then v_q := regexp_replace(v_q, '(app\.[a-z_]+\([^()]*\)|auth\.uid\(\))', '(select \1)', 'g'); end if;
    if v_c is not null then v_c := regexp_replace(v_c, '(app\.[a-z_]+\([^()]*\)|auth\.uid\(\))', '(select \1)', 'g'); end if;
    if v_q is distinct from p.qual then
      execute format('alter policy %I on %I.%I using (%s)', p.policyname, p.schemaname, p.tablename, v_q);
    end if;
    if v_c is distinct from p.with_check then
      execute format('alter policy %I on %I.%I with check (%s)', p.policyname, p.schemaname, p.tablename, v_c);
    end if;
  end loop;
end $$;

-- "Latest entries" on the home screen sorts by creation time
create index if not exists inward_created_idx  on public.inward_transactions  (created_at desc);
create index if not exists outward_created_idx on public.outward_transactions (created_at desc);
