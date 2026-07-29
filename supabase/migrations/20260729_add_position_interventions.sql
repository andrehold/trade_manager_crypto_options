-- Records client interventions on a position, from either the portal ('platform')
-- or a change made directly on the exchange that the system later detects ('venue').
-- Admin-vs-client access is enforced in the application layer (isAdmin flag), matching
-- the convention in 20260325_clients_rls_update.sql.
create table if not exists public.position_interventions (
  id          uuid primary key default gen_random_uuid(),
  position_id text not null,
  client_name text,
  source      text not null check (source in ('platform', 'venue')),
  action      text not null check (action in ('open', 'modify', 'close')),
  detail      text,
  created_by  uuid,
  ts          timestamptz not null default now()
);

create index if not exists position_interventions_position_idx
  on public.position_interventions (position_id);

create index if not exists position_interventions_client_idx
  on public.position_interventions (client_name);

create index if not exists position_interventions_ts_idx
  on public.position_interventions (ts desc);

alter table public.position_interventions enable row level security;

create policy "Authenticated users can read interventions"
  on public.position_interventions
  for select
  using (auth.role() = 'authenticated');

create policy "Authenticated users can insert interventions"
  on public.position_interventions
  for insert
  with check (auth.role() = 'authenticated');
