-- Minimal, idempotent portal baseline for the local Slice 2 acceptance database.
-- This is deliberately limited to trade_management_desk_dev. It creates missing
-- tables only and never drops or truncates persistent development data.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end;
$$;

grant authenticated to portfolio_data_hub;
grant service_role to portfolio_data_hub;

create schema if not exists auth;

-- Supabase-compatible claim shims for plain PostgreSQL. The acceptance SQL sets
-- request.jwt.claims and SET ROLE authenticated to simulate browser requests.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'role', current_user::text);
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select case
    when coalesce(auth.jwt() ->> 'sub', '')
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (auth.jwt() ->> 'sub')::uuid
    else null
  end;
$$;

-- Assertion arguments are evaluated by the calling role before this
-- security-invoker helper runs, so table predicates continue to exercise RLS.
create or replace function public._slice2_assert(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if p_condition is not true then
    raise exception 'Slice 2 acceptance failure: %', p_message;
  end if;
end;
$$;

create table if not exists public.clients (
  client_id uuid primary key default gen_random_uuid(),
  client_name text not null unique,
  created_at timestamptz not null default now(),
  status text not null default 'active'
);

create table if not exists public.positions (
  position_id text primary key,
  client_name text,
  client_id uuid
);

create table if not exists public.legs (
  id uuid primary key default gen_random_uuid(),
  position_id text not null
);

create table if not exists public.fills (
  id uuid primary key default gen_random_uuid(),
  position_id text not null
);

create table if not exists public.appropriateness_assessments (
  id uuid primary key default gen_random_uuid(), client_name text, ts timestamptz not null default now()
);
create table if not exists public.strategy_selections (
  id uuid primary key default gen_random_uuid(), client_name text, ts timestamptz not null default now()
);
create table if not exists public.risk_limit_selections (
  id uuid primary key default gen_random_uuid(), client_name text, ts timestamptz not null default now()
);
create table if not exists public.exchange_key_events (
  id uuid primary key default gen_random_uuid(), client_name text, ts timestamptz not null default now()
);
create table if not exists public.activation_events (
  id uuid primary key default gen_random_uuid(), client_name text, ts timestamptz not null default now()
);
create table if not exists public.update_approvals (
  id uuid primary key default gen_random_uuid(), client_name text, ts timestamptz not null default now()
);
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(), client_name text, ts timestamptz not null default now()
);
create table if not exists public.position_interventions (
  id uuid primary key default gen_random_uuid(), client_name text, ts timestamptz not null default now()
);
create table if not exists public.transaction_logs (
  id uuid primary key default gen_random_uuid(), client_name text, created_at timestamptz not null default now()
);
create table if not exists public.unprocessed_imports (
  id uuid primary key default gen_random_uuid(), client_name text, created_at timestamptz not null default now()
);

create table if not exists public._slice2_acceptance_harness (
  key text primary key,
  value text,
  created_at timestamptz not null default now()
);
alter table public._slice2_acceptance_harness
  add column if not exists value text;

-- Seed one intentionally unresolved historical row before the real migration. It
-- must remain client-inaccessible and admin-visible after client_id backfill.
insert into public.audit_events (id, client_name)
select 'f0000000-0000-4000-8000-000000000001', 'Unresolved legacy account'
where not exists (
  select 1 from public._slice2_acceptance_harness where key = 'legacy-row-seeded'
);

insert into public._slice2_acceptance_harness (key)
values ('legacy-row-seeded')
on conflict do nothing;

grant usage on schema public, auth to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function auth.jwt(), auth.role(), auth.uid() to authenticated;
grant execute on function public._slice2_assert(boolean, text) to authenticated;
