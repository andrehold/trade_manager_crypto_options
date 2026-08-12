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
  add column if not exists client_name text,
  add column if not exists client_id uuid references public.clients(client_id);

insert into public.clients (client_name)
select distinct p.client_name from public.positions p
where p.client_name is not null
on conflict (client_name) do nothing;

update public.positions p
set client_id = c.client_id
from public.clients c
where p.client_id is null and c.client_name = p.client_name;

alter table public.positions
  alter column client_id set not null;

create index if not exists positions_client_id_idx on public.positions (client_id);
```

2. **Expose helper functions** in a writable schema so RLS predicates can simply call `helpers.current_client_id()` and `helpers.is_admin()`. Both claims must come from trusted `app_metadata`, never editable `user_metadata`.

```sql
create schema if not exists helpers authorization current_user;
revoke all on schema helpers from public;
grant usage on schema helpers to authenticated;

create or replace function helpers.current_client_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select case
    when coalesce(auth.jwt() -> 'app_metadata' ->> 'client_id', '')
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (auth.jwt() -> 'app_metadata' ->> 'client_id')::uuid
    else null
  end;
$$;

create or replace function helpers.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.role() = 'authenticated'
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

revoke execute on function helpers.current_client_id() from public;
revoke execute on function helpers.is_admin() from public;
grant execute on function helpers.current_client_id() to authenticated;
grant execute on function helpers.is_admin() to authenticated;
```

3. **Enable RLS** on every table that exposes customer data.

```sql
alter table public.clients enable row level security;
create policy "clients_admin_only" on public.clients
  for all using (helpers.is_admin()) with check (helpers.is_admin());

-- 20260812090000_account_identity_rls_hardening.sql applies these policies
-- after removing every pre-existing policy on each table. SELECT policies never
-- have WITH CHECK: PostgreSQL permits WITH CHECK only for INSERT/UPDATE/ALL.
alter table public.positions enable row level security;
create policy "Positions admins manage" on public.positions
  for all using (helpers.is_admin()) with check (helpers.is_admin());
create policy "Positions account members read own" on public.positions
  for select using (client_id = helpers.current_client_id());

alter table public.legs enable row level security;
create policy "Legs admins manage" on public.legs
  for all using (helpers.is_admin()) with check (helpers.is_admin());
create policy "Legs account members read own" on public.legs
  for select using (
    exists (
      select 1 from public.positions p
      where p.position_id = public.legs.position_id
        and p.client_id = helpers.current_client_id()
    )
  );

alter table public.fills enable row level security;
create policy "Fills admins manage" on public.fills
  for all using (helpers.is_admin()) with check (helpers.is_admin());
create policy "Fills account members read own" on public.fills
  for select using (
    exists (
      select 1 from public.positions p
      where p.position_id = public.fills.position_id
        and p.client_id = helpers.current_client_id()
    )
  );
