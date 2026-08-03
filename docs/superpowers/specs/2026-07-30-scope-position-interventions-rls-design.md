# Scope `position_interventions` RLS to the Client — Design

**Date:** 2026-07-30
**Status:** Approved for planning

## Problem

The `position_interventions` table (added in
`supabase/migrations/20260729_add_position_interventions.sql`) has RLS policies
that grant read and insert to any authenticated user
(`auth.role() = 'authenticated'`). Client-vs-client isolation is enforced only
in the app layer, by `fetchPositionInterventions` adding
`.eq('client_name', name)`. That filter is a convenience, not a security
boundary: the browser holds an authenticated key and can query the table
unfiltered, so any signed-in client can read every client's intervention rows.

This follows the pre-existing convention on `clients` and `transaction_logs`,
so the permissive pattern is app-wide. This change tightens **only the new
`position_interventions` table** and documents the pattern for a later,
separate rollout to the older tables.

## Scope

**In scope:** replace the two permissive policies on `position_interventions`
with client-scoped policies that use the JWT `app_metadata` claims, plus an
admin bypass. Provide a manual verification checklist.

**Out of scope (recommend as separate tickets):**

- Applying the same client-scoped RLS to `positions`, `clients`,
  `transaction_logs`. The admin desk reads `positions` across every client, so
  that change is higher-risk and needs its own test pass.
- Making `app_metadata` authoritative in `src/features/auth/access.ts` (it
  currently also reads `user_metadata`). Recommended follow-up (see
  Prerequisites), not bundled here.

## Trust model

RLS trusts the JWT's `app_metadata` only, because Supabase `app_metadata` is
settable only by admin/service-role and is carried in the signed JWT, whereas
`user_metadata` is editable by the user via the client SDK and therefore
forgeable.

- Caller's client name: `auth.jwt() -> 'app_metadata' ->> 'client_name'`
- Caller is admin: `(auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'`

`service_role` bypasses RLS entirely, so backend/system writes (the future
`source = 'venue'` channel) are unaffected by these policies.

## Decisions

- **Persistence layer only.** RLS is transparent to the app;
  `fetchPositionInterventions` already filters by `client_name` for clients and
  skips it for admins, and `recordPositionIntervention` already inserts the
  client's own `client_name`. No application code changes.
- **Scope: `position_interventions` only.**
- **Admin identification via `app_metadata.role = 'admin'`.** The app's other
  admin path — the `VITE_SUPABASE_ADMIN_EMAILS` allowlist — is a build-time env
  var invisible to Postgres, so RLS cannot honor it. Admins must have
  `app_metadata.role = 'admin'` to retain cross-client access (see
  Prerequisites).
- **Fail closed.** A user whose `app_metadata.client_name` claim is null (or
  absent) matches no rows and can insert nothing.
- **Append-only.** No `update`/`delete` policies are added; the default deny
  stands, matching the table's log semantics.
- **Verification is manual** (documented SQL checklist), because RLS is
  DB-enforced and the repo has no database test harness.

## Migration

File: `supabase/migrations/20260730_scope_position_interventions_rls.sql`

```sql
-- Replace the permissive authenticated-only policies from
-- 20260729_add_position_interventions.sql with client-scoped policies.
-- Trust source is the JWT app_metadata (admin/service-role-set, unforgeable by
-- the client); user_metadata is deliberately NOT trusted. service_role bypasses
-- RLS, so backend venue-channel writes are unaffected.
drop policy if exists "Authenticated users can read interventions"
  on public.position_interventions;
drop policy if exists "Authenticated users can insert interventions"
  on public.position_interventions;

create policy "Clients read own interventions; admins read all"
  on public.position_interventions
  for select
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or client_name = (auth.jwt() -> 'app_metadata' ->> 'client_name')
  );

create policy "Clients insert own interventions; admins insert any"
  on public.position_interventions
  for insert
  with check (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or client_name = (auth.jwt() -> 'app_metadata' ->> 'client_name')
  );
```

