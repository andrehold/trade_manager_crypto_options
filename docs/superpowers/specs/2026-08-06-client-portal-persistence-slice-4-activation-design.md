# Client Portal Persistence — Slice 4: Activation state

**Date:** 2026-08-06
**Status:** Design approved → ready for implementation planning
**Scope:** Fourth slice of Phase 4 (persistence). Wire the master **activation** (kill-switch) state to
Supabase so the client's activate/deactivate decision survives reload, restored under a
precondition-gate guard. Reuses the per-client-RLS + repo + `useSetupPersistence` hook + promote-only
seeding + persist-first + graceful-degradation pattern from Slices 1–3.

---

## 1. Context & goal

The client portal's master activation control (`ActivationControl` in the shell header) toggles a single
`active` boolean via `toggleActivation`, which today flips in-session state and appends an
`ACTIVATION`/`DEACTIVATION` audit event — reload and it resets to inactive. Activating is gated by
`canActivate(setupStatus)` (all four setup preconditions met); deactivating is always available while
active.

This slice makes the activation state durable in Supabase and restores it on next login **under a guard**:
active is restored only if the setup gate still holds from persisted preconditions. It satisfies the
"client activates and deactivates the software" criterion by preserving the client's own last explicit
toggle, while avoiding an unsafe "Active but gate unmet" state after reload.

## 2. Decisions (from brainstorming)

- **Append-only event log** — one `activation_events` table of immutable `activate`/`deactivate` rows;
  current state = the latest row's action. Linear latest-wins (simpler than the exchange-keys fold — no
  grouping). Consistent with the append-only convention and preserves the full activation history.
- **Guard on load** — if the persisted state is `active` but not all four preconditions restore as met,
  fall back to inactive. Since all four preconditions now persist (Slices 1–3), a consistent client
  restores Active normally; only a genuinely inconsistent state is downgraded. (The alternative — restore
  raw — was rejected to avoid showing "Active" with a missing precondition, e.g. all keys revoked.)
- **Per-client RLS** — same isolation boundary as prior slices (client reads/inserts only their own rows;
  admin `role='admin'` reads all).
- **Graceful degradation** — Supabase unconfigured or a fetch/save failure never hard-breaks the portal;
  it falls back to today's in-session behavior.

## 3. Schema

One append-only table, following the `supabase/migrations/` convention (`public.<name>`, `id uuid`,
`client_name text` scoping, `created_by uuid default auth.uid()`, `ts timestamptz`, indexes on
`client_name` and `(client_name, ts)`).

### 3.1 `20260806_add_activation_events.sql`

```sql
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
```

> The insert `with check` prevents a client from writing rows under another client's name. There is no
> update or delete policy — the log is append-only; a deactivate is a new `action:'deactivate'` row.

## 4. App layer

### 4.1 Repo (`src/lib/clientPortal/activationRepo.ts`)

Following the `strategyRepo` style (return a discriminated `{ ok }` result; never throw):

- `fetchActivationState(supabase, clientName): Promise<{ ok: true; active: boolean } | { ok: false; error: string }>`
  — selects `action` ordered by `ts desc limit 1`; `active = rows.length > 0 && rows[0].action === 'activate'`
  (no rows → `false`).
- `saveActivation(supabase, clientName, active: boolean): Promise<{ ok: true } | { ok: false; error: string }>`
  — inserts a row with `action: active ? 'activate' : 'deactivate'`.

No fold is needed (single latest row), matching the strategy/appropriateness "latest row" repos.

### 4.2 Hook (`useSetupPersistence`)

Extend the existing hook:

- Add `fetchActivationState` to the existing `Promise.all`; add state `persistedActive: boolean` (default
  `false`), set from a successful fetch.
- Return `persistedActive` and a `saveActivation(active): Promise<{ ok; error? }>` callback that wraps the
  repo insert and re-exposes its `{ ok }` result. Like the existing saves, `!hasSupabaseClient()`
  short-circuits `saveActivation` to `{ ok: true }` (in-session only, no error).

### 4.3 Shell (`ClientPortalShell`)

The `active` boolean state already exists. Two changes:

