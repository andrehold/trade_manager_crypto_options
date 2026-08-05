-- Append-only client software-update approvals. The set of approved versions is read on load to restore
-- the "installed" state of pending updates. Same per-client RLS + admin-read pattern.
create table if not exists public.update_approvals (
  id          uuid primary key default gen_random_uuid(),
  client_name text not null,
  created_by  uuid default auth.uid(),
  version     text not null,
  ts          timestamptz not null default now()
);

create index if not exists update_approvals_client_idx
  on public.update_approvals (client_name);
create index if not exists update_approvals_client_ts_idx
  on public.update_approvals (client_name, ts);

alter table public.update_approvals enable row level security;

create policy "Clients read own update approvals"
  on public.update_approvals for select
  using (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Clients insert own update approvals"
  on public.update_approvals for insert
  with check (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Admins read all update approvals"
  on public.update_approvals for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
