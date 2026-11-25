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
