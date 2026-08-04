# Client Portal Persistence — Slice 2: Risk limits

**Date:** 2026-08-04
**Status:** Design approved → ready for implementation planning
**Scope:** Second slice of Phase 4 (persistence). Wire the **Risk & deployment** setup surface to
Supabase, so the client's applied risk/greek limits are durable and restored on next login. Reuses the
pattern established in Slice 1 (migration + per-client RLS + repo + `useSetupPersistence` hook +
promote-only seeding + graceful degradation).

---

## 1. Context & goal

The client portal's Risk page (`src/features/clientPortal/risk/RiskPage.tsx`) lets the client set their
deployment parameters and greek/stress limits and press **Apply**, which today flips the `riskLimits`
setup precondition in-session only — reload and it reverts to `DEFAULT_RISK_LIMITS` with the precondition
cleared. This slice persists the applied `RiskLimits` snapshot in Supabase so that on next login the portal
restores both the applied values and the satisfied precondition.

It deliberately does **not** touch the other unpersisted surfaces (exchange keys, updates, activation
state, durable audit log); each is a later slice reusing this same pattern.

## 2. Decisions (from brainstorming)

- **Single `jsonb` blob** — the row stores the whole `RiskLimits` object in one `limits jsonb` column
  rather than ~15 typed columns. Append-only, so each Apply writes the full snapshot as-is. The `RiskLimits`
  shape can evolve without a schema migration, and the two `Band` fields stay a single value each. A pure,
  validating parser maps the untyped blob back to `RiskLimits`.
- **Per-client RLS** — same isolation boundary as Slice 1: the client browser queries Supabase directly
  with the client JWT, so RLS enforces that a client reads/inserts only their own rows; an admin
  (`role='admin'`) may read all.
- **Append-only history** — each Apply is a new timestamped row; the portal reads the latest. Preserves the
  full record of parameter changes.
- **Admin-read included** — an admin `select` policy is part of this slice.
- **Graceful degradation** — if Supabase is unconfigured, a fetch/save fails, or the stored blob is
  malformed/legacy-shaped, the portal falls back to today's in-session behavior with
  `DEFAULT_RISK_LIMITS` and never hard-breaks.

## 3. Schema

One append-only table, following the existing `supabase/migrations/` convention (`public.<name>`,
`id uuid`, `client_name text` scoping, `created_by uuid default auth.uid()`, `ts timestamptz`, indexes on
`client_name` and `(client_name, ts desc)`).

### 3.1 `20260804_add_risk_limit_selections.sql`

```sql
-- Append-only client risk/greek limit snapshots. Same per-client RLS + admin-read pattern.
create table if not exists public.risk_limit_selections (
  id          uuid primary key default gen_random_uuid(),
  client_name text not null,
  created_by  uuid default auth.uid(),
  limits      jsonb not null,
  ts          timestamptz not null default now()
);

create index if not exists risk_limit_selections_client_idx
  on public.risk_limit_selections (client_name);
create index if not exists risk_limit_selections_client_ts_idx
  on public.risk_limit_selections (client_name, ts desc);

alter table public.risk_limit_selections enable row level security;

create policy "Clients read own risk limits"
  on public.risk_limit_selections for select
  using (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Clients insert own risk limits"
  on public.risk_limit_selections for insert
  with check (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Admins read all risk limits"
  on public.risk_limit_selections for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
```

> The client's `client_name` is read from `user_metadata` (set per the login-setup docs). The insert
> `with check` prevents a client from writing rows under another client's name.

## 4. App layer

### 4.1 Repo (`src/lib/clientPortal/riskLimitsRepo.ts`)

Following the `strategyRepo` / `appropriatenessRepo` style (return a discriminated `{ ok }` result; never
throw to the UI):

- `parseRiskLimits(blob: unknown): RiskLimits | null` — **pure, exported for unit testing.** Validates that
  the untyped jsonb value is a well-formed `RiskLimits`: every scalar field (`capitalTvlBtc`, `maxConcurrent`,
  `expiryMinDte`, `expiryMaxDte`, `gammaFloor`, `gammaCap`, `thetaFloor`, `stressLossMaxPct`,
  `netDeltaMaxPct`, `drawdownReducePct`, `drawdownStopPct`) is a finite number; `autoRoll` is a boolean; and
  each of `deltaLongGamma`, `deltaShortGamma`, `vega` is a `{ min: number; max: number }`. Returns a fully
  typed `RiskLimits` on success (copying only the known fields, ignoring extras) or `null` on any missing /
  wrong-typed field. A `null` result is treated by callers as "no usable saved record".
- `fetchLatestRiskLimits(supabase, clientName): Promise<{ ok: true; limits: RiskLimits | null } | { ok: false; error: string }>`
  — selects `limits` ordered by `ts desc limit 1`, then runs the row's `limits` value through
  `parseRiskLimits`. A malformed stored blob yields `limits: null` (not an error), so the portal falls back
  to defaults rather than surfacing a failure.
- `saveRiskLimits(supabase, clientName, limits: RiskLimits): Promise<{ ok: true } | { ok: false; error: string }>`
  — inserts `{ client_name, limits }`; returns `{ ok }`.

`RiskLimits` / `Band` are imported from `src/features/clientPortal/risk/riskLimits.ts` (single source of
truth; the repo does not redefine the shape).

