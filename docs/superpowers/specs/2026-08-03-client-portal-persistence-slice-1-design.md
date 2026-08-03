# Client Portal Persistence — Slice 1: Appropriateness + Strategy

**Date:** 2026-08-03
**Status:** Design approved → ready for implementation planning
**Scope:** First slice of Phase 4 (persistence). Wire the two simplest setup surfaces —
**Appropriateness** self-assessment and **Strategy** selection — to Supabase, establishing the
persistence pattern (migration + per-client RLS + repo + hook + graceful degradation) that the
remaining surfaces reuse.

---

## 1. Context & goal

The client portal (`src/features/clientPortal/`) currently holds all setup state in-session — reload
and it resets. This slice makes the client's **appropriateness assessment** and **strategy selection**
durable in Supabase, so on next login the portal restores those two preconditions from the database.
It deliberately does *not* touch the other surfaces (keys, updates, risk limits, activation, audit log),
which become later slices.

## 2. Decisions (from brainstorming)

- **Per-client RLS** — the client portal queries Supabase directly from the browser with the client's
  JWT, so RLS is the real isolation boundary. New tables enforce that a client can only read/write their
  own rows; an admin (`role='admin'`) may read all.
- **Append-only history** — each sign / selection is a new timestamped row; the portal reads the latest.
  Preserves the full compliance record (never overwrites a prior attestation), matching the
  "keeps complete audit logs" requirement.
- **Admin-read included** — an admin `select` policy is part of this slice.
- **Graceful degradation** — if Supabase is unconfigured or a fetch/save fails, the portal falls back to
  today's in-session behavior and never hard-breaks.

## 3. Schema

Two append-only tables, following the `supabase/migrations/` convention (`public.<name>`, `id uuid`,
`client_name text` scoping, `created_by uuid`, `ts timestamptz`, indexes on client_name + ts desc).

### 3.1 `20260803_add_appropriateness_assessments.sql`

```sql
create table if not exists public.appropriateness_assessments (
  id           uuid primary key default gen_random_uuid(),
  client_name  text not null,
  created_by   uuid,
  answers      jsonb,
  attestations jsonb,
  signed_name  text,
  valid_until  timestamptz,
  ts           timestamptz not null default now()
);

create index if not exists appropriateness_client_idx
  on public.appropriateness_assessments (client_name);
create index if not exists appropriateness_ts_idx
  on public.appropriateness_assessments (client_name, ts desc);

alter table public.appropriateness_assessments enable row level security;

-- Client: read only their own rows.
create policy "Clients read own appropriateness"
  on public.appropriateness_assessments for select
  using (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

-- Client: insert only rows carrying their own client_name.
create policy "Clients insert own appropriateness"
  on public.appropriateness_assessments for insert
  with check (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

-- Admin: read all.
create policy "Admins read all appropriateness"
  on public.appropriateness_assessments for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
```

### 3.2 `20260803_add_strategy_selections.sql`

```sql
create table if not exists public.strategy_selections (
  id          uuid primary key default gen_random_uuid(),
  client_name text not null,
  created_by  uuid,
  module      text not null,
  ts          timestamptz not null default now()
);

create index if not exists strategy_selections_client_idx
  on public.strategy_selections (client_name);
create index if not exists strategy_selections_ts_idx
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
```

> The client's `client_name` is read from `user_metadata` (set per the login-setup docs). The insert
> `with check` prevents a client from writing rows under another client's name.

## 4. App layer

### 4.1 Repos (`src/lib/clientPortal/`)

Following the `src/lib/positions/fetch*` style (return a discriminated `{ ok }` result; never throw to
the UI):

- `appropriatenessRepo.ts`
  - `type AppropriatenessRecord = { answers: unknown; attestations: unknown; signedName: string; validUntil: string | null; ts: string }`
  - `fetchLatestAppropriateness(client, clientName): Promise<{ ok: true; record: AppropriatenessRecord | null } | { ok: false; error: string }>` — orders by `ts desc limit 1`, maps row→domain.
  - `saveAppropriateness(client, clientName, input): Promise<{ ok: true; record: AppropriatenessRecord } | { ok: false; error: string }>` — inserts, returns the created row.
