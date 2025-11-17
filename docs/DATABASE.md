# Database Notes

This project keeps the core import payload intentionally lean while relying on PostgreSQL (Supabase) for referential integrity. The
`supabase/migrations/20240519_add_strategy_tables.sql` migration introduces the pieces recommended in the design review:

- **`strategies`** — catalog table keyed by `strategy_code` so shared definitions live once.
- **`program_strategies`** — associative table that links strategies to programs (room for effective-dating when needed).
- **`positions.strategy_name_at_entry`** — snapshot column to persist the human-readable label even if the catalog name changes later.
- **`positions_options_structure_chk`** — CHECK constraint that mirrors the enum defined in `src/lib/import/types.ts` to prevent drift.

Apply the migration through the Supabase SQL editor or CLI (for example `supabase db execute --file supabase/migrations/20240519_add_strategy_tables.sql`).

After running it, the import flows in `api/import/route.ts` and `src/lib/import/trades.ts` will automatically populate the new catalog/linkage tables during every import.

## Client-aware row-level security

With the UI now scoping every operation to either the selected client (admin) or the caller's assigned client (non-admin), Supabase only needs a few schema additions plus RLS policies to enforce the same rules server-side.

1. **Normalize client metadata** so `positions` can reference a canonical `clients` table while still keeping the `client_name` snapshot that the UI expects today.

```sql
create table if not exists public.clients (
  client_id uuid primary key default gen_random_uuid(),
  client_name text not null unique,
  created_at timestamptz not null default now()
);

alter table public.positions
  add column if not exists client_id uuid references public.clients(client_id);

insert into public.clients (client_name)
select distinct client_name from public.positions
where client_name is not null
on conflict (client_name) do nothing;

update public.positions p
set client_id = c.client_id
from public.clients c
where p.client_id is null and c.client_name = p.client_name;

alter table public.positions
  alter column client_id set not null;

create index if not exists positions_client_id_idx on public.positions (client_id);
```

2. **Expose helper functions** so RLS predicates can simply call `auth.current_client_id()` and `auth.is_admin()`.

```sql
create or replace function auth.current_client_id() returns uuid as $$
  select nullif(auth.jwt()->>'client_id', '')::uuid;
$$ language sql stable;

create or replace function auth.is_admin() returns boolean as $$
  select coalesce(auth.jwt()->>'role', '') = 'admin';
$$ language sql stable;
```

3. **Enable RLS** on every table that exposes customer data.

```sql
alter table public.clients enable row level security;
create policy "clients_admin_only" on public.clients
  for all using (auth.is_admin()) with check (auth.is_admin());

alter table public.positions enable row level security;
create policy "positions_admin_full" on public.positions
  for all using (auth.is_admin()) with check (auth.is_admin());
create policy "positions_by_client" on public.positions
  for select using (client_id = auth.current_client_id())
  with check (client_id = auth.current_client_id());

alter table public.legs enable row level security;
create policy "legs_admin_full" on public.legs
  for all using (auth.is_admin()) with check (auth.is_admin());
create policy "legs_by_client" on public.legs
  for select using (
    exists (
      select 1 from public.positions p
      where p.position_id = public.legs.position_id
        and (auth.is_admin() or p.client_id = auth.current_client_id())
    )
  )
  with check (
    exists (
      select 1 from public.positions p
      where p.position_id = public.legs.position_id
        and (auth.is_admin() or p.client_id = auth.current_client_id())
    )
  );

alter table public.fills enable row level security;
create policy "fills_admin_full" on public.fills
  for all using (auth.is_admin()) with check (auth.is_admin());
create policy "fills_by_client" on public.fills
  for select using (
    exists (
      select 1 from public.positions p
      where p.position_id = public.fills.position_id
        and (auth.is_admin() or p.client_id = auth.current_client_id())
    )
  )
  with check (
    exists (
      select 1 from public.positions p
      where p.position_id = public.fills.position_id
        and (auth.is_admin() or p.client_id = auth.current_client_id())
    )
  );
```

4. **Populate JWT claims** so Supabase can evaluate the policies. Each admin should have either the `role = 'admin'` claim or be listed in the `VITE_SUPABASE_ADMIN_EMAILS` allowlist, and every client user needs a `client_id` claim that matches a row in `public.clients`. Update `auth.users.raw_app_meta_data` through the dashboard or SQL:

```sql
update auth.users
set raw_app_meta_data = raw_app_meta_data || jsonb_build_object(
  'role', 'admin',
  'client_id', '00000000-0000-0000-0000-000000000000'
)
where email = 'you@example.com';
```

Once the claims are in place, non-admin users automatically see only their own structures, legs, and fills, while admins retain full access (matching the client selection UX in `DashboardApp`).