- **Guarded seed (promote-only):** in the existing load-seed effect, build a `SetupStatus` from the
  *persisted* precondition fields and restore active only if the gate holds:

  ```ts
  const persistedStatus: SetupStatus = {
    appropriateness: persistence.appropriatenessSigned,
    strategy: !!persistence.selectedStrategy,
    riskLimits: !!persistence.savedRiskLimits,
    tradingKey: persistence.activeKeys.length > 0,
  }
  if (persistence.persistedActive && canActivate(persistedStatus)) setActive((cur) => cur || true)
  ```

  Using `canActivate` keeps the gate logic in one place; reading only `persistence.*` fields (not
  `setupStatus`) avoids a stale-closure/deps tangle and keeps the effect's deps limited to persistence
  fields. Promote-only (`cur || true`) so a locally-toggled active is never reverted by a stale seed. The
  effect's dep array gains `persistence.persistedActive`.

- **Persist-first toggle:** `toggleActivation` becomes async — it reads the current `active`, computes
  `next = !active`, `await persistence.saveActivation(next)`; on failure sets `persistError` and changes
  nothing; on success sets `active = next`, clears `persistError`, and appends the existing
  `ACTIVATION`/`DEACTIVATION` audit event. `ActivationControl`'s `onToggle: () => void` prop is unchanged
  (an `async () => void` handler is assignable), and the Activate button stays gated by `canActivate`, so a
  save only ever flips to active when the gate is open.

### 4.4 Data flow

```
login → ClientPortalShell mounts → useSetupPersistence(clientName)
     → fetchActivationState (RLS scopes to client) → latest-row action
     → seed active ONLY if persistedActive AND canActivate(persistedStatus)
client toggles → saveActivation(insert activate|deactivate) → ok
     → active=next + ACTIVATION/DEACTIVATION audit
```

### 4.5 Graceful degradation

- `!hasSupabaseClient()` → hook returns `persistedActive: false`; `saveActivation` short-circuits to
  `{ ok: true }`. Portal behaves as today (in-session activation). No error shown.
- Fetch error → treated as "inactive" for seeding, logged to console; portal still usable.
- Save error → `toggleActivation` shows the inline `persistError` banner and does **not** change `active`,
  so the client can retry.

## 5. Testing

- **Repo** — against a mocked Supabase client (chainable `from().select().eq().order().limit()` and
  `from().insert()`): `fetchActivationState` returns `active:true` when the latest row is `activate`,
  `active:false` when the latest is `deactivate`, and `active:false` with no rows; asserts the correct
  table, `client_name` filter, and `ts desc` order. `saveActivation(true)`/`(false)` insert the correct
  `action`. Error results on query/insert failure.
- **Hook** — with repos mocked: seeds `persistedActive` from a fetched `active:true`; `saveActivation`
  delegates to the repo and returns its result; `!hasSupabaseClient()` short-circuits.
- **Shell** — with `useSetupPersistence` mocked: (a) `persistedActive:true` **with all four preconditions
  persisted** restores the header to Active on mount; (b) `persistedActive:true` **with one precondition
  missing** leaves it Inactive (guard); (c) a persist-first toggle failure shows the banner and leaves
  `active` unchanged. Existing shell tests (including the E2E activation gate test, which asserts the
  Activate button becomes enabled but does not click it) stay green — the shared `baseSetupPersistence`
  mock gains `persistedActive:false` and `saveActivation: async () => ({ ok:true })`.

## 6. Operational notes

- **You run the migration.** I write `supabase/migrations/20260806_add_activation_events.sql`; you apply it
  to your Supabase project. Until applied, the fetch returns an error and graceful degradation keeps the
  portal working in-session.
- **Admin DB access requires `app_metadata.role = 'admin'`**, same as prior slices — the admin `select`
  policy keys off the JWT `role` claim, not the browser-only allowlist.

## 7. Non-goals / deferred (later slices)

- Persistence for **Updates**, and the durable **Audit log** — each a later slice. (The `activation_events`
  table is itself a durable activation record, but the general audit-log surface stays in-session for now,
  consistent with Slices 1–3.)
- **Auto-deactivating in-session** when a precondition later drops (e.g. the client revokes their last key
  while active) — unchanged existing behavior; the gate guard is load-time only. A future safety slice could
  add in-session auto-deactivation.
- Admin compliance-oversight UI consuming the admin-read policy.
