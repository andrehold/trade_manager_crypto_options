\set ON_ERROR_STOP on

begin;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.append_auth_identity_admin_audit(
  '11111111-1111-4111-8111-111111111111',
  null,
  '22222222-2222-4222-8222-222222222222',
  'ACCEPTANCE-1',
  'applied'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"33333333-3333-4333-8333-333333333333","app_metadata":{"client_id":"22222222-2222-4222-8222-222222222222"}}';
select public._slice2_assert(
  (select count(*) from public.auth_identity_admin_audit) = 0,
  'ordinary client read identity-repair audit rows'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"44444444-4444-4444-8444-444444444444","app_metadata":{"role":"admin"}}';
select public._slice2_assert(
  (select count(*) from public.auth_identity_admin_audit where change_reference = 'ACCEPTANCE-1') = 1,
  'trusted administrator could not read identity-repair audit rows'
);

reset role;
select public._slice2_assert(
  not has_table_privilege('authenticated', 'public.auth_identity_admin_audit', 'INSERT')
    and not has_table_privilege('authenticated', 'public.auth_identity_admin_audit', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.auth_identity_admin_audit', 'DELETE'),
  'authenticated role has a direct identity-audit write privilege'
);
select public._slice2_assert(
  not has_table_privilege('service_role', 'public.auth_identity_admin_audit', 'INSERT')
    and not has_table_privilege('service_role', 'public.auth_identity_admin_audit', 'UPDATE')
    and not has_table_privilege('service_role', 'public.auth_identity_admin_audit', 'DELETE'),
  'service role can bypass the append-only RPC with a direct table write'
);
select public._slice2_assert(
  not has_function_privilege(
    'authenticated',
    'public.append_auth_identity_admin_audit(uuid,uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'authenticated role can call the identity-audit append RPC'
);
select public._slice2_assert(
  has_function_privilege(
    'service_role',
    'public.append_auth_identity_admin_audit(uuid,uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'service role cannot call the identity-audit append RPC'
);

rollback;

\echo 'Auth identity admin audit PostgreSQL acceptance passed.'
