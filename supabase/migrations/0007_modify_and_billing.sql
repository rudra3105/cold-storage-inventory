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
