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
