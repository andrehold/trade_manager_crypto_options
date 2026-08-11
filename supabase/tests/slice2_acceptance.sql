\set ON_ERROR_STOP on

begin;

-- Canonical fixture accounts and their owned structures are all rolled back at
-- the end, leaving the persistent local development database untouched.
insert into public.clients (client_id, client_name) values
  ('a0000000-0000-4000-8000-000000000001', 'Alpha'),
  ('b0000000-0000-4000-8000-000000000002', 'Beta');

insert into public.positions (position_id, client_id, client_name) values
  ('alpha-position', 'a0000000-0000-4000-8000-000000000001', 'Alpha'),
  ('beta-position', 'b0000000-0000-4000-8000-000000000002', 'Beta');
insert into public.legs (position_id) values ('alpha-position'), ('beta-position');
insert into public.fills (position_id) values ('alpha-position'), ('beta-position');

set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"c0000000-0000-4000-8000-000000000003","app_metadata":{"client_id":"a0000000-0000-4000-8000-000000000001"}}';

-- These must be top-level statements: PostgreSQL executes anonymous DO blocks as
-- their session owner, which would bypass table-owner RLS in this plain-PG shim.
select public._slice2_assert(
  (select count(*) from public.clients) = 1,
  'client must see exactly one profile'
);
select public._slice2_assert(
  (select count(*) from public.positions) = 1
    and (select count(*) from public.legs) = 1
    and (select count(*) from public.fills) = 1,
  'client must see only its owned structures'
);
select public._slice2_assert(not exists (
  select 1 from public.audit_events where id = 'f0000000-0000-4000-8000-000000000001'
), 'client must not see unresolved legacy state');
with changed as (
  update public.clients set hub_account_id = 'd0000000-0000-4000-8000-000000000004'
  where client_id = 'a0000000-0000-4000-8000-000000000001' returning 1
) select public._slice2_assert(not exists (select 1 from changed), 'client updated its own mapping directly');
with changed as (
  update public.clients set hub_account_id = 'd0000000-0000-4000-8000-000000000004'
  where client_id = 'b0000000-0000-4000-8000-000000000002' returning 1
) select public._slice2_assert(not exists (select 1 from changed), 'client updated another mapping');
with changed as (
  update public.positions set client_name = 'forbidden' where position_id = 'alpha-position' returning 1
) select public._slice2_assert(not exists (select 1 from changed), 'client mutated a position');
with changed as (
  update public.legs set position_id = 'beta-position' where position_id = 'alpha-position' returning 1
) select public._slice2_assert(not exists (select 1 from changed), 'client mutated a leg');
with changed as (
  update public.fills set position_id = 'beta-position' where position_id = 'alpha-position' returning 1
) select public._slice2_assert(not exists (select 1 from changed), 'client mutated a fill');
select public._slice2_assert(
  (select count(*) from public.transaction_logs) = 0
    and (select count(*) from public.unprocessed_imports) = 0,
  'client read an admin import workspace'
);

-- Client currency RPC normalizes, stamps provenance, and cannot update an
-- arbitrary client row or mapping.
do $$
declare
  v_currency text;
  v_source text;
  v_rows integer;
begin
  select reporting_currency, reporting_currency_source
  into v_currency, v_source
  from public.set_own_reporting_currency('usdc');
  if v_currency <> 'USDC' or v_source <> 'client' then
    raise exception 'client currency RPC did not normalize/provenance-stamp';
  end if;

  begin
    perform public.admin_set_client_reporting_currency(
      'a0000000-0000-4000-8000-000000000001', 'USD'
    );
    raise exception 'client unexpectedly called admin currency RPC';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.admin_set_client_hub_account_mapping(
      'a0000000-0000-4000-8000-000000000001',
      'd0000000-0000-4000-8000-000000000004',
      'Forbidden'
    );
    raise exception 'client unexpectedly called admin Hub mapping RPC';
  exception when insufficient_privilege then
    null;
  end;

  insert into public.audit_events (client_name) values ('Beta');
  if not exists (
    select 1 from public.audit_events
    where client_name = 'Alpha'
      and client_id = 'a0000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'state ownership trigger did not rewrite supplied client_name';
  end if;

end;
$$;

with changed as (
  update public.client_account_config_audit set actor_role = 'admin'
  where client_id = 'a0000000-0000-4000-8000-000000000001' returning 1
) select public._slice2_assert(not exists (select 1 from changed), 'client updated configuration audit history');
with changed as (
  delete from public.client_account_config_audit
  where client_id = 'a0000000-0000-4000-8000-000000000001' returning 1
) select public._slice2_assert(not exists (select 1 from changed), 'client deleted configuration audit history');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"c0000000-0000-4000-8000-000000000003","app_metadata":{},"user_metadata":{"client_id":"a0000000-0000-4000-8000-000000000001"}}';
select public._slice2_assert(
  (select count(*) from public.clients) = 0,
  'user_metadata client_id was treated as authority'
);
do $$
begin
  begin
    perform public.set_own_reporting_currency('USD');
    raise exception 'missing app_metadata client_id was accepted';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"c0000000-0000-4000-8000-000000000003","app_metadata":{"client_id":"not-a-uuid"}}';
select public._slice2_assert(
  (select count(*) from public.clients) = 0,
  'malformed app_metadata client_id did not fail closed'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"e0000000-0000-4000-8000-000000000005","app_metadata":{"role":"admin"}}';

-- Admin/server RPCs, immutable configuration audit, mapping uniqueness, direct
-- write normalization, rename cascade, and delete restriction.
do $$
declare
  v_timestamp timestamptz;