```

4. **Populate JWT claims** so Supabase can evaluate the policies. Every database admin must have `app_metadata.role = 'admin'`, and every client user needs an `app_metadata.client_id` that matches a row in `public.clients`. The browser-only `VITE_SUPABASE_ADMIN_EMAILS` allowlist does not grant database access. Update `auth.users.raw_app_meta_data` through the dashboard or SQL:

```sql
update auth.users
set raw_app_meta_data = raw_app_meta_data || jsonb_build_object(
  'role', 'admin',
  'client_id', '00000000-0000-0000-0000-000000000000'
)
where email = 'you@example.com';
```

Once the claims are in place, non-admin users automatically see only their own structures, legs, and fills, while admins retain full access (matching the client selection UX in `DashboardApp`).

## Portfolio Data Hub account mappings

The database work is deliberately separated into three ordered migrations:

1. `20260812090000_account_identity_rls_hardening.sql` establishes the trusted
   `client_id` authorization boundary for existing portal data.
2. `20260812091000_portfolio_data_hub_mapping.sql` connects one portal account to
   at most one Hub account. It stores routing/configuration only; Hub summaries,
   positions, and ledger data remain in the Hub and are fetched through its API.
3. `20260812092000_reporting_currency_configuration.sql` adds the independent
   reporting-currency preference and its audit trail.

The account-identity migration removes the historical policy that let any
authenticated user update or delete any `clients` row. It replaces it with:

- Admin-only direct client mutations, authenticated exclusively by
  `app_metadata.role = 'admin'`.
- A client read policy restricted to `app_metadata.client_id`.

It also hardens all existing portal state tables (`appropriateness_assessments`,
`strategy_selections`, `risk_limit_selections`, `exchange_key_events`,
`activation_events`, `update_approvals`, `audit_events`, and
`position_interventions`). Each receives an authoritative nullable `client_id`
foreign key, explicit RLS, and compatibility handling for its historical
`client_name` snapshot. Unmatched legacy rows remain admin-only until reconciled.
Optional portal tables that do not yet exist are skipped, which allows the Hub
mapping to be installed in a partially initialized project. If one of those legacy
tables is created later, apply its historical creation migration first and rerun
the account-hardening SQL before exposing it to clients.

`transaction_logs` and `unprocessed_imports` are account-owned but remain
admin-only mutable import workspaces. Core `positions`, `legs`, and `fills` receive
fail-closed RLS: admins have full access and clients have SELECT-only access to
their own structures. Account child foreign keys use `ON DELETE RESTRICT`, so a
stateful client is deactivated rather than deleted.

The Hub-mapping migration adds nullable `hub_account_id`, `hub_account_label`,
and `hub_account_mapped_at`. A partial unique index prevents the same non-null Hub
account being attached to two portal clients. Use the narrow
`admin_set_client_hub_account_mapping(uuid, uuid, text)` RPC for assignments.

The reporting-currency migration adds `public.set_own_reporting_currency(text)`
and `admin_set_client_reporting_currency(uuid, text)`. The client RPC derives the
account only from trusted `app_metadata.client_id` and cannot accept or change a
Hub account ID, mapping label, or another client ID.

`reporting_currency_source` is database-managed: it is `client` when the narrow
RPC changes a non-null currency, `admin` when an administrator changes it, and
`null` when the currency is cleared. `hub_account_mapped_at` is likewise set when
the Hub ID changes and cleared when it is removed. Do not write either provenance
field from the application. Database CHECK constraints additionally guarantee that
an unmapped account has neither a Hub label nor mapping timestamp, a mapped account
has a timestamp, reporting currency and source are null together, and any selected
currency is canonical uppercase `A-Z0-9` (2–12 characters). The BEFORE trigger
normalizes and validates direct administrator writes too.

Client names remain compatibility snapshots while repository code still filters
some queries with `.eq('client_name', ...)`. An administrator rename cascades the
canonical name to all hardened state tables, both import tables, and `positions`,
keyed by `client_id`. In configured environments `RootRouter` resolves this
canonical name from the caller's own `clients` row via trusted
`app_metadata.client_id`, so no Auth metadata update/re-login is required after a
rename. `user_metadata.client_name` remains an optional local/no-Supabase demo
fallback and is never an authorization input.

Every Hub-mapping or reporting-currency transition is recorded in the immutable
`client_account_config_audit` table with the actor ID/role and complete old/new
values. It deliberately contains no API secrets. Clients may read only their own
history; administrators may read all history; the table has no direct write policy.
Selecting the same currency again is meaningful: it updates the provenance to the
actor (`client` or `admin`) and is audited when that provenance changes.

The two narrow admin RPCs accept either
an `app_metadata.role = 'admin'` JWT or Supabase's server-held `service_role`; do
not put a service-role credential in the browser. Direct administrator table
updates remain allowed by RLS, but the database trigger still derives provenance.

### Required live Supabase acceptance checks

After applying all three migrations in order to a non-production project, run these
checks with fresh JWTs (sign out and back in after changing app metadata):

1. Create two portal clients and map one Hub UUID to the first. Verify mapping the
   same UUID to the second fails with unique violation `23505`.
2. As a client with only `app_metadata.client_id` for the first row, verify direct
   `update public.clients` is denied; calling
   `rpc('set_own_reporting_currency', { p_reporting_currency: 'usdc' })` succeeds
   and returns `USDC` with source `client`.
3. Verify the same client cannot select, update, delete, or call the RPC on the
   second client; use a missing/malformed `app_metadata.client_id` and verify it
   fails closed.
4. As an `app_metadata.role = 'admin'` user, verify client creation, mapping,
   unmapping, and reporting-currency changes succeed. Verify a direct
   admin reporting-currency change receives source `admin` and mapping changes set
   `hub_account_mapped_at`.
5. Verify an email only present in `VITE_SUPABASE_ADMIN_EMAILS`, but without
   `app_metadata.role = 'admin'`, is denied by the database. That frontend
   allowlist is not an authorization boundary.
6. Before production rollout, list unresolved legacy rows for every state table
   (for example, `select id, client_name from public.audit_events where client_id
   is null`) and either create the missing client mapping or deliberately retain
   the row as admin-only historical data. Then, as a client, insert an event with
   another account’s `client_name` and verify the stored `client_id` and
   `client_name` are rewritten to the caller’s account.
7. Verify a client cannot select `transaction_logs` or `unprocessed_imports`, while
   an `app_metadata.role = 'admin'` user can create, read, update, and delete them.
   Confirm their `client_name` is rewritten from their selected `client_id`.
8. Rename a mapped client as an administrator. Verify the same `client_id` owns all
   matching positions, setup state, transaction logs, and unprocessed imports, and
   every `client_name` snapshot changed to the new value. Verify the configured
   portal immediately resolves the new canonical name and legacy name-filtered UI
   queries continue working without an Auth metadata update.
9. Map, remap, unmap, choose a currency as a client, and choose the same currency
   as an administrator. Verify `client_account_config_audit` contains ordered,
   reconstructable old/new JSON, the correct actor ID/role, and no client can insert
   or modify audit rows. Attempt to delete the client and verify `ON DELETE RESTRICT`
   rejects it once any account history exists; set the client `status` to inactive
   instead.

The account-identity migration establishes core `positions`, `legs`, and `fills` RLS. It
first removes every existing policy (to prevent an unknown permissive policy from
OR-opening access), then grants trusted admins full access and clients **SELECT
only** access to their own positions and parent-position-scoped legs/fills.
Supabase `service_role` bypasses RLS as the standard server-only path.

### Local PostgreSQL acceptance harness

With the approved local Docker container running, execute:

```sh
bash scripts/verify-slice2-postgres.sh
```

The command refuses any database other than `trade_management_desk_dev`, never
touches `portfolio_data_hub`, records a SHA-256 over the ordered three-migration
set, and refuses to test a stale schema when that hash changes. Fixture data is enclosed
in a rollback transaction; baseline objects and the migrations persist for repeatable
checks. The plain-PostgreSQL bootstrap creates `authenticated` and `service_role`
as **cluster-global roles** plus minimal `auth.*` claim shims. That is acceptable in
the user-approved disposable shared container, but strict isolation should use a
dedicated PostgreSQL container rather than this shared one.
