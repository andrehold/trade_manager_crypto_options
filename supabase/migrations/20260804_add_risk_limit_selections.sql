-- Append-only client risk/greek limit snapshots. Same per-client RLS + admin-read pattern.
create table if not exists public.risk_limit_selections (
  id          uuid primary key default gen_random_uuid(),
  client_name text not null,
  created_by  uuid default auth.uid(),
  limits      jsonb not null,
  ts          timestamptz not null default now()
);

create index if not exists risk_limit_selections_client_idx
  on public.risk_limit_selections (client_name);
create index if not exists risk_limit_selections_client_ts_idx
  on public.risk_limit_selections (client_name, ts desc);

alter table public.risk_limit_selections enable row level security;

create policy "Clients read own risk limits"
  on public.risk_limit_selections for select
  using (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Clients insert own risk limits"
  on public.risk_limit_selections for insert
  with check (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Admins read all risk limits"
  on public.risk_limit_selections for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
