-- Add account reporting-currency selection independently of Hub connectivity.
-- Values are configuration only; portfolio conversion remains application work.

begin;

alter table public.clients
  add column if not exists reporting_currency text,
  add column if not exists reporting_currency_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
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
    select 1 from pg_constraint
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

comment on column public.clients.reporting_currency is
  'Account reporting currency selected by the client or an administrator.';
comment on column public.clients.reporting_currency_source is
  'Who last set reporting_currency: client or admin; null when unset.';

create or replace function public.enforce_client_reporting_currency_fields()
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

  if new.reporting_currency is null then
    new.reporting_currency_source := null;
  elsif tg_op = 'INSERT'
    or new.reporting_currency is distinct from old.reporting_currency
    or new.reporting_currency_source is distinct from old.reporting_currency_source then
    if helpers.is_admin() or helpers.is_service_role() then
      new.reporting_currency_source := 'admin';
    elsif new.client_id = helpers.current_client_id() then
      new.reporting_currency_source := 'client';
    else
      raise exception 'reporting currency may only be changed by an administrator or its assigned client'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_client_reporting_currency_fields() from public;
drop trigger if exists clients_enforce_reporting_currency_fields on public.clients;
create trigger clients_enforce_reporting_currency_fields
  before insert or update on public.clients
  for each row execute function public.enforce_client_reporting_currency_fields();

create or replace function public.set_own_reporting_currency(p_reporting_currency text)
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

revoke all on function public.admin_set_client_reporting_currency(uuid, text) from public;
grant execute on function public.admin_set_client_reporting_currency(uuid, text)
  to authenticated, service_role;

-- Extend the audit table created by the Hub-mapping migration.
alter table public.client_account_config_audit
  drop constraint if exists client_account_config_audit_event_type_check;
alter table public.client_account_config_audit
  add constraint client_account_config_audit_event_type_check
  check (event_type in ('hub_account_mapping', 'reporting_currency'));

create or replace function public.audit_client_reporting_currency_change()
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
    if new.reporting_currency is null then
      return new;
    end if;
    insert into public.client_account_config_audit (
      client_id, actor_id, actor_role, event_type, old_value, new_value
    ) values (
      new.client_id, auth.uid(), v_actor_role, 'reporting_currency',
      jsonb_build_object('reporting_currency', null, 'reporting_currency_source', null),
      jsonb_build_object(
        'reporting_currency', new.reporting_currency,
        'reporting_currency_source', new.reporting_currency_source
      )
    );
  elsif new.reporting_currency is distinct from old.reporting_currency
    or new.reporting_currency_source is distinct from old.reporting_currency_source then
    insert into public.client_account_config_audit (
      client_id, actor_id, actor_role, event_type, old_value, new_value
    ) values (
      new.client_id, auth.uid(), v_actor_role, 'reporting_currency',
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

  return new;
end;
$$;

revoke all on function public.audit_client_reporting_currency_change() from public;
drop trigger if exists audit_client_reporting_currency_change on public.clients;
create trigger audit_client_reporting_currency_change
  after insert or update of reporting_currency, reporting_currency_source on public.clients
  for each row execute function public.audit_client_reporting_currency_change();

commit;
