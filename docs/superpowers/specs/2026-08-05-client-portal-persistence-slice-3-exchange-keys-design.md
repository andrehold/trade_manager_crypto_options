# Client Portal Persistence — Slice 3: Exchange keys

**Date:** 2026-08-05
**Status:** Design approved → ready for implementation planning
**Scope:** Third slice of Phase 4 (persistence). Wire the **Exchange API keys** setup surface to
Supabase so the client's registered key set survives reload, and let the client add and revoke keys.
Reuses the per-client-RLS + repo + `useSetupPersistence` hook + promote-only seeding + graceful
degradation pattern from Slices 1–2, extended to a **set with a lifecycle** (add / revoke).

---

## 1. Context & goal

The client portal's Keys page (`src/features/clientPortal/pages/KeysPage.tsx`) is currently
presentational: it shows hardcoded sample key rows and a single one-click "Add key" button with a canned
label. The shell's `addTradingKey(label)` flips the `tradingKey` setup precondition in-session and appends
an `API_KEY` audit event — reload and it all resets.

This slice makes the client's exchange-key **metadata** durable in Supabase and gives the client real
control: add a key (via a small form) and revoke a key. The `tradingKey` precondition becomes "the client
has at least one active (non-revoked) key." This satisfies the "client creates AND controls the exchange
API keys" criterion (revocation is control).

### 1.1 Security constraint (crux)

The software **must never store an API secret, key, or token.** The client creates the API key on the
venue and holds the secret there. This portal records only **non-authenticating metadata** the client
chooses to enter: venue, a human label, an optional short *fingerprint* (e.g. the last few characters the
client copies for their own recognition — not the key), a fixed scope string, and a no-withdrawal
attestation. There is deliberately no schema column and no form field that could hold a credential.

## 2. Decisions (from brainstorming)

- **Add + revoke (key set)** — persist a list of key-metadata records; the client can add and revoke.
- **Metadata only, never secrets** — see §1.1. Schema-level guarantee: no secret/key/token column exists.
- **Append-only event log, not a mutable-status table** — one table of immutable `add`/`revoke` events;
  the current active set is derived by folding events. Keeps per-client RLS to select-own + insert-own (no
  `UPDATE` policy / with-check to get wrong), preserves full history, and the table *is* the key-action
  audit trail. The mutable-status alternative queries more simply but needs update-RLS and discards history.
- **Per-client RLS** — same isolation boundary as prior slices (client reads/inserts only their own rows;
  admin `role='admin'` reads all).
- **Graceful degradation** — Supabase unconfigured, a fetch/save failure, or a malformed row never
  hard-breaks the portal; it falls back to in-session behavior.

## 3. Schema

One append-only table, following the `supabase/migrations/` convention (`public.<name>`, `id uuid`,
`client_name text` scoping, `created_by uuid default auth.uid()`, `ts timestamptz`, indexes on
`client_name` and `(client_name, ts)`).

### 3.1 `20260805_add_exchange_key_events.sql`

```sql
-- Append-only client exchange-key lifecycle events (add / revoke). NEVER stores an API secret —
-- only non-authenticating metadata the client chooses to record. Same per-client RLS + admin-read pattern.
create table if not exists public.exchange_key_events (
  id            uuid primary key default gen_random_uuid(),
  client_name   text not null,
  created_by    uuid default auth.uid(),
  key_ref       uuid not null,                     -- client-generated; groups an add with its later revoke
  action        text not null check (action in ('add','revoke')),
  venue         text,
  label         text,
  fingerprint   text,
  scopes        text default 'trade,read',
  no_withdrawal boolean,
  ts            timestamptz not null default now()
);

create index if not exists exchange_key_events_client_idx
  on public.exchange_key_events (client_name);
create index if not exists exchange_key_events_client_ts_idx
  on public.exchange_key_events (client_name, ts);

alter table public.exchange_key_events enable row level security;

create policy "Clients read own exchange key events"
  on public.exchange_key_events for select
  using (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Clients insert own exchange key events"
  on public.exchange_key_events for insert
  with check (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Admins read all exchange key events"
  on public.exchange_key_events for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
```

> The insert `with check` prevents a client from writing rows under another client's name. There is no
> update or delete policy — the log is append-only; a revoke is a new `action:'revoke'` row.

## 4. App layer

### 4.1 Repo (`src/lib/clientPortal/exchangeKeysRepo.ts`)

Following the `strategyRepo` / `riskLimitsRepo` style (return a discriminated `{ ok }` result; never throw):

