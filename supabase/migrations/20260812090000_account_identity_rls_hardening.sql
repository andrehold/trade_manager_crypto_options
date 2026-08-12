-- Establish one trusted account boundary across the existing client portal.
-- Authorization uses app_metadata.client_id; editable user_metadata and
-- client_name snapshots are never authorization inputs.

begin;

create schema if not exists helpers;
revoke all on schema helpers from public;
grant usage on schema helpers to authenticated;

create or replace function helpers.current_client_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(auth.jwt() -> 'app_metadata' ->> 'client_id', '')
           ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (auth.jwt() -> 'app_metadata' ->> 'client_id')::uuid
    else null
  end;
$$;

create or replace function helpers.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.role() = 'authenticated'
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

create or replace function helpers.is_service_role()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.role() = 'service_role';
$$;

revoke all on function helpers.current_client_id() from public;
revoke all on function helpers.is_admin() from public;
revoke all on function helpers.is_service_role() from public;
grant execute on function helpers.current_client_id() to authenticated;
grant execute on function helpers.is_admin() to authenticated;

-- Replace every clients policy because PostgreSQL combines permissive policies
-- with OR. Clients may read their own profile but never mutate it directly.
do $$
begin
  if to_regclass('public.clients') is null then
    raise exception 'public.clients must exist before account identity hardening';
  end if;
end;
$$;

alter table public.clients enable row level security;

do $$
declare
  v_policy record;
begin
  for v_policy in
    select polname from pg_policy where polrelid = 'public.clients'::regclass
  loop
    execute format('drop policy %I on public.clients', v_policy.polname);
  end loop;
end;
$$;

create policy "Admins manage clients"
  on public.clients
  for all
  using (helpers.is_admin())
  with check (helpers.is_admin());

create policy "Clients read own client profile"
  on public.clients
  for select
  using (client_id = helpers.current_client_id());

-- Add authoritative client IDs to append-only portal state. Existing names are
-- retained as compatibility/display snapshots and backfilled where possible.
do $$
declare
  v_table text;
  v_policy record;
begin
  foreach v_table in array array[
    'appropriateness_assessments',
    'strategy_selections',
    'risk_limit_selections',
    'exchange_key_events',
    'activation_events',
    'update_approvals',
    'audit_events',
    'position_interventions'
  ]
  loop
    continue when to_regclass(format('public.%I', v_table)) is null;
    execute format('alter table public.%I add column if not exists client_id uuid', v_table);
    execute format(
      'update public.%I as state set client_id = client.client_id from public.clients as client where state.client_id is null and state.client_name = client.client_name',
      v_table
    );
    execute format(
      'create index if not exists %I on public.%I (client_id, ts desc)',
      v_table || '_account_ts_idx',
      v_table
    );
    execute format('alter table public.%I enable row level security', v_table);

    for v_policy in execute format(
      'select polname from pg_policy where polrelid = %L::regclass',
      format('public.%I', v_table)
    )
    loop
      execute format('drop policy %I on public.%I', v_policy.polname, v_table);
    end loop;

    execute format(
      'create policy %I on public.%I for select using (client_id = helpers.current_client_id())',
      v_table || ' account members read own', v_table
    );
    execute format(
      'create policy %I on public.%I for insert with check (client_id = helpers.current_client_id())',
      v_table || ' account members insert own', v_table
    );
    execute format(
      'create policy %I on public.%I for select using (helpers.is_admin())',
      v_table || ' admins read all', v_table
    );
    execute format(
      'create policy %I on public.%I for insert with check (helpers.is_admin())',
      v_table || ' admins insert', v_table
    );
  end loop;
end;
$$;

-- Import workspaces are account-owned but remain admin-only and mutable.
do $$
declare
  v_table text;
  v_policy record;
begin
  foreach v_table in array array['transaction_logs', 'unprocessed_imports']
  loop
    continue when to_regclass(format('public.%I', v_table)) is null;
    execute format('alter table public.%I add column if not exists client_id uuid', v_table);
    execute format(
      'update public.%I as state set client_id = client.client_id from public.clients as client where state.client_id is null and state.client_name = client.client_name',
      v_table
    );
    execute format(
      'create index if not exists %I on public.%I (client_id, created_at desc)',
      v_table || '_account_created_at_idx', v_table
    );
    execute format('alter table public.%I enable row level security', v_table);

    for v_policy in execute format(
      'select polname from pg_policy where polrelid = %L::regclass',
      format('public.%I', v_table)
    )
    loop
      execute format('drop policy %I on public.%I', v_policy.polname, v_table);
    end loop;

    execute format(
      'create policy %I on public.%I for all using (helpers.is_admin()) with check (helpers.is_admin())',
      v_table || ' admins manage imports', v_table
    );
  end loop;
end;
$$;

