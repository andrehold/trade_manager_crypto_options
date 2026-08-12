-- Connect each portal client account to at most one Portfolio Data Hub account.
-- Hub datasets remain in the Hub; the portal stores only this routing identity.

begin;

alter table public.clients
  add column if not exists hub_account_id uuid,
  add column if not exists hub_account_label text,
  add column if not exists hub_account_mapped_at timestamptz;

create unique index if not exists clients_hub_account_id_unique
  on public.clients (hub_account_id)
  where hub_account_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
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
end;
$$;

comment on column public.clients.hub_account_id is
  'The single Portfolio Data Hub account mapped to this portal account; unique when present.';
comment on column public.clients.hub_account_label is
  'Last administrator-confirmed label for the mapped Portfolio Data Hub account.';
comment on column public.clients.hub_account_mapped_at is
  'When hub_account_id was last assigned or changed; null while unmapped.';

-- Local development may previously have applied the superseded combined
-- migration. Remove its mixed-concern triggers before installing the split ones.
drop trigger if exists clients_enforce_portfolio_data_hub_fields on public.clients;
drop function if exists public.enforce_clients_portfolio_data_hub_fields();
drop trigger if exists audit_client_account_config_change on public.clients;
drop function if exists public.audit_client_account_config_change();

create or replace function public.enforce_client_hub_mapping_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.hub_account_id is null then
    new.hub_account_label := null;
    new.hub_account_mapped_at := null;
  elsif tg_op = 'INSERT'
    or new.hub_account_id is distinct from old.hub_account_id then
    new.hub_account_mapped_at := now();
  elsif new.hub_account_mapped_at is distinct from old.hub_account_mapped_at then
    new.hub_account_mapped_at := old.hub_account_mapped_at;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_client_hub_mapping_fields() from public;
drop trigger if exists clients_enforce_hub_mapping_fields on public.clients;
create trigger clients_enforce_hub_mapping_fields
  before insert or update on public.clients
  for each row execute function public.enforce_client_hub_mapping_fields();

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

revoke all on function public.admin_set_client_hub_account_mapping(uuid, uuid, text) from public;
grant execute on function public.admin_set_client_hub_account_mapping(uuid, uuid, text)
  to authenticated, service_role;

-- Durable account-configuration history starts with Hub mapping events. The
-- reporting-currency migration extends the event-type constraint later.
create table if not exists public.client_account_config_audit (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(client_id) on delete restrict,
  actor_id    uuid,
  actor_role  text not null,
  event_type  text not null,
  old_value   jsonb not null,
  new_value   jsonb not null,
  ts          timestamptz not null default now(),
  constraint client_account_config_audit_actor_role_check
    check (actor_role in ('client', 'admin', 'service_role')),
  constraint client_account_config_audit_event_type_check
    check (event_type in ('hub_account_mapping'))
);

create index if not exists client_account_config_audit_client_ts_idx
  on public.client_account_config_audit (client_id, ts desc);

alter table public.client_account_config_audit enable row level security;

do $$
declare
  v_policy record;
begin
  for v_policy in
    select polname from pg_policy
    where polrelid = 'public.client_account_config_audit'::regclass
  loop
    execute format('drop policy %I on public.client_account_config_audit', v_policy.polname);
  end loop;
end;
$$;

create policy "Account config audit members read own"
  on public.client_account_config_audit
  for select using (client_id = helpers.current_client_id());
create policy "Account config audit admins read all"
  on public.client_account_config_audit
  for select using (helpers.is_admin());

create or replace function public.audit_client_hub_mapping_change()
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
  if tg_op = 'INSERT' then
    if new.hub_account_id is null and new.hub_account_label is null then
      return new;
    end if;
    insert into public.client_account_config_audit (
      client_id, actor_id, actor_role, event_type, old_value, new_value
    ) values (
      new.client_id, auth.uid(), v_actor_role, 'hub_account_mapping',
      jsonb_build_object('hub_account_id', null, 'hub_account_label', null, 'hub_account_mapped_at', null),
      jsonb_build_object(
        'hub_account_id', new.hub_account_id,
        'hub_account_label', new.hub_account_label,
        'hub_account_mapped_at', new.hub_account_mapped_at
      )
    );
  elsif new.hub_account_id is distinct from old.hub_account_id
    or new.hub_account_label is distinct from old.hub_account_label then
    insert into public.client_account_config_audit (
      client_id, actor_id, actor_role, event_type, old_value, new_value
    ) values (
      new.client_id, auth.uid(), v_actor_role, 'hub_account_mapping',
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

  return new;
end;
$$;

revoke all on function public.audit_client_hub_mapping_change() from public;
drop trigger if exists audit_client_hub_mapping_change on public.clients;
create trigger audit_client_hub_mapping_change
  after insert or update of hub_account_id, hub_account_label on public.clients
  for each row execute function public.audit_client_hub_mapping_change();

commit;