- `strategyRepo.ts`
  - `fetchLatestStrategy(client, clientName): Promise<{ ok: true; module: string | null } | { ok: false; error: string }>`
  - `saveStrategy(client, clientName, module): Promise<{ ok: true } | { ok: false; error: string }>`

Pure row↔domain mapping functions are exported for unit testing.

### 4.2 Hook + wiring

- `useSetupPersistence(clientName)` (`src/features/clientPortal/useSetupPersistence.ts`) — on mount
  (and when `clientName` changes), if `hasSupabaseClient()`, fetches the latest appropriateness + strategy
  in parallel and returns `{ loaded, appropriatenessSigned, selectedStrategy, saveAppropriateness, saveStrategy }`.
  `save*` wrap the repo inserts and re-expose their `{ ok }` result.
- `ClientPortalShell` consumes the hook. On load it seeds `setupStatus.appropriateness`/`.strategy` and
  the `strategy` state from the fetched records. The existing `signAppropriateness` / `selectStrategy`
  handlers become async: they `await save*`; on success they update local state + append the in-session
  audit event (as today); on failure they surface a non-blocking inline error and leave local state
  unchanged.

### 4.3 Data flow

```
login → ClientPortalShell mounts → useSetupPersistence(clientName)
     → fetchLatestAppropriateness + fetchLatestStrategy (RLS scopes to this client)
     → seed setupStatus.{appropriateness,strategy} + selected module
client signs → saveAppropriateness(insert) → ok → setupStatus.appropriateness=true + audit
client selects → saveStrategy(insert) → ok → setupStatus.strategy=true + strategy=name + audit
```

### 4.4 Graceful degradation

- `!hasSupabaseClient()` → hook returns `loaded:true` with nulls; portal behaves exactly as today
  (in-session only). No error shown.
- Fetch error → treat as "no record" for seeding, log to console; portal still usable.
- Save error → the handler shows an inline error near the action and does **not** flip the precondition,
  so the client can retry. (The sample-data fallback and all other pages are unaffected.)

## 5. Testing

- **Repo mappers** — pure row↔domain functions unit-tested directly.
- **Repos** — tested against a mocked Supabase client (chainable `from().select().eq().order().limit()`
  and `from().insert().select().single()`), asserting the correct table, client_name filter, order, and
  the `{ ok }` result shape on success and error — matching the existing `lib/positions` test approach.
- **Hook** — tested with the repos mocked: seeds from fetched records; `save*` calls the repo and returns
  its result.
- **Shell** — with `useSetupPersistence` mocked: a fetched signed record seeds the sidebar check on mount;
  signing calls `saveAppropriateness` and flips the precondition on success. The existing shell tests
  (including the end-to-end activation flow) keep passing (the mock returns a resolved no-op by default).

## 6. Operational notes

- **You run the migrations.** I write the two SQL files under `supabase/migrations/`; you apply them to
  your Supabase project (I can't run migrations on your DB). Until applied, the fetch returns an error and
  graceful degradation keeps the portal working in-session.
- **Admin DB access requires `app_metadata.role = 'admin'`** on admin users. The `VITE_SUPABASE_ADMIN_EMAILS`
  allowlist is browser-only and invisible to Postgres, so the admin `select` policies key off the JWT
  `role` claim. Admins without `role='admin'` set won't read client compliance rows via RLS (they still
  have full app access; only these specific DB reads are gated). Documented in `docs/client-portal-login-setup.md`.

## 7. Non-goals / deferred (later slices)

- Persistence for **Exchange keys**, **Updates**, **Risk limits**, **Activation state**, and the durable
  **Audit log** — each a later slice reusing this pattern.
- Tightening RLS on the pre-existing `positions` / `position_interventions` / `clients` tables (they share
  the permissive-RLS convention) — a separate follow-up.
- Admin compliance-oversight UI in the admin desk (the admin-read policy exists, but no admin UI consumes
  it yet).
- Editing/among multiple stored assessments; the portal only reads the latest.

## 8. Decided details

- `valid_until` = the signing time **+ 12 months**, computed in `saveAppropriateness` at insert time
  (client-side `Date`), stored on the row. The portal shows "valid until \<date\>" from the fetched record.
