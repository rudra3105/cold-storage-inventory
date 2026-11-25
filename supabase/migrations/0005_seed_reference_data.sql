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