Notes:
- RLS remains enabled from the prior migration; this migration only swaps
  policies, so no `alter table ... enable row level security` is needed.
- `client_name = (null)` evaluates to `NULL` (not true), so a null-claim caller
  is denied — the intended fail-closed behavior. Rows with a null `client_name`
  (should not occur for platform or venue writes, which always set it) are
  readable only by admins.

## Behavior under misconfiguration (graceful degradation)

If the migration is deployed before the prerequisites are met, the failure mode
is soft, not a crash:

- **Client read blocked:** `fetchPositionInterventions` returns an empty set →
  no badge appears on reload. (The hook already ignores fetch failures.)
- **Client insert blocked:** `recordPositionIntervention` returns
  `{ ok: false }`; the hook simply does not `reload()`. The optimistic overlay
  still shows the badge for the session, and the audit entry still logs.

This is why the prerequisites are "must do before deploy" rather than
"deploy will error" — nothing throws, the feature just silently stops
persisting/showing until claims are backfilled.

## Prerequisites (must be satisfied before deploying the migration)

1. **Every client auth user has `app_metadata.client_name`** set to exactly
   their `clients.client_name`. Verify in the Supabase dashboard (Authentication
   → Users → user → `app_metadata`) or via the Admin API. Backfill any missing
   ones.
2. **Every admin auth user has `app_metadata.role = 'admin'`.** Email-allowlist-
   only admins (present in `VITE_SUPABASE_ADMIN_EMAILS` but without the role
   claim) will lose cross-client read/insert on this table once the migration is
   applied.
3. **Recommended follow-up (separate ticket):** make `app_metadata` authoritative
   in `src/features/auth/access.ts` (which currently reads `user_metadata` first,
   then `app_metadata`). If a user's `user_metadata.client_name` differs from
   their `app_metadata.client_name`, the app could send a `client_name` on insert
   that the RLS `with check` rejects. Making `app_metadata` the source of truth
   removes that mismatch.

## Manual verification checklist

Run after applying the migration to a staging/real Supabase, using either the
SQL editor with role impersonation or three real logins (client A, client B,
admin A). Record pass/fail for each.

Setup: ensure at least two clients (A, B) each have ≥1 row in
`position_interventions`, and one admin user with `app_metadata.role = 'admin'`.

1. **Client A read isolation:** signed in as client A,
   `select count(*) from position_interventions;` returns only A's rows
   (no B rows). PASS if B's rows are invisible.
2. **Client A cannot read B directly:** as client A,
   `select * from position_interventions where client_name = '<B>';`
   returns 0 rows.
3. **Client A insert isolation:** as client A,
   `insert ... (position_id, client_name, source, action) values ('x','<B>','platform','modify');`
   is rejected by the `with check` (RLS violation). Inserting with
   `client_name = '<A>'` succeeds.
4. **Admin read-all:** signed in as the admin,
   `select count(*) from position_interventions;` returns rows for both A and B.
5. **Admin insert-any:** as the admin, inserting a row with
   `client_name = '<B>'` and `source = 'venue'` succeeds (models the venue
   channel written from the admin desk).
6. **service_role unaffected:** using the service key, select and insert across
   any client succeed (models a backend writer).
7. **App smoke test:** sign in to the client portal as client A, open Positions,
   click Modify on a row → badge appears (optimistic) and, on reload, persists
   (confirms A's own insert + read still work end-to-end).

## Rollback

If verification fails or a lockout is observed, re-apply the permissive policies
to restore prior behavior:

```sql
drop policy if exists "Clients read own interventions; admins read all"
  on public.position_interventions;
drop policy if exists "Clients insert own interventions; admins insert any"
  on public.position_interventions;
create policy "Authenticated users can read interventions"
  on public.position_interventions for select using (auth.role() = 'authenticated');
create policy "Authenticated users can insert interventions"
  on public.position_interventions for insert with check (auth.role() = 'authenticated');
```

(The data is low-sensitivity — position id, action, timestamp, client name — so a
brief rollback to the prior convention is acceptable while claims are fixed.)
