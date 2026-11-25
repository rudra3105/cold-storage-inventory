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