- Types:
  - `type ExchangeKeyEvent = { keyRef: string; action: 'add' | 'revoke'; venue: string | null; label: string | null; fingerprint: string | null; scopes: string | null; noWithdrawal: boolean | null; ts: string }`
  - `type ExchangeKey = { keyRef: string; venue: string | null; label: string | null; fingerprint: string | null; scopes: string | null; noWithdrawal: boolean | null; ts: string }` (an active key)
  - `type AddKeyInput = { venue: string; label: string; fingerprint: string | null; noWithdrawal: boolean }`
- `parseEventRow(row: unknown): ExchangeKeyEvent | null` — **pure, exported.** Validates the untyped row has
  a string `key_ref`, a string `ts`, and `action` in `{'add','revoke'}`; maps snake_case → camelCase; returns
  `null` on a malformed/legacy row (dropped from the fold, never a crash).
- `deriveActiveKeys(events: ExchangeKeyEvent[]): ExchangeKey[]` — **pure, exported, thoroughly tested.**
  Processes events in `ts` order; for each `key_ref` the latest action wins; the result is every `key_ref`
  whose latest action is `add`, carrying the metadata from its `add` event, ordered by the add's `ts`. A
  `revoke` with no prior `add` is ignored.
- `fetchActiveKeys(supabase, clientName): Promise<{ ok: true; keys: ExchangeKey[] } | { ok: false; error: string }>`
  — selects all this client's rows ordered by `ts` ascending, maps each with `parseEventRow` (dropping
  nulls), folds with `deriveActiveKeys`. A malformed row yields fewer keys, not an error.
- `addExchangeKey(supabase, clientName, input: AddKeyInput): Promise<{ ok: true; keyRef: string } | { ok: false; error: string }>`
  — generates `keyRef = crypto.randomUUID()`, inserts an `action:'add'` row with the input metadata + fixed
  `scopes:'trade,read'`, returns the `keyRef`.
- `revokeExchangeKey(supabase, clientName, keyRef: string): Promise<{ ok: true } | { ok: false; error: string }>`
  — inserts an `action:'revoke'` row carrying that `keyRef`.

### 4.2 Hook (`useSetupPersistence`)

Extend the existing hook:

- Add `fetchActiveKeys` to the existing `Promise.all`; add state `activeKeys: ExchangeKey[]`, set from a
  successful fetch (default `[]`).
- Return `activeKeys`, and two callbacks `addExchangeKey(input): Promise<{ ok; error?; keyRef? }>` and
  `revokeExchangeKey(keyRef): Promise<{ ok; error? }>` that wrap the repo and re-expose the result. Like the
  existing saves, `!hasSupabaseClient()` short-circuits: `addExchangeKey` returns
  `{ ok: true, keyRef: crypto.randomUUID() }` and `revokeExchangeKey` returns `{ ok: true }` (in-session
  only, no error).

### 4.3 Shell (`ClientPortalShell`)

- **Null-sentinel state:** `exchangeKeys: ExchangeKey[] | null` (initial `null` = "not seeded/touched");
  `const effectiveKeys = exchangeKeys ?? []` is passed to `KeysPage`. Mirrors the `riskLimits` null-sentinel.
- **Seeding (promote-only):** in the existing load-seed effect, when `persistence.activeKeys` is available,
  promote the precondition (`tradingKey: s.tradingKey || persistence.activeKeys.length > 0`) and seed the
  list (`setExchangeKeys((cur) => cur ?? persistence.activeKeys)`).
- **Async add (persist-first):** `addTradingKey(input: AddKeyInput)` becomes async —
  `await persistence.addExchangeKey(input)`; on `ok`, append `{ keyRef, ...metadata }` to `exchangeKeys`
  (seeding it from `[]` if still null), flip `setupStatus.tradingKey`, append the existing `API_KEY` audit
  event, and clear `persistError`; on failure, set `persistError` and change nothing.
- **Async revoke (persist-first):** new `revokeKey(keyRef)` — `await persistence.revokeExchangeKey(keyRef)`;
  on `ok`, remove that key from `exchangeKeys` and, if none remain active, set
  `setupStatus.tradingKey = false` (a legitimate user-driven demote — distinct from the promote-only seed),
  append an `API_KEY` audit event (`revoked …`), clear `persistError`; on failure, set `persistError`.

### 4.4 KeysPage rewrite (`src/features/clientPortal/pages/KeysPage.tsx`)

- Props change to `{ keys: ExchangeKey[]; onAddKey: (input: AddKeyInput) => void; onRevokeKey: (keyRef: string) => void }`.
- Renders the real `keys` list — one row per active key (venue chip, label, fingerprint if present, fixed
  `trade` / `read` / `no withdrawal` scope chips) with a **Revoke** button per row. The active-count pill is
  derived from `keys.length`.