begin
  select hub_account_mapped_at into v_timestamp
  from public.admin_set_client_hub_account_mapping(
    'a0000000-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000004',
    'Hub Alpha'
  );
  if v_timestamp is null then
    raise exception 'mapped account did not receive mapping timestamp';
  end if;

  perform public.admin_set_client_reporting_currency(
    'a0000000-0000-4000-8000-000000000001', 'usdc'
  );
  if not exists (
    select 1 from public.clients
    where client_id = 'a0000000-0000-4000-8000-000000000001'
      and reporting_currency = 'USDC'
      and reporting_currency_source = 'admin'
  ) then
    raise exception 'same-value admin selection did not take provenance ownership';
  end if;

  begin
    perform public.admin_set_client_hub_account_mapping(
      'b0000000-0000-4000-8000-000000000002',
      'd0000000-0000-4000-8000-000000000004',
      'Duplicate'
    );
    raise exception 'duplicate Hub mapping was accepted';
  exception when unique_violation then
    null;
  end;

  update public.clients
  set reporting_currency = 'eur'
  where client_id = 'a0000000-0000-4000-8000-000000000001';
  if not exists (
    select 1 from public.clients
    where client_id = 'a0000000-0000-4000-8000-000000000001'
      and reporting_currency = 'EUR'
      and reporting_currency_source = 'admin'
  ) then
    raise exception 'direct administrator currency write was not canonicalized';
  end if;

  insert into public.transaction_logs (client_name) values ('Alpha');
  if not exists (
    select 1 from public.transaction_logs
    where client_name = 'Alpha' and client_id = 'a0000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'admin transaction log insert did not receive canonical ownership';
  end if;
  update public.transaction_logs set client_name = 'Alpha'
  where client_id = 'a0000000-0000-4000-8000-000000000001';
  delete from public.transaction_logs where client_id = 'a0000000-0000-4000-8000-000000000001';
  if exists (select 1 from public.transaction_logs where client_id = 'a0000000-0000-4000-8000-000000000001') then
    raise exception 'admin import workspace delete failed';
  end if;
  insert into public.unprocessed_imports (client_name) values ('Alpha');
  if not exists (
    select 1 from public.unprocessed_imports
    where client_name = 'Alpha' and client_id = 'a0000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'admin unprocessed import insert did not receive canonical ownership';
  end if;
  update public.unprocessed_imports set client_name = 'Alpha'
  where client_id = 'a0000000-0000-4000-8000-000000000001';
  delete from public.unprocessed_imports where client_id = 'a0000000-0000-4000-8000-000000000001';
  if exists (select 1 from public.unprocessed_imports where client_id = 'a0000000-0000-4000-8000-000000000001') then
    raise exception 'admin unprocessed import delete failed';
  end if;

  update public.clients
  set client_name = 'Alpha Renamed'
  where client_id = 'a0000000-0000-4000-8000-000000000001';
  if not exists (
    select 1 from public.positions
    where position_id = 'alpha-position' and client_name = 'Alpha Renamed'
  ) or not exists (
    select 1 from public.audit_events
    where client_id = 'a0000000-0000-4000-8000-000000000001'
      and client_name = 'Alpha Renamed'
  ) then
    raise exception 'client-name snapshot cascade failed';
  end if;

  if not exists (
    select 1 from public.client_account_config_audit
    where client_id = 'a0000000-0000-4000-8000-000000000001'
      and actor_id = 'c0000000-0000-4000-8000-000000000003'
      and actor_role = 'client'
      and event_type = 'reporting_currency'
      and old_value ->> 'reporting_currency' is null
      and new_value ->> 'reporting_currency' = 'USDC'
      and new_value ->> 'reporting_currency_source' = 'client'
  ) then
    raise exception 'configuration audit is missing the client currency transition';
  end if;
  if not exists (
    select 1 from public.client_account_config_audit
    where client_id = 'a0000000-0000-4000-8000-000000000001'
      and actor_id = 'e0000000-0000-4000-8000-000000000005'
      and actor_role = 'admin'
      and event_type = 'hub_account_mapping'
      and old_value ->> 'hub_account_id' is null
      and new_value ->> 'hub_account_id' = 'd0000000-0000-4000-8000-000000000004'
      and new_value ->> 'hub_account_label' = 'Hub Alpha'
  ) then
    raise exception 'configuration audit is missing the admin mapping transition';
  end if;
  if not exists (
    select 1 from public.client_account_config_audit
    where client_id = 'a0000000-0000-4000-8000-000000000001'
      and actor_role = 'admin'
      and event_type = 'reporting_currency'
      and old_value ->> 'reporting_currency' = 'USDC'
      and new_value ->> 'reporting_currency' = 'EUR'
  ) then
    raise exception 'configuration audit is missing meaningful old/new currency values';
  end if;

  begin
    delete from public.clients where client_id = 'a0000000-0000-4000-8000-000000000001';
    raise exception 'stateful client deletion was accepted';
  exception when foreign_key_violation then
    null;
  end;
end;
$$;

reset role;

-- The pre-migration unresolved historical row has no client_id and remains
-- available to administrators but not a client-owned row.
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated","sub":"e0000000-0000-4000-8000-000000000005","app_metadata":{"role":"admin"}}';
select public._slice2_assert(exists (
  select 1 from public.audit_events
  where id = 'f0000000-0000-4000-8000-000000000001'
    and client_id is null
), 'admin cannot read unresolved legacy state');
reset role;

rollback;

\echo 'Slice 2 PostgreSQL acceptance passed.'