### 4.2 Hook (`useSetupPersistence`)

Extend the existing hook:

- On mount (and when `clientName` changes), add `fetchLatestRiskLimits` to the existing `Promise.all`.
- Add state `savedRiskLimits: RiskLimits | null`, set from a successful fetch with a non-null parse.
- Return `savedRiskLimits` and a `saveRiskLimits(limits): Promise<{ ok; error? }>` callback that wraps the
  repo insert and re-exposes its `{ ok }` result. Like the existing saves, `!hasSupabaseClient()` short-
  circuits to `{ ok: true }` (in-session only, no error).

The hook's returned object grows two fields; existing consumers/tests referencing the current fields are
unaffected.

### 4.3 Shell (`ClientPortalShell`)

- **Null-sentinel refactor:** `riskLimits` state becomes `RiskLimits | null` (initial `null` = "not yet
  applied or seeded"), and a derived `const effectiveLimits = riskLimits ?? DEFAULT_RISK_LIMITS` is passed
  to `RiskPage` as `limits`. This mirrors how the `strategy` state uses `null` as the untouched sentinel and
  lets the seed use the same promote-only `cur ?? persisted` idiom.
- **Seeding:** in the existing load-seed effect, when `persistence.savedRiskLimits` is present, promote the
  precondition (`riskLimits: s.riskLimits || true`) and seed `setRiskLimits((cur) => cur ?? persistence.savedRiskLimits)`.
  Promote-only: a value the client applied locally before the fetch resolved is never reverted by a seed.
- **Async apply:** `applyRisk(next)` becomes async — `await persistence.saveRiskLimits(next)`; on `ok`, set
  `riskLimits = next`, flip `setupStatus.riskLimits`, append the existing `RISK_PARAM` audit event, and
  clear `persistError`; on failure, set `persistError` and leave the precondition and applied values
  unchanged so the client can retry. Identical control flow to `selectStrategy`.

### 4.4 Data flow

```
login → ClientPortalShell mounts → useSetupPersistence(clientName)
     → fetchLatestRiskLimits (RLS scopes to this client) → parseRiskLimits
     → seed setupStatus.riskLimits + riskLimits state (promote-only)
client presses Apply → saveRiskLimits(insert full snapshot) → ok
     → riskLimits=next + setupStatus.riskLimits=true + RISK_PARAM audit
```

### 4.5 Graceful degradation

- `!hasSupabaseClient()` → hook returns `savedRiskLimits: null`; portal behaves as today (in-session,
  `DEFAULT_RISK_LIMITS`). No error shown.
- Fetch error → treated as "no record" for seeding, logged to console; portal still usable.
- Malformed/legacy stored blob → `parseRiskLimits` returns `null` → treated as "no record"; falls back to
  defaults. No error shown.
- Save error → `applyRisk` shows the inline `persistError` banner and does **not** flip the precondition or
  change applied values, so the client can retry.

## 5. Testing

- **`parseRiskLimits` (pure)** — unit-tested directly: a fully valid blob round-trips to `RiskLimits`; a blob
  missing a field, with a wrong-typed field, with a malformed band, or that is `null`/non-object returns
  `null`; extra unknown keys are ignored.
- **Repo** — tested against a mocked Supabase client (chainable `from().select().eq().order().limit()` and
  `from().insert()`), asserting the correct table, `client_name` filter, order, `{ ok }` shape on success and
  error, and that a malformed stored blob yields `limits: null` rather than `ok: false`.
- **Hook** — with the repos mocked: seeds `savedRiskLimits` from a fetched record; `saveRiskLimits` calls the
  repo and returns its result; `!hasSupabaseClient()` short-circuits.
- **Shell** — with `useSetupPersistence` mocked: a fetched `savedRiskLimits` seeds the risk precondition and
  the applied values on mount; a failed `saveRiskLimits` shows the error banner and does **not** flip the risk
  precondition. The existing shell tests keep passing — the shared `baseSetupPersistence` mock in
  `ClientPortalShell.test.tsx` gains `savedRiskLimits: null` and `saveRiskLimits: async () => ({ ok: true })`
  so the default apply-flow tests still flip the precondition.

## 6. Operational notes

- **You run the migration.** I write `supabase/migrations/20260804_add_risk_limit_selections.sql`; you apply
  it to your Supabase project (I can't run migrations on your DB). Until applied, the fetch returns an error
  and graceful degradation keeps the portal working in-session with defaults.
- **Admin DB access requires `app_metadata.role = 'admin'`** on admin users, same as Slice 1 — the admin
  `select` policy keys off the JWT `role` claim, not the browser-only `VITE_SUPABASE_ADMIN_EMAILS` allowlist.

## 7. Non-goals / deferred (later slices)

- Persistence for **Exchange keys**, **Updates**, **Activation state**, and the durable **Audit log** — each
  a later slice reusing this pattern.
- A real greek engine / live marks (replacing `ILLUSTRATIVE_READINGS`) — unrelated; the persisted values are
  the client's *limits*, not live readings.
- Risk-page UI polish already noted as deferred (`deltaLongGamma` editing, dynamic band-descriptor strings,
  theta floor-only status).
- Showing the "applied on `<date>`" provenance from the stored `ts` in the Risk page UI — the row carries it,
  but no UI consumes it yet.