- "Add key" toggles an inline form: **venue** select (Deribit, Coincall, Bullish, CME), **label** text input,
  **fingerprint** text input (optional), and a required **"No withdrawal permission on this key"** checkbox.
  The form's Add button is disabled until `label` is non-empty and the checkbox is checked. Submitting calls
  `onAddKey({ venue, label, fingerprint: fingerprint || null, noWithdrawal: true })` and resets the form.
- The existing page copy ("You create these keys on the venue and control them here. The software never
  holds withdrawal permission…") stays. Hardcoded sample rows are removed. An empty list shows a neutral
  "No keys registered yet" state.

### 4.5 Data flow

```
login → ClientPortalShell mounts → useSetupPersistence(clientName)
     → fetchActiveKeys (RLS scopes to client) → parseEventRow* → deriveActiveKeys
     → seed setupStatus.tradingKey + exchangeKeys (promote-only)
client adds  → addExchangeKey(insert action:'add') → ok → append + tradingKey=true + API_KEY audit
client revokes → revokeExchangeKey(insert action:'revoke') → ok → remove; if empty → tradingKey=false + audit
```

### 4.6 Graceful degradation

- `!hasSupabaseClient()` → hook returns `activeKeys: []`; add/revoke short-circuit to `{ ok }` with a local
  `keyRef`. Portal behaves as an in-session key set. No error shown.
- Fetch error → treated as "no keys" for seeding, logged to console; portal still usable.
- Malformed/legacy row → dropped by `parseEventRow`; the rest still fold. No error shown.
- Add/revoke error → the handler shows the inline `persistError` banner and changes nothing, so the client
  can retry.

## 5. Testing

- **`parseEventRow` / `deriveActiveKeys` (pure)** — unit-tested directly: an `add` yields one active key; an
  `add` then later `revoke` (same `key_ref`) yields none; a `revoke` with no prior `add` is ignored; two
  distinct `key_ref`s are independent; a re-`add` after a `revoke` yields active again; events are folded in
  `ts` order regardless of input order; a malformed row is dropped.
- **Repo** — against a mocked Supabase client (chainable `from().select().eq().order()` and `from().insert()`):
  `fetchActiveKeys` folds correctly and returns `{ ok:true; keys }`; a malformed row reduces the set rather
  than erroring; `addExchangeKey` inserts an `action:'add'` row with the metadata + fixed scopes and returns
  a `keyRef`; `revokeExchangeKey` inserts an `action:'revoke'` row for the given `keyRef`; error results on
  query/insert failure.
- **Hook** — with repos mocked: seeds `activeKeys` from a fetched fold; `addExchangeKey`/`revokeExchangeKey`
  delegate and return the repo result; `!hasSupabaseClient()` short-circuits.
- **KeysPage** — the Add button is disabled until label + attestation; submitting calls `onAddKey` with the
  entered metadata and `noWithdrawal:true`; a Revoke button calls `onRevokeKey` with the row's `keyRef`; the
  no-withdrawal copy renders; an empty list shows the empty state.
- **Shell** — with `useSetupPersistence` mocked: fetched `activeKeys` seed the `tradingKey` precondition and
  the rendered list on mount; a persist-first add failure shows the banner and does not flip the precondition;
  revoking the last active key demotes `tradingKey`. The existing end-to-end activation test is updated to
  drive the new Add-key **form** (fill label + check the attestation + submit) instead of the old one-click
  button.

## 6. Operational notes

- **You run the migration.** I write `supabase/migrations/20260805_add_exchange_key_events.sql`; you apply it
  to your Supabase project. Until applied, the fetch returns an error and graceful degradation keeps the
  portal working in-session.
- **Admin DB access requires `app_metadata.role = 'admin'`**, same as prior slices — the admin `select`
  policy keys off the JWT `role` claim, not the browser-only allowlist.

## 7. Non-goals / deferred (later slices)

- Persistence for **Updates** and **Activation state**, and the durable **Audit log** — each a later slice.
  (The `exchange_key_events` table is itself a durable key-action record, but the general audit-log surface
  stays in-session for now, consistent with Slices 1–2.)
- Any handling of the actual API key/secret — explicitly out of scope and out of schema (§1.1).
- Editing a key in place (the model is add + revoke; "editing" = revoke then add a new one).
- Verifying the key against the venue (no live venue call) — the portal records the client's own attestation.
- Admin compliance-oversight UI consuming the admin-read policy.
