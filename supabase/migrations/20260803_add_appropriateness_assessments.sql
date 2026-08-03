-- Append-only client appropriateness self-assessments. Per-client RLS: a client can
-- read/insert only their own rows (scoped by client_name from their JWT user_metadata);
-- an admin (app_metadata.role = 'admin') can read all. created_by auto-fills from auth.uid().
create table if not exists public.appropriateness_assessments (
  id           uuid primary key default gen_random_uuid(),
  client_name  text not null,
  created_by   uuid default auth.uid(),
  answers      jsonb,
  attestations jsonb,
  signed_name  text,
  valid_until  timestamptz,
  ts           timestamptz not null default now()
);

create index if not exists appropriateness_client_idx
  on public.appropriateness_assessments (client_name);
create index if not exists appropriateness_client_ts_idx
  on public.appropriateness_assessments (client_name, ts desc);

alter table public.appropriateness_assessments enable row level security;

create policy "Clients read own appropriateness"
  on public.appropriateness_assessments for select
  using (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Clients insert own appropriateness"
  on public.appropriateness_assessments for insert
  with check (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Admins read all appropriateness"
  on public.appropriateness_assessments for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
