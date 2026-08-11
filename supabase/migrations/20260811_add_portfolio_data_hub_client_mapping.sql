-- Portfolio Data Hub v1 account mapping and client-profile mutation boundary.
--
-- A portal account maps to at most one Hub account. The Hub account ID is nullable
-- during rollout so existing portal clients keep working until an administrator maps
-- them. Non-null IDs are globally unique, which prevents two portal accounts from
-- being connected to the same Hub account.
--
-- The previous clients UPDATE/DELETE policies only checked auth.role() =
-- 'authenticated'. They are removed here because an authenticated browser must not
-- be able to alter another client's Hub mapping (or any other client field).

begin;

alter table public.clients
  add column if not exists hub_account_id uuid,
  add column if not exists hub_account_label text,
  add column if not exists reporting_currency text,
  add column if not exists reporting_currency_source text,
  add column if not exists hub_account_mapped_at timestamptz;

-- Existing rows remain unmapped and have no reporting-currency provenance. New
-- assignments are constrained below; if a database was manually pre-populated with
-- duplicate values before this migration, fail rather than silently choosing an
-- account owner.
create unique index if not exists clients_hub_account_id_unique
  on public.clients (hub_account_id)
  where hub_account_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clients_reporting_currency_source_check'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_reporting_currency_source_check
      check (
        reporting_currency_source is null
        or reporting_currency_source in ('client', 'admin')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'clients_hub_mapping_fields_check'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_hub_mapping_fields_check
      check (
        (hub_account_id is not null or (hub_account_label is null and hub_account_mapped_at is null))
        and (hub_account_id is null or hub_account_mapped_at is not null)
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'clients_reporting_currency_fields_check'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_reporting_currency_fields_check
      check (
        (reporting_currency is null) = (reporting_currency_source is null)
        and (reporting_currency is null or reporting_currency ~ '^[A-Z0-9]{2,12}$')
      );
  end if;
end;
$$;

comment on column public.clients.hub_account_id is
  'The single Portfolio Data Hub account mapped to this portal account; unique when present.';
comment on column public.clients.hub_account_label is
  'Last administrator-confirmed human-readable label for the mapped Portfolio Data Hub account.';
comment on column public.clients.reporting_currency is
  'Account reporting currency selected by the client or an administrator; null means not configured.';
comment on column public.clients.reporting_currency_source is
  'Who last set reporting_currency: client or admin. Null when no reporting currency is configured.';
comment on column public.clients.hub_account_mapped_at is
  'When hub_account_id was last assigned or changed; null while no Hub account is mapped.';

-- RLS helpers read only trusted app_metadata. User metadata is self-service and
-- must never be used to grant admin or client-account authority. The UUID guard
-- makes a malformed token fail closed instead of raising during policy evaluation.
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

-- service_role is a server-held Supabase credential, not a browser role. It is
-- allowed only so future Vercel/server jobs can use the narrow admin RPCs below;
-- ordinary authenticated users still require app_metadata.role = 'admin'.
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

-- Keep provenance and mapping timestamps canonical even when an administrator uses
-- a direct SQL update. Client updates only happen via set_own_reporting_currency,
-- which has no authority to change any other clients column.
create or replace function public.enforce_clients_portfolio_data_hub_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.reporting_currency is not null then
    new.reporting_currency := upper(btrim(new.reporting_currency));
    if new.reporting_currency = ''
      or new.reporting_currency !~ '^[A-Z0-9]{2,12}$' then
      raise exception 'reporting currency must be a 2-12 character uppercase currency code'
        using errcode = '22023';
    end if;
  end if;

  if new.hub_account_id is null then
    new.hub_account_label := null;
    new.hub_account_mapped_at := null;
  elsif tg_op = 'INSERT'
    or new.hub_account_id is distinct from old.hub_account_id then
    new.hub_account_mapped_at := now();
  elsif new.hub_account_mapped_at is distinct from old.hub_account_mapped_at then
    -- Mapping time is derived from an ID assignment, never client-supplied.
    new.hub_account_mapped_at := old.hub_account_mapped_at;
  end if;

  if new.reporting_currency is null then
    new.reporting_currency_source := null;
  elsif tg_op = 'INSERT'
    or new.reporting_currency is distinct from old.reporting_currency then
    if helpers.is_admin() or helpers.is_service_role() then
      new.reporting_currency_source := 'admin';
    elsif new.client_id = helpers.current_client_id() then
      new.reporting_currency_source := 'client';
    else
      raise exception 'reporting currency may only be changed by an administrator or its assigned client'
        using errcode = '42501';
    end if;
  elsif new.reporting_currency_source is distinct from old.reporting_currency_source then
    -- A same-value selection still changes provenance (for example, an admin
    -- takes ownership of a client-selected USD setting). The caller may never
    -- choose the source value: this trigger derives it from trusted identity.
    if helpers.is_admin() or helpers.is_service_role() then
      new.reporting_currency_source := 'admin';
    elsif new.client_id = helpers.current_client_id() then
      new.reporting_currency_source := 'client';
    else
      raise exception 'reporting currency provenance may only be changed by an administrator or its assigned client'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists clients_enforce_portfolio_data_hub_fields on public.clients;
create trigger clients_enforce_portfolio_data_hub_fields
  before insert or update on public.clients
  for each row execute function public.enforce_clients_portfolio_data_hub_fields();

revoke all on function public.enforce_clients_portfolio_data_hub_fields() from public;

alter table public.clients enable row level security;

-- Replace *every* existing clients policy. RLS policies combine with OR, so merely
-- adding a safe policy beside an unknown/manual permissive one would be unsafe.
do $$
declare
  v_policy record;
begin
  for v_policy in
    select polname
    from pg_policy
    where polrelid = 'public.clients'::regclass
  loop
    execute format('drop policy %I on public.clients', v_policy.polname);
  end loop;
end;
$$;

-- These are the exact broad policies introduced by 20260325_clients_rls_update.
-- They have already been removed by the comprehensive reset above. No client
-- UPDATE policy is created: RLS predicates cannot limit an UPDATE to a particular
-- column, so a narrowly-scoped RPC is used below instead.
drop policy if exists "Authenticated users can update clients" on public.clients;
drop policy if exists "Authenticated users can delete clients" on public.clients;
drop policy if exists "clients_admin_only" on public.clients;

create policy "Admins manage clients"
  on public.clients
  for all
  using (helpers.is_admin())
  with check (helpers.is_admin());

-- Client reads are intentionally limited to the single portal account identified in
-- app_metadata.client_id. This permits a future server route to resolve its mapping
-- without exposing the other Hub accounts in the clients table.
create policy "Clients read own client profile"
  on public.clients
  for select
  using (client_id = helpers.current_client_id());

-- All persisted portal state belongs to the same account boundary. Older tables
-- carried only client_name and trusted editable user_metadata; retain client_name
-- for UI compatibility, but make client_id the authoritative ownership key. Rows
-- whose historical name has no matching clients row are intentionally preserved
-- with a null client_id and are readable only to an administrator until reconciled.
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
    execute format(
      'alter table public.%I add column if not exists client_id uuid',
      v_table
    );
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

    -- RLS policies combine with OR. Remove every existing policy, including any
    -- manual one, before adding the trusted-account policies below.
    for v_policy in execute format(
      'select polname from pg_policy where polrelid = %L::regclass',
      format('public.%I', v_table)
    )
    loop
      execute format('drop policy %I on public.%I', v_policy.polname, v_table);
    end loop;

    execute format(
      'create policy %I on public.%I for select using (client_id = helpers.current_client_id())',
      v_table || ' account members read own',
      v_table
    );
    execute format(
      'create policy %I on public.%I for insert with check (client_id = helpers.current_client_id())',
      v_table || ' account members insert own',
      v_table
    );
    execute format(
      'create policy %I on public.%I for select using (helpers.is_admin())',
      v_table || ' admins read all',
      v_table
    );
    -- Portal state is append-only. Administrators may add a corrective/account-
    -- scoped record but receive no UPDATE or DELETE policy from this migration.
    execute format(
      'create policy %I on public.%I for insert with check (helpers.is_admin())',
      v_table || ' admins insert',
      v_table
    );
  end loop;
end;
$$;

-- Import staging/log tables are mutable admin workspaces, not client-portal
-- surfaces. They still need account ownership so a name supplied by an import
-- cannot cross account boundaries. Their time key is created_at, not ts.
do $$
declare
  v_table text;
  v_policy record;
begin
  foreach v_table in array array['transaction_logs', 'unprocessed_imports']
  loop
    execute format('alter table public.%I add column if not exists client_id uuid', v_table);
    execute format(
      'update public.%I as state set client_id = client.client_id from public.clients as client where state.client_id is null and state.client_name = client.client_name',
      v_table
    );
    execute format(
      'create index if not exists %I on public.%I (client_id, created_at desc)',
      v_table || '_account_created_at_idx',
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
    -- No client policy is deliberate: these records support the admin import
    -- workflow and are not a client-portal API.
    execute format(
      'create policy %I on public.%I for all using (helpers.is_admin()) with check (helpers.is_admin())',
      v_table || ' admins manage imports',
      v_table
    );
  end loop;
end;
$$;

-- Make every child relationship explicit. RESTRICT means a stateful account is
-- deactivated instead of deleted; no historical state can become orphaned.
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
    execute format('alter table public.%I add column if not exists client_id uuid', v_table);
    execute format(
      'update public.%I as state set client_id = client.client_id from public.clients as client where state.client_id is null and state.client_name = client.client_name',
      v_table
    );
    execute format('alter table public.%I drop constraint if exists %I', v_table, v_table || '_client_id_fkey');
    execute format(
      'alter table public.%I add constraint %I foreign key (client_id) references public.clients(client_id) on delete restrict',
      v_table,
      v_table || '_client_id_fkey'
    );
  end loop;
end;
$$;

-- Core trade structures are account data too. Reset every existing policy before
-- creating the fail-closed policies below because PostgreSQL OR-combines policies.
-- Clients can read their own structures and related legs/fills, but receive no
-- direct mutation policy in this migration.
do $$
declare
  v_table text;
  v_policy record;
begin
  foreach v_table in array array['positions', 'legs', 'fills']
  loop
    execute format('alter table public.%I enable row level security', v_table);
    for v_policy in execute format(
      'select polname from pg_policy where polrelid = %L::regclass',
      format('public.%I', v_table)
    )
    loop
      execute format('drop policy %I on public.%I', v_policy.polname, v_table);
    end loop;
  end loop;
end;
$$;

create policy "Positions admins manage"
  on public.positions
  for all
  using (helpers.is_admin())
  with check (helpers.is_admin());

create policy "Positions account members read own"
  on public.positions
  for select
  using (client_id = helpers.current_client_id());

create policy "Legs admins manage"
  on public.legs
  for all
  using (helpers.is_admin())
  with check (helpers.is_admin());

create policy "Legs account members read own"
  on public.legs
  for select
  using (
    exists (
      select 1
      from public.positions as position
      where position.position_id = public.legs.position_id
        and position.client_id = helpers.current_client_id()
    )
  );

create policy "Fills admins manage"
  on public.fills
  for all
  using (helpers.is_admin())
  with check (helpers.is_admin());

create policy "Fills account members read own"
  on public.fills
  for select
  using (
    exists (
      select 1
      from public.positions as position
      where position.position_id = public.fills.position_id
        and position.client_id = helpers.current_client_id()
    )
  );

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

  -- A client-provided name is never an authorization input. The trigger rewrites
  -- it from the authoritative clients row, which keeps existing repositories that
  -- still send client_name backwards-compatible without cross-account writes.
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
    execute format('drop trigger if exists assign_portal_state_client on public.%I', v_table);
    execute format(
      'create trigger assign_portal_state_client before insert or update on public.%I for each row execute function public.assign_portal_state_client()',
      v_table
    );
  end loop;
end;
$$;

-- This function is the only client mutation path. Null explicitly clears an
-- existing selection; non-null values are normalized to uppercase and constrained
-- to a conservative currency-code shape (for example USD, USDC, BTC, or XAUT).
-- It never accepts a client ID, Hub account ID, label, or arbitrary column values.
create or replace function public.set_own_reporting_currency(
  p_reporting_currency text
)
returns table (
  client_id uuid,
  reporting_currency text,
  reporting_currency_source text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client_id uuid := helpers.current_client_id();
  v_reporting_currency text;
begin
  if auth.role() <> 'authenticated' or v_client_id is null then
    raise exception 'an authenticated user with app_metadata.client_id is required'
      using errcode = '42501';
  end if;

  if p_reporting_currency is not null then
    v_reporting_currency := upper(btrim(p_reporting_currency));
    if v_reporting_currency = ''
      or v_reporting_currency !~ '^[A-Z0-9]{2,12}$' then
      raise exception 'reporting currency must be a 2-12 character uppercase currency code'
        using errcode = '22023';
    end if;
  end if;

  update public.clients as c
  set reporting_currency = v_reporting_currency,
      reporting_currency_source = 'client'
  where c.client_id = v_client_id
  returning c.client_id, c.reporting_currency, c.reporting_currency_source
  into client_id, reporting_currency, reporting_currency_source;

  if not found then
    raise exception 'the assigned client account does not exist'
      using errcode = 'P0002';
  end if;

  return next;
end;
$$;

revoke all on function public.set_own_reporting_currency(text) from public;
grant execute on function public.set_own_reporting_currency(text) to authenticated;

comment on function public.set_own_reporting_currency(text) is
  'Narrow client RPC: updates only the caller app_metadata.client_id reporting currency and provenance.';

-- Server/admin paths are also narrow so a future Vercel service-role backend need
-- not issue broad table updates. service_role is accepted only for server-held
-- credentials; browser users need trusted app_metadata.role = 'admin'.
create or replace function public.admin_set_client_reporting_currency(
  p_client_id uuid,
  p_reporting_currency text
)
returns table (
  client_id uuid,
  reporting_currency text,
  reporting_currency_source text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reporting_currency text;
begin
  if not (helpers.is_admin() or helpers.is_service_role()) then
    raise exception 'administrator privileges are required'
      using errcode = '42501';
  end if;

  if p_client_id is null then
    raise exception 'client id is required' using errcode = '22023';
  end if;

  if p_reporting_currency is not null then
    v_reporting_currency := upper(btrim(p_reporting_currency));
    if v_reporting_currency = ''
      or v_reporting_currency !~ '^[A-Z0-9]{2,12}$' then
      raise exception 'reporting currency must be a 2-12 character uppercase currency code'
        using errcode = '22023';
    end if;
  end if;

  update public.clients as c
  set reporting_currency = v_reporting_currency,
      reporting_currency_source = 'admin'
  where c.client_id = p_client_id
  returning c.client_id, c.reporting_currency, c.reporting_currency_source
  into client_id, reporting_currency, reporting_currency_source;

  if not found then
    raise exception 'client account does not exist' using errcode = 'P0002';
  end if;

  return next;
end;
$$;

create or replace function public.admin_set_client_hub_account_mapping(
  p_client_id uuid,
  p_hub_account_id uuid,
  p_hub_account_label text default null
)
returns table (
  client_id uuid,
  hub_account_id uuid,
  hub_account_label text,
  hub_account_mapped_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hub_account_label text := nullif(btrim(p_hub_account_label), '');
begin
  if not (helpers.is_admin() or helpers.is_service_role()) then
    raise exception 'administrator privileges are required'
      using errcode = '42501';
  end if;

  if p_client_id is null then
    raise exception 'client id is required' using errcode = '22023';
  end if;

  if p_hub_account_id is null then
    v_hub_account_label := null;
  end if;

  update public.clients as c
  set hub_account_id = p_hub_account_id,
      hub_account_label = v_hub_account_label
  where c.client_id = p_client_id
  returning c.client_id, c.hub_account_id, c.hub_account_label, c.hub_account_mapped_at
  into client_id, hub_account_id, hub_account_label, hub_account_mapped_at;

  if not found then
    raise exception 'client account does not exist' using errcode = 'P0002';
  end if;

  return next;
end;
$$;

revoke all on function public.admin_set_client_reporting_currency(uuid, text) from public;
revoke all on function public.admin_set_client_hub_account_mapping(uuid, uuid, text) from public;
grant execute on function public.admin_set_client_reporting_currency(uuid, text) to authenticated, service_role;
grant execute on function public.admin_set_client_hub_account_mapping(uuid, uuid, text) to authenticated, service_role;

comment on function public.admin_set_client_reporting_currency(uuid, text) is
  'Narrow admin/server RPC that sets one account reporting currency and database-managed provenance.';
comment on function public.admin_set_client_hub_account_mapping(uuid, uuid, text) is
  'Narrow admin/server RPC that assigns or clears one account Portfolio Data Hub mapping.';

-- Immutable, reconstructable history for account configuration. Values intentionally
-- contain only Hub account identifiers/labels and reporting currency metadata; API
-- keys and other secrets are never accepted by these functions or stored here.
create table if not exists public.client_account_config_audit (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(client_id) on delete restrict,
  actor_id    uuid,
  actor_role  text not null check (actor_role in ('client', 'admin', 'service_role')),
  event_type  text not null check (event_type in ('hub_account_mapping', 'reporting_currency')),
  old_value   jsonb not null,
  new_value   jsonb not null,
  ts          timestamptz not null default now()
);

create index if not exists client_account_config_audit_client_ts_idx
  on public.client_account_config_audit (client_id, ts desc);

alter table public.client_account_config_audit enable row level security;

do $$
declare
  v_policy record;
begin
  for v_policy in
    select polname
    from pg_policy
    where polrelid = 'public.client_account_config_audit'::regclass
  loop
    execute format('drop policy %I on public.client_account_config_audit', v_policy.polname);
  end loop;
end;
$$;

create policy "Account config audit members read own"
  on public.client_account_config_audit
  for select
  using (client_id = helpers.current_client_id());

create policy "Account config audit admins read all"
  on public.client_account_config_audit
  for select
  using (helpers.is_admin());

create or replace function public.audit_client_account_config_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role text := case
    when helpers.is_admin() then 'admin'
    when helpers.is_service_role() then 'service_role'
    else 'client'
  end;
begin
  -- OLD is unassigned for INSERT triggers. Keep the branches separate rather
  -- than relying on boolean short-circuiting so an ordinary unmapped client
  -- insert is always valid and configured inserts still receive history.
  if tg_op = 'INSERT' then
    if new.hub_account_id is not null or new.hub_account_label is not null then
      insert into public.client_account_config_audit (
        client_id, actor_id, actor_role, event_type, old_value, new_value
      ) values (
        new.client_id,
        auth.uid(),
        v_actor_role,
        'hub_account_mapping',
        jsonb_build_object(
          'hub_account_id', null,
          'hub_account_label', null,
          'hub_account_mapped_at', null
        ),
        jsonb_build_object(
          'hub_account_id', new.hub_account_id,
          'hub_account_label', new.hub_account_label,
          'hub_account_mapped_at', new.hub_account_mapped_at
        )
      );
    end if;

    if new.reporting_currency is not null then
      insert into public.client_account_config_audit (
        client_id, actor_id, actor_role, event_type, old_value, new_value
      ) values (
        new.client_id,
        auth.uid(),
        v_actor_role,
        'reporting_currency',
        jsonb_build_object(
          'reporting_currency', null,
          'reporting_currency_source', null
        ),
        jsonb_build_object(
          'reporting_currency', new.reporting_currency,
          'reporting_currency_source', new.reporting_currency_source
        )
      );
    end if;
  else
    if new.hub_account_id is distinct from old.hub_account_id
      or new.hub_account_label is distinct from old.hub_account_label then
      insert into public.client_account_config_audit (
        client_id, actor_id, actor_role, event_type, old_value, new_value
      ) values (
        new.client_id,
        auth.uid(),
        v_actor_role,
        'hub_account_mapping',
        jsonb_build_object(
          'hub_account_id', old.hub_account_id,
          'hub_account_label', old.hub_account_label,
          'hub_account_mapped_at', old.hub_account_mapped_at
        ),
        jsonb_build_object(
          'hub_account_id', new.hub_account_id,
          'hub_account_label', new.hub_account_label,
          'hub_account_mapped_at', new.hub_account_mapped_at
        )
      );
    end if;

    if new.reporting_currency is distinct from old.reporting_currency
      or new.reporting_currency_source is distinct from old.reporting_currency_source then
      insert into public.client_account_config_audit (
        client_id, actor_id, actor_role, event_type, old_value, new_value
      ) values (
        new.client_id,
        auth.uid(),
        v_actor_role,
        'reporting_currency',
        jsonb_build_object(
          'reporting_currency', old.reporting_currency,
          'reporting_currency_source', old.reporting_currency_source
        ),
        jsonb_build_object(
          'reporting_currency', new.reporting_currency,
          'reporting_currency_source', new.reporting_currency_source
        )
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.audit_client_account_config_change() from public;

drop trigger if exists audit_client_account_config_change on public.clients;
create trigger audit_client_account_config_change
  after insert or update of hub_account_id, hub_account_label, reporting_currency, reporting_currency_source
  on public.clients
  for each row execute function public.audit_client_account_config_change();

-- client_name remains a compatibility snapshot while this repository still has
-- legacy .eq('client_name', ...) queries. A rename by an administrator updates
-- every snapshot through its authoritative client_id; it never changes ownership.
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
