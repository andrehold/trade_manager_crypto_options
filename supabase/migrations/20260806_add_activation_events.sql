-- Append-only client software activation/deactivation events. Current state = the latest row's action.
-- Same per-client RLS + admin-read pattern.
create table if not exists public.activation_events (
  id          uuid primary key default gen_random_uuid(),
  client_name text not null,
  created_by  uuid default auth.uid(),
  action      text not null check (action in ('activate','deactivate')),
  ts          timestamptz not null default now()
);

create index if not exists activation_events_client_idx
  on public.activation_events (client_name);
create index if not exists activation_events_client_ts_idx
  on public.activation_events (client_name, ts);

alter table public.activation_events enable row level security;

create policy "Clients read own activation events"
  on public.activation_events for select
  using (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Clients insert own activation events"
  on public.activation_events for insert
  with check (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Admins read all activation events"
  on public.activation_events for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
