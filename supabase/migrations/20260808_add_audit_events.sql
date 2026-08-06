-- Append-only client audit log. Every client/system action is recorded as one immutable row.
-- type/actor stored as free text (the UI tolerates unknown types via a colour fallback). Same
-- per-client RLS + admin-read pattern.
create table if not exists public.audit_events (
  id          uuid primary key default gen_random_uuid(),
  client_name text not null,
  created_by  uuid default auth.uid(),
  type        text not null,
  detail      text not null,
  actor       text not null,
  ts          timestamptz not null default now()
);

create index if not exists audit_events_client_idx
  on public.audit_events (client_name);
create index if not exists audit_events_client_ts_idx
  on public.audit_events (client_name, ts);

alter table public.audit_events enable row level security;

create policy "Clients read own audit events"
  on public.audit_events for select
  using (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Clients insert own audit events"
  on public.audit_events for insert
  with check (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Admins read all audit events"
  on public.audit_events for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