-- Every child relationship is explicit and preserves history on client deletion.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'appropriateness_assessments',
    'strategy_selections',
    'risk_limit_selections',
    'exchange_key_events',
    'activation_events',
    'update_approvals',
    'audit_events',
    'position_interventions',
    'transaction_logs',
    'unprocessed_imports',
    'positions'
  ]
  loop
    continue when to_regclass(format('public.%I', v_table)) is null;
    execute format('alter table public.%I add column if not exists client_id uuid', v_table);
    execute format(
      'update public.%I as state set client_id = client.client_id from public.clients as client where state.client_id is null and state.client_name = client.client_name',
      v_table
    );
    execute format('alter table public.%I drop constraint if exists %I', v_table, v_table || '_client_id_fkey');
    execute format(
      'alter table public.%I add constraint %I foreign key (client_id) references public.clients(client_id) on delete restrict',
      v_table, v_table || '_client_id_fkey'
    );
  end loop;
end;
$$;

-- Core structures are read-only for clients and fully manageable by admins.
-- Each table is optional so this also works in a partially initialized project.
do $$
declare
  v_table text;
  v_policy record;
begin
  foreach v_table in array array['positions', 'legs', 'fills']
  loop
    continue when to_regclass(format('public.%I', v_table)) is null;
    execute format('alter table public.%I enable row level security', v_table);
    for v_policy in execute format(
      'select polname from pg_policy where polrelid = %L::regclass',
      format('public.%I', v_table)
    )
    loop
      execute format('drop policy %I on public.%I', v_policy.polname, v_table);
    end loop;
  end loop;

  if to_regclass('public.positions') is not null then
    execute 'create policy "Positions admins manage" on public.positions for all using (helpers.is_admin()) with check (helpers.is_admin())';
    execute 'create policy "Positions account members read own" on public.positions for select using (client_id = helpers.current_client_id())';
  end if;

  if to_regclass('public.legs') is not null then
    execute 'create policy "Legs admins manage" on public.legs for all using (helpers.is_admin()) with check (helpers.is_admin())';
    if to_regclass('public.positions') is not null then
      execute 'create policy "Legs account members read own" on public.legs for select using (exists (select 1 from public.positions as position where position.position_id = public.legs.position_id and position.client_id = helpers.current_client_id()))';
    end if;
  end if;

  if to_regclass('public.fills') is not null then
    execute 'create policy "Fills admins manage" on public.fills for all using (helpers.is_admin()) with check (helpers.is_admin())';
    if to_regclass('public.positions') is not null then
      execute 'create policy "Fills account members read own" on public.fills for select using (exists (select 1 from public.positions as position where position.position_id = public.fills.position_id and position.client_id = helpers.current_client_id()))';
    end if;
  end if;
end;
$$;

-- Rewrite client-owned state from the trusted account ID. A supplied name is
-- never an authorization input.
create or replace function public.assign_portal_state_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid;
  v_client_name text;
begin
  if helpers.is_admin() or helpers.is_service_role() then
    if new.client_id is not null then
      select client.client_id, client.client_name
      into v_client_id, v_client_name
      from public.clients as client
      where client.client_id = new.client_id;
    elsif nullif(btrim(new.client_name), '') is not null then
      select client.client_id, client.client_name
      into v_client_id, v_client_name
      from public.clients as client
      where client.client_name = btrim(new.client_name);
    end if;
  else
    v_client_id := helpers.current_client_id();
    if v_client_id is not null then
      select client.client_id, client.client_name
      into v_client_id, v_client_name
      from public.clients as client
      where client.client_id = v_client_id;
    end if;
  end if;

  if v_client_id is null then
    raise exception 'a mapped client account is required for portal state'
      using errcode = '42501';
  end if;

  new.client_id := v_client_id;
  new.client_name := v_client_name;
  return new;
end;
$$;

revoke all on function public.assign_portal_state_client() from public;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'appropriateness_assessments',
    'strategy_selections',
    'risk_limit_selections',
    'exchange_key_events',
    'activation_events',
    'update_approvals',
    'audit_events',
    'position_interventions',
    'transaction_logs',
    'unprocessed_imports'
  ]
  loop
    continue when to_regclass(format('public.%I', v_table)) is null;
    execute format('drop trigger if exists assign_portal_state_client on public.%I', v_table);
    execute format(
      'create trigger assign_portal_state_client before insert or update on public.%I for each row execute function public.assign_portal_state_client()',
      v_table
    );
  end loop;
end;
$$;

-- Preserve compatibility while repositories still filter by client_name.
create or replace function public.cascade_client_name_snapshots()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text;
begin
  if new.client_name is not distinct from old.client_name then
    return new;
  end if;

  foreach v_table in array array[
    'appropriateness_assessments',
    'strategy_selections',
    'risk_limit_selections',
    'exchange_key_events',
    'activation_events',
    'update_approvals',
    'audit_events',
    'position_interventions',
    'transaction_logs',
    'unprocessed_imports',
    'positions'
  ]
  loop
    continue when to_regclass(format('public.%I', v_table)) is null;
    execute format(
      'update public.%I set client_name = $1 where client_id = $2 and client_name is distinct from $1',
      v_table
    ) using new.client_name, new.client_id;
  end loop;

  return new;
end;
$$;

revoke all on function public.cascade_client_name_snapshots() from public;
drop trigger if exists cascade_client_name_snapshots on public.clients;
create trigger cascade_client_name_snapshots
  after update of client_name on public.clients
  for each row execute function public.cascade_client_name_snapshots();

commit;
