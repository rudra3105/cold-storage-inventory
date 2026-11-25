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
