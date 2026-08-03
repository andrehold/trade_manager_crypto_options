-- Append-only client strategy-module selections. Same per-client RLS + admin-read pattern.
create table if not exists public.strategy_selections (
  id          uuid primary key default gen_random_uuid(),
  client_name text not null,
  created_by  uuid default auth.uid(),
  module      text not null,
  ts          timestamptz not null default now()
);

create index if not exists strategy_selections_client_idx
  on public.strategy_selections (client_name);
create index if not exists strategy_selections_client_ts_idx
  on public.strategy_selections (client_name, ts desc);

alter table public.strategy_selections enable row level security;

create policy "Clients read own strategy selection"
  on public.strategy_selections for select
  using (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Clients insert own strategy selection"
  on public.strategy_selections for insert
  with check (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Admins read all strategy selections"
  on public.strategy_selections for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
