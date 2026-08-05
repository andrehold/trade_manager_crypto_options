-- Append-only client exchange-key lifecycle events (add / revoke). NEVER stores an API secret —
-- only non-authenticating metadata the client chooses to record. Same per-client RLS + admin-read pattern.
create table if not exists public.exchange_key_events (
  id            uuid primary key default gen_random_uuid(),
  client_name   text not null,
  created_by    uuid default auth.uid(),
  key_ref       uuid not null,
  action        text not null check (action in ('add','revoke')),
  venue         text,
  label         text,
  fingerprint   text,
  scopes        text default 'trade,read',
  no_withdrawal boolean,
  ts            timestamptz not null default now()
);

create index if not exists exchange_key_events_client_idx
  on public.exchange_key_events (client_name);
create index if not exists exchange_key_events_client_ts_idx
  on public.exchange_key_events (client_name, ts);

alter table public.exchange_key_events enable row level security;

create policy "Clients read own exchange key events"
  on public.exchange_key_events for select
  using (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Clients insert own exchange key events"
  on public.exchange_key_events for insert
  with check (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Admins read all exchange key events"
  on public.exchange_key_events for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
