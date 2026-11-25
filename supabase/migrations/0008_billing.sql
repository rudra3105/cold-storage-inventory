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
