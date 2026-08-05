# Client Portal Persistence Slice 3 — Exchange Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the client's exchange-key metadata to Supabase as an append-only add/revoke event log, and let the client add and revoke keys, so the key set (and the `tradingKey` precondition) survive reload.

**Architecture:** One append-only `exchange_key_events` table (per-client RLS) stores immutable `add`/`revoke` events carrying only non-secret metadata. A new `exchangeKeysRepo` folds events to the current active-key set via a pure `deriveActiveKeys`. `useSetupPersistence` gains `activeKeys` + `addExchangeKey`/`revokeExchangeKey`. `ClientPortalShell` holds a `null`-sentinel `exchangeKeys` list, seeds it promote-only, and makes add/revoke persist-first. `KeysPage` is rewritten to render the real list with an inline add-form and per-row revoke.

**Tech Stack:** React 18 + TypeScript, Supabase JS client, Vitest + Testing Library, pnpm.

## Global Constraints

- **The software must never store an API secret, key, or token.** No schema column, form field, or type may hold a credential. Only non-authenticating metadata: venue, label, an optional short fingerprint, fixed scopes `trade,read`, and a no-withdrawal attestation.
- Repos and hook return a discriminated `{ ok: true; … } | { ok: false; error: string }` result and **never throw to the UI**.
- Import shared types from their single source; do not redefine (`ExchangeKey`/`AddKeyInput` live in `src/lib/clientPortal/exchangeKeysRepo.ts`).
- Design tokens only — no raw zinc/hex. Use the existing token classes (`bg-bg-surface-*`, `text-text-*`, `border-border-*`, `text-status-*`, `bg-accent-500`, `type-*`).
- No new dependencies; no dependency-version changes (Vitest pinned; Vite stays v5).
- Tests run with `pnpm vitest run <path>`; full verification also runs `pnpm tsc --noEmit` and `pnpm build`.
- Migrations are written here but **applied by the user** — no task runs SQL against a live DB.
- The append-only log has **no update or delete** — a revoke is a new `action:'revoke'` row.

---

### Task 1: Migration + `exchangeKeysRepo`

Creates the table migration and the repo (pure `parseEventRow` + `deriveActiveKeys` fold, plus `fetchActiveKeys`/`addExchangeKey`/`revokeExchangeKey`). The migration is scaffolding the repo consumes, so it lives here.

**Files:**
- Create: `supabase/migrations/20260805_add_exchange_key_events.sql`
- Create: `src/lib/clientPortal/exchangeKeysRepo.ts`
- Test: `src/lib/clientPortal/__tests__/exchangeKeysRepo.test.ts`

**Interfaces:**
- Consumes: `SupabaseClient` from `@supabase/supabase-js`; `crypto.randomUUID()` (global).
- Produces:
  - Types `ExchangeKeyEvent`, `ExchangeKey`, `AddKeyInput` (exact shapes in Step 4).
  - `parseEventRow(row: unknown): ExchangeKeyEvent | null`
  - `deriveActiveKeys(events: ExchangeKeyEvent[]): ExchangeKey[]`
  - `fetchActiveKeys(supabase, clientName): Promise<{ ok: true; keys: ExchangeKey[] } | { ok: false; error: string }>`
  - `addExchangeKey(supabase, clientName, input: AddKeyInput): Promise<{ ok: true; keyRef: string } | { ok: false; error: string }>`
  - `revokeExchangeKey(supabase, clientName, keyRef: string): Promise<{ ok: true } | { ok: false; error: string }>`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260805_add_exchange_key_events.sql`:

```sql
-- Append-only client exchange-key lifecycle events (add / revoke). NEVER stores an API secret —
-- only non-authenticating metadata the client chooses to record. Same per-client RLS + admin-read pattern.
create table if not exists public.exchange_key_events (
  id            uuid primary key default gen_random_uuid(),
  client_name   text not null,
  created_by    uuid default auth.uid(),
  key_ref       uuid not null,
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

- [ ] **Step 2: Write the failing test**

Create `src/lib/clientPortal/__tests__/exchangeKeysRepo.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  parseEventRow, deriveActiveKeys, fetchActiveKeys, addExchangeKey, revokeExchangeKey,
  type ExchangeKeyEvent,
} from '../exchangeKeysRepo'

function mockClient(over: { selectData?: unknown[]; selectError?: { message: string } | null; insertError?: { message: string } | null }) {
  const q = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: over.selectData ?? [], error: over.selectError ?? null }),
    insert: vi.fn().mockResolvedValue({ error: over.insertError ?? null }),
  }
  const from = vi.fn().mockReturnValue(q)
  return { client: { from } as unknown as SupabaseClient, from, q }
}

function ev(over: Partial<ExchangeKeyEvent> & { keyRef: string; action: 'add' | 'revoke'; ts: string }): ExchangeKeyEvent {
  return { venue: 'Deribit', label: 'main', fingerprint: null, scopes: 'trade,read', noWithdrawal: true, ...over }
}

describe('parseEventRow', () => {
  it('maps a well-formed add row', () => {
    expect(parseEventRow({ key_ref: 'r1', action: 'add', venue: 'Deribit', label: 'main', fingerprint: 'ab12cd', scopes: 'trade,read', no_withdrawal: true, ts: 't1' }))
      .toEqual({ keyRef: 'r1', action: 'add', venue: 'Deribit', label: 'main', fingerprint: 'ab12cd', scopes: 'trade,read', noWithdrawal: true, ts: 't1' })
  })
  it('returns null when key_ref/ts missing or action invalid', () => {
    expect(parseEventRow({ action: 'add', ts: 't' })).toBeNull()
    expect(parseEventRow({ key_ref: 'r', action: 'add' })).toBeNull()
    expect(parseEventRow({ key_ref: 'r', action: 'nope', ts: 't' })).toBeNull()
    expect(parseEventRow(null)).toBeNull()
  })
  it('coerces non-string metadata to null', () => {
    const r = parseEventRow({ key_ref: 'r', action: 'revoke', ts: 't', venue: 5, no_withdrawal: 'yes' })
    expect(r).toEqual({ keyRef: 'r', action: 'revoke', venue: null, label: null, fingerprint: null, scopes: null, noWithdrawal: null, ts: 't' })
  })
})

describe('deriveActiveKeys', () => {
  it('an add yields one active key', () => {
    const keys = deriveActiveKeys([ev({ keyRef: 'a', action: 'add', ts: '1' })])
    expect(keys.map((k) => k.keyRef)).toEqual(['a'])
  })
  it('an add then revoke of the same key_ref yields none', () => {
    const keys = deriveActiveKeys([ev({ keyRef: 'a', action: 'add', ts: '1' }), ev({ keyRef: 'a', action: 'revoke', ts: '2' })])
    expect(keys).toEqual([])
  })
  it('a revoke with no prior add is ignored', () => {
    expect(deriveActiveKeys([ev({ keyRef: 'a', action: 'revoke', ts: '1' })])).toEqual([])
  })
  it('two distinct key_refs are independent', () => {
    const keys = deriveActiveKeys([ev({ keyRef: 'a', action: 'add', ts: '1' }), ev({ keyRef: 'b', action: 'add', ts: '2' }), ev({ keyRef: 'a', action: 'revoke', ts: '3' })])
    expect(keys.map((k) => k.keyRef)).toEqual(['b'])
  })
  it('a re-add after revoke is active again', () => {
    const keys = deriveActiveKeys([ev({ keyRef: 'a', action: 'add', ts: '1' }), ev({ keyRef: 'a', action: 'revoke', ts: '2' }), ev({ keyRef: 'a', action: 'add', ts: '3', label: 'again' })])
    expect(keys.map((k) => k.keyRef)).toEqual(['a'])
    expect(keys[0].label).toBe('again')
  })
  it('folds in ts order regardless of input order', () => {
    const keys = deriveActiveKeys([ev({ keyRef: 'a', action: 'revoke', ts: '2' }), ev({ keyRef: 'a', action: 'add', ts: '1' })])
    expect(keys).toEqual([])
  })
})

describe('fetchActiveKeys', () => {
  it('folds the client rows to the active set', async () => {
    const { client, from, q } = mockClient({ selectData: [
      { key_ref: 'a', action: 'add', venue: 'Deribit', label: 'main', fingerprint: null, scopes: 'trade,read', no_withdrawal: true, ts: '1' },
      { key_ref: 'a', action: 'revoke', ts: '2' },
      { key_ref: 'b', action: 'add', venue: 'Coincall', label: 'cc', fingerprint: null, scopes: 'trade,read', no_withdrawal: true, ts: '3' },
    ] })
    const r = await fetchActiveKeys(client, 'TwoPrime')
    expect(from).toHaveBeenCalledWith('exchange_key_events')
    expect(q.eq).toHaveBeenCalledWith('client_name', 'TwoPrime')
    expect(q.order).toHaveBeenCalledWith('ts', { ascending: true })
    expect(r).toEqual({ ok: true, keys: [{ keyRef: 'b', venue: 'Coincall', label: 'cc', fingerprint: null, scopes: 'trade,read', noWithdrawal: true, ts: '3' }] })
  })
  it('drops a malformed row rather than erroring', async () => {
    const { client } = mockClient({ selectData: [{ nonsense: true }, { key_ref: 'a', action: 'add', venue: 'Deribit', label: 'm', fingerprint: null, scopes: 'trade,read', no_withdrawal: true, ts: '1' }] })
    const r = await fetchActiveKeys(client, 'TwoPrime')
    expect(r).toEqual({ ok: true, keys: [{ keyRef: 'a', venue: 'Deribit', label: 'm', fingerprint: null, scopes: 'trade,read', noWithdrawal: true, ts: '1' }] })
  })
  it('returns an error result on query failure', async () => {
    const { client } = mockClient({ selectData: [], selectError: { message: 'boom' } })
    expect(await fetchActiveKeys(client, 'TwoPrime')).toEqual({ ok: false, error: 'boom' })
  })
})

describe('addExchangeKey', () => {
  it('inserts an add row with metadata + fixed scopes and returns the keyRef', async () => {
    const { client, q } = mockClient({})
    const r = await addExchangeKey(client, 'TwoPrime', { venue: 'Deribit', label: 'main', fingerprint: 'ab12cd', noWithdrawal: true })
    expect(r.ok).toBe(true)
    const keyRef = r.ok ? r.keyRef : ''
    expect(typeof keyRef).toBe('string')
    expect(keyRef.length).toBeGreaterThan(0)
    expect(q.insert).toHaveBeenCalledWith({
      client_name: 'TwoPrime', key_ref: keyRef, action: 'add',
      venue: 'Deribit', label: 'main', fingerprint: 'ab12cd', scopes: 'trade,read', no_withdrawal: true,
    })
  })
  it('returns an error result on insert failure', async () => {
    const { client } = mockClient({ insertError: { message: 'denied' } })
    expect(await addExchangeKey(client, 'TwoPrime', { venue: 'Deribit', label: 'x', fingerprint: null, noWithdrawal: true })).toEqual({ ok: false, error: 'denied' })
  })
})

describe('revokeExchangeKey', () => {
  it('inserts a revoke row for the key_ref', async () => {
    const { client, q } = mockClient({})
    const r = await revokeExchangeKey(client, 'TwoPrime', 'r1')
    expect(q.insert).toHaveBeenCalledWith({ client_name: 'TwoPrime', key_ref: 'r1', action: 'revoke' })
    expect(r).toEqual({ ok: true })
  })
  it('returns an error result on insert failure', async () => {
    const { client } = mockClient({ insertError: { message: 'denied' } })
    expect(await revokeExchangeKey(client, 'TwoPrime', 'r1')).toEqual({ ok: false, error: 'denied' })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/clientPortal/__tests__/exchangeKeysRepo.test.ts`
Expected: FAIL — `exchangeKeysRepo` module / exports not found.

- [ ] **Step 4: Write the repo implementation**

Create `src/lib/clientPortal/exchangeKeysRepo.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export type ExchangeKeyEvent = {
  keyRef: string
  action: 'add' | 'revoke'
  venue: string | null
  label: string | null
  fingerprint: string | null
  scopes: string | null
  noWithdrawal: boolean | null
  ts: string
}

export type ExchangeKey = {
  keyRef: string
  venue: string | null
  label: string | null
  fingerprint: string | null
  scopes: string | null
  noWithdrawal: boolean | null
  ts: string
}

export type AddKeyInput = { venue: string; label: string; fingerprint: string | null; noWithdrawal: boolean }

export type FetchKeysResult = { ok: true; keys: ExchangeKey[] } | { ok: false; error: string }
export type AddKeyResult = { ok: true; keyRef: string } | { ok: false; error: string }
export type RevokeKeyResult = { ok: true } | { ok: false; error: string }

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

// Validating map of an untyped row. Returns null on a malformed/legacy row so callers can drop it
// from the fold rather than crash.
export function parseEventRow(row: unknown): ExchangeKeyEvent | null {
  if (typeof row !== 'object' || row === null) return null
  const o = row as Record<string, unknown>
  if (typeof o.key_ref !== 'string') return null
  if (typeof o.ts !== 'string') return null
  if (o.action !== 'add' && o.action !== 'revoke') return null
  return {
    keyRef: o.key_ref,
    action: o.action,
    venue: asString(o.venue),
    label: asString(o.label),
    fingerprint: asString(o.fingerprint),
    scopes: asString(o.scopes),
    noWithdrawal: typeof o.no_withdrawal === 'boolean' ? o.no_withdrawal : null,
    ts: o.ts,
  }
}

// Folds an event stream to the current active-key set: process events in ts order, latest action per
// key_ref wins, keep only key_refs whose latest action is 'add', carrying that add's metadata.
export function deriveActiveKeys(events: ExchangeKeyEvent[]): ExchangeKey[] {
  const ordered = [...events].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
  const latestByRef = new Map<string, ExchangeKeyEvent>()
  for (const e of ordered) latestByRef.set(e.keyRef, e)
  const active: ExchangeKey[] = []
  for (const e of latestByRef.values()) {
    if (e.action !== 'add') continue
    active.push({ keyRef: e.keyRef, venue: e.venue, label: e.label, fingerprint: e.fingerprint, scopes: e.scopes, noWithdrawal: e.noWithdrawal, ts: e.ts })
  }
  active.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
  return active
}

export async function fetchActiveKeys(supabase: SupabaseClient, clientName: string): Promise<FetchKeysResult> {
  const { data, error } = await supabase
    .from('exchange_key_events')
    .select('key_ref, action, venue, label, fingerprint, scopes, no_withdrawal, ts')
    .eq('client_name', clientName)
    .order('ts', { ascending: true })
  if (error) return { ok: false, error: error.message }
  const events = (data ?? []).map(parseEventRow).filter((e): e is ExchangeKeyEvent => e !== null)
  return { ok: true, keys: deriveActiveKeys(events) }
}

export async function addExchangeKey(supabase: SupabaseClient, clientName: string, input: AddKeyInput): Promise<AddKeyResult> {
  const keyRef = crypto.randomUUID()
  const { error } = await supabase.from('exchange_key_events').insert({
    client_name: clientName, key_ref: keyRef, action: 'add',
    venue: input.venue, label: input.label, fingerprint: input.fingerprint,
    scopes: 'trade,read', no_withdrawal: input.noWithdrawal,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, keyRef }
}

export async function revokeExchangeKey(supabase: SupabaseClient, clientName: string, keyRef: string): Promise<RevokeKeyResult> {
  const { error } = await supabase.from('exchange_key_events').insert({
    client_name: clientName, key_ref: keyRef, action: 'revoke',
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/lib/clientPortal/__tests__/exchangeKeysRepo.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260805_add_exchange_key_events.sql src/lib/clientPortal/exchangeKeysRepo.ts src/lib/clientPortal/__tests__/exchangeKeysRepo.test.ts
git commit -m "feat(portal): exchange_key_events migration + exchangeKeysRepo (append-only add/revoke fold)"
```

---

### Task 2: Extend `useSetupPersistence`

Adds the active-keys fetch to the parallel load and exposes `activeKeys` + `addExchangeKey`/`revokeExchangeKey`. Also adds the three new fields to the shell-test's shared persistence mock so `pnpm tsc` stays green (the shell consumes the hook's return type).

**Files:**
- Modify: `src/features/clientPortal/useSetupPersistence.ts`
- Test: `src/features/clientPortal/__tests__/useSetupPersistence.test.tsx`
- Modify (tsc-required collateral): `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`

**Interfaces:**
- Consumes: `fetchActiveKeys`, `addExchangeKey`, `revokeExchangeKey`, `ExchangeKey`, `AddKeyInput` from `@/lib/clientPortal/exchangeKeysRepo` (Task 1).
- Produces: the hook return object gains `activeKeys: ExchangeKey[]`, `addExchangeKey(input: AddKeyInput): Promise<{ ok: boolean; error?: string; keyRef?: string }>`, and `revokeExchangeKey(keyRef: string): Promise<{ ok: boolean; error?: string }>`.

- [ ] **Step 1: Add the failing test cases**

In `src/features/clientPortal/__tests__/useSetupPersistence.test.tsx`, add a repo mock alongside the existing `vi.mock` calls:

```ts
vi.mock('@/lib/clientPortal/exchangeKeysRepo', () => ({
  fetchActiveKeys: vi.fn(), addExchangeKey: vi.fn(), revokeExchangeKey: vi.fn(),
}))
```

Add imports alongside the existing repo imports:

```ts
import { fetchActiveKeys, addExchangeKey as addKeyRepo, revokeExchangeKey as revokeKeyRepo } from '@/lib/clientPortal/exchangeKeysRepo'
```

Add mocked handles next to the existing ones:

```ts
const fKeys = vi.mocked(fetchActiveKeys)
const aKey = vi.mocked(addKeyRepo)
const rKey = vi.mocked(revokeKeyRepo)
```

In the existing `beforeEach`, add default resolutions:

```ts
  fKeys.mockResolvedValue({ ok: true, keys: [] })
  aKey.mockResolvedValue({ ok: true, keyRef: 'kref-1' })
  rKey.mockResolvedValue({ ok: true })
```

Add these test cases inside the `describe('useSetupPersistence', …)` block:

```ts
  it('seeds activeKeys from a fetched fold', async () => {
    fKeys.mockResolvedValue({ ok: true, keys: [{ keyRef: 'a', venue: 'Deribit', label: 'main', fingerprint: null, scopes: 'trade,read', noWithdrawal: true, ts: '1' }] })
    const { result } = renderHook(() => useSetupPersistence('TwoPrime'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.activeKeys.map((k) => k.keyRef)).toEqual(['a'])
  })

  it('addExchangeKey delegates to the repo and returns its result', async () => {
    const { result } = renderHook(() => useSetupPersistence('TwoPrime'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    const r = await result.current.addExchangeKey({ venue: 'Deribit', label: 'main', fingerprint: null, noWithdrawal: true })
    expect(aKey).toHaveBeenCalledWith(expect.anything(), 'TwoPrime', { venue: 'Deribit', label: 'main', fingerprint: null, noWithdrawal: true })
    expect(r).toEqual({ ok: true, keyRef: 'kref-1' })
  })

  it('revokeExchangeKey delegates to the repo and returns its result', async () => {
    const { result } = renderHook(() => useSetupPersistence('TwoPrime'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    const r = await result.current.revokeExchangeKey('a')
    expect(rKey).toHaveBeenCalledWith(expect.anything(), 'TwoPrime', 'a')
    expect(r).toEqual({ ok: true })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/clientPortal/__tests__/useSetupPersistence.test.tsx`
Expected: FAIL — `activeKeys`/`addExchangeKey`/`revokeExchangeKey` undefined on the hook result.

- [ ] **Step 3: Implement the hook changes**

In `src/features/clientPortal/useSetupPersistence.ts`, add imports:

```ts
import { fetchActiveKeys, addExchangeKey as addKeyRow, revokeExchangeKey as revokeKeyRow, type ExchangeKey, type AddKeyInput } from '@/lib/clientPortal/exchangeKeysRepo'
```

Add state alongside the existing `useState` declarations:

```ts
  const [activeKeys, setActiveKeys] = React.useState<ExchangeKey[]>([])
```

In the load effect, add the fetch to the `Promise.all` and seed. Replace the existing `Promise.all` block with:

```ts
      const [appr, strat, risk, keys] = await Promise.all([
        fetchLatestAppropriateness(supabase, clientName),
        fetchLatestStrategy(supabase, clientName),
        fetchLatestRiskLimits(supabase, clientName),
        fetchActiveKeys(supabase, clientName),
      ])
      if (ignore) return
      if (appr.ok && appr.record) setAppropriatenessSigned(true)
      if (strat.ok && strat.module) setSelectedStrategy(strat.module)
      if (risk.ok && risk.limits) setSavedRiskLimits(risk.limits)
      if (keys.ok) setActiveKeys(keys.keys)
      setLoaded(true)
```

Add the two callbacks after `saveRiskLimits`:

```ts
  const addExchangeKey = React.useCallback(async (input: AddKeyInput): Promise<{ ok: boolean; error?: string; keyRef?: string }> => {
    if (!hasSupabaseClient()) return { ok: true, keyRef: crypto.randomUUID() }
    const r = await addKeyRow(getSupabaseClient(), clientName, input)
    return r.ok ? { ok: true, keyRef: r.keyRef } : { ok: false, error: r.error }
  }, [clientName])

  const revokeExchangeKey = React.useCallback(async (keyRef: string): Promise<SaveResult> => {
    if (!hasSupabaseClient()) return { ok: true }
    const r = await revokeKeyRow(getSupabaseClient(), clientName, keyRef)
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }, [clientName])
```

Add all three to the returned object:

```ts
  return { loaded, appropriatenessSigned, selectedStrategy, savedRiskLimits, activeKeys, saveAppropriateness, saveStrategy, saveRiskLimits, addExchangeKey, revokeExchangeKey }
```

- [ ] **Step 4: Update the shell-test mock so tsc stays green**

In `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`, add the three new fields to `baseSetupPersistence` (the mock's return type must match the hook's new return type):

```ts
const baseSetupPersistence = {
  loaded: true, appropriatenessSigned: false, selectedStrategy: null, savedRiskLimits: null, activeKeys: [],
  saveAppropriateness: vi.fn(async () => ({ ok: true })),
  saveStrategy: vi.fn(async () => ({ ok: true })),
  saveRiskLimits: vi.fn(async () => ({ ok: true })),
  addExchangeKey: vi.fn(async () => ({ ok: true, keyRef: 'k-new' })),
  revokeExchangeKey: vi.fn(async () => ({ ok: true })),
}
```

Also add the same three fields to the two existing per-test overrides in this file (the "seeds the appropriateness precondition" test and the "shows an error banner and does not sign" test) — add these lines to each override object literal so it stays shape-complete:

```ts
      activeKeys: [],
      addExchangeKey: vi.fn(async () => ({ ok: true, keyRef: 'k-new' })),
      revokeExchangeKey: vi.fn(async () => ({ ok: true })),
```

> Do not change the shell code or other shell tests in this task — only the mock shape. The shell still renders `KeysPage` with its old props until Task 4; that is fine because `activeKeys`/`addExchangeKey`/`revokeExchangeKey` are unused by the shell until then.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/features/clientPortal/__tests__/useSetupPersistence.test.tsx && pnpm vitest run src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`
Expected: PASS (new hook cases + existing hook cases; shell tests still green).

- [ ] **Step 6: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/features/clientPortal/useSetupPersistence.ts src/features/clientPortal/__tests__/useSetupPersistence.test.tsx src/features/clientPortal/__tests__/ClientPortalShell.test.tsx
git commit -m "feat(portal): useSetupPersistence exposes activeKeys + add/revoke exchange keys"
```

---

### Task 3: Rewrite `KeysPage` (real list + add form + revoke)

Replaces the presentational sample rows with the real persisted list, an inline add-form, and per-row revoke. Pure presentational component driven by props — reviewed independently of the shell wiring.

**Files:**
- Modify: `src/features/clientPortal/pages/KeysPage.tsx` (full rewrite)
- Test: `src/features/clientPortal/__tests__/KeysPage.test.tsx` (rewrite)

**Interfaces:**
- Consumes: `ExchangeKey`, `AddKeyInput` from `@/lib/clientPortal/exchangeKeysRepo` (Task 1).
- Produces: `KeysPage` with props `{ keys: ExchangeKey[]; onAddKey: (input: AddKeyInput) => void; onRevokeKey: (keyRef: string) => void }`.

- [ ] **Step 1: Rewrite the test**

Replace the contents of `src/features/clientPortal/__tests__/KeysPage.test.tsx` with:

```ts
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KeysPage } from '../pages/KeysPage'
import type { ExchangeKey } from '@/lib/clientPortal/exchangeKeysRepo'

const KEY: ExchangeKey = { keyRef: 'r1', venue: 'Deribit', label: 'Deribit — main', fingerprint: 'ab12cd', scopes: 'trade,read', noWithdrawal: true, ts: '2026-08-01T00:00:00Z' }

describe('KeysPage', () => {
  it('states no-withdrawal and shows an empty state with no keys', () => {
    render(<KeysPage keys={[]} onAddKey={() => {}} onRevokeKey={() => {}} />)
    expect(screen.getByText(/never holds withdrawal/i)).toBeInTheDocument()
    expect(screen.getByText(/no keys registered yet/i)).toBeInTheDocument()
  })

  it('disables Add until a label is entered and no-withdrawal is attested, then submits the metadata', async () => {
    const onAddKey = vi.fn()
    render(<KeysPage keys={[]} onAddKey={onAddKey} onRevokeKey={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /add key/i }))
    const add = screen.getByRole('button', { name: /^add$/i })
    expect(add).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Label'), 'Deribit — main')
    expect(add).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox'))
    expect(add).toBeEnabled()
    await userEvent.click(add)
    expect(onAddKey).toHaveBeenCalledWith({ venue: 'Deribit', label: 'Deribit — main', fingerprint: null, noWithdrawal: true })
  })

  it('renders an active key and revokes it by keyRef', async () => {
    const onRevokeKey = vi.fn()
    render(<KeysPage keys={[KEY]} onAddKey={() => {}} onRevokeKey={onRevokeKey} />)
    expect(screen.getByText('Deribit — main')).toBeInTheDocument()
    expect(screen.getByText(/1 active/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /revoke/i }))
    expect(onRevokeKey).toHaveBeenCalledWith('r1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/clientPortal/__tests__/KeysPage.test.tsx`
Expected: FAIL — new props/form/empty-state not present.

- [ ] **Step 3: Rewrite the component**

Replace the contents of `src/features/clientPortal/pages/KeysPage.tsx` with:

```tsx
import React from 'react'
import { Plus, Info } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { ExchangeKey, AddKeyInput } from '@/lib/clientPortal/exchangeKeysRepo'

const VENUES = ['Deribit', 'Coincall', 'Bullish', 'CME'] as const

function Scope({ children, deny }: { children: React.ReactNode; deny?: boolean }) {
  return <span className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] ${deny ? 'bg-status-danger/15 text-status-danger' : 'bg-status-success/15 text-status-success'}`}>{children}</span>
}

function KeyRow({ k, onRevoke }: { k: ExchangeKey; onRevoke: () => void }) {
  const tag = (k.venue ?? '—').slice(0, 3).toUpperCase()
  return (
    <div className="flex flex-wrap items-center gap-3.5 border-t border-border-default py-3.5 first:border-t-0">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-bg-surface-3 font-mono text-[11px] font-bold text-text-secondary">{tag}</div>
      <div className="min-w-0 flex-1">
        <div className="type-subhead font-semibold text-text-primary">{k.label ?? 'Unnamed key'}</div>
        {k.fingerprint && <div className="font-mono type-caption text-text-tertiary">key ····{k.fingerprint}</div>}
        <div className="mt-1.5 flex flex-wrap gap-1.5"><Scope>trade</Scope><Scope>read</Scope><Scope deny>no withdrawal</Scope></div>
      </div>
      <Button variant="danger" size="sm" onClick={onRevoke}>Revoke</Button>
    </div>
  )
}

export function KeysPage({ keys, onAddKey, onRevokeKey }: {
  keys: ExchangeKey[]; onAddKey: (input: AddKeyInput) => void; onRevokeKey: (keyRef: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [venue, setVenue] = React.useState<string>(VENUES[0])
  const [label, setLabel] = React.useState('')
  const [fingerprint, setFingerprint] = React.useState('')
  const [noWithdrawal, setNoWithdrawal] = React.useState(false)
  const canAdd = label.trim().length > 0 && noWithdrawal

  const submit = () => {
    if (!canAdd) return
    onAddKey({ venue, label: label.trim(), fingerprint: fingerprint.trim() || null, noWithdrawal: true })
    setLabel(''); setFingerprint(''); setNoWithdrawal(false); setOpen(false)
  }

  const field = 'rounded-lg border border-border-default bg-bg-surface-2 px-3 py-2 type-caption text-text-primary placeholder:text-text-faint'
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="type-title-l font-bold text-text-primary">Exchange API keys</h1>
        <span className={`rounded-full px-2.5 py-1 type-caption font-semibold ${keys.length > 0 ? 'bg-status-success/15 text-status-success' : 'bg-bg-surface-2 text-text-tertiary'}`}>{keys.length > 0 ? `${keys.length} active` : 'No trading key'}</span>
        <div className="ml-auto"><Button variant="secondary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setOpen((o) => !o)}>Add key</Button></div>
      </div>
      <p className="type-subhead text-text-secondary">You create these keys on the venue and control them here. The software never holds withdrawal permission and cannot move funds.</p>

      {open && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border-default bg-bg-surface-1 p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 type-caption text-text-tertiary">Venue
              <select className={field} value={venue} onChange={(e) => setVenue(e.target.value)}>
                {VENUES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 type-caption text-text-tertiary">Label
              <input className={field} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Deribit — main" />
            </label>
            <label className="flex flex-col gap-1 type-caption text-text-tertiary">Fingerprint (optional)
              <input className={field} value={fingerprint} onChange={(e) => setFingerprint(e.target.value)} placeholder="last 6 chars" />
            </label>
          </div>
          <label className="flex items-center gap-2 type-caption text-text-secondary">
            <input type="checkbox" checked={noWithdrawal} onChange={(e) => setNoWithdrawal(e.target.checked)} />
            No withdrawal permission on this key
          </label>
          <div className="flex justify-end">
            <Button variant="primary" size="sm" disabled={!canAdd} onClick={submit}>Add</Button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-5">
        {keys.length === 0 ? (
          <div className="py-6 text-center type-caption text-text-tertiary">No keys registered yet.</div>
        ) : (
          keys.map((k) => <KeyRow key={k.keyRef} k={k} onRevoke={() => onRevokeKey(k.keyRef)} />)
        )}
        <div className="mt-3.5 flex items-start gap-2 type-caption text-text-tertiary">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-faint" />
          Keys are generated by you on the venue. Revoking a key here and on the venue immediately halts all execution.
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/features/clientPortal/__tests__/KeysPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors (the shell still passes its OLD props to `KeysPage`, so tsc will FAIL here until Task 4 — if it fails only on `ClientPortalShell.tsx` line rendering `KeysPage`, that is expected and fixed in Task 4).

> Note: because `KeysPage`'s props changed, `pnpm tsc` will report an error on `ClientPortalShell.tsx`'s `<KeysPage hasActiveKey=… onAddKey=… />` render until Task 4 updates it. That single expected error is acceptable at this task boundary; the KeysPage unit test passes. Do not "fix" it by touching the shell here — Task 4 owns that change. Commit this task with the KeysPage test green.

- [ ] **Step 6: Commit**

```bash
git add src/features/clientPortal/pages/KeysPage.tsx src/features/clientPortal/__tests__/KeysPage.test.tsx
git commit -m "feat(portal): KeysPage renders real key list with add-form + per-row revoke"
```

---

### Task 4: Wire the shell — null-sentinel key list, seeding, persist-first add/revoke

Holds the key list as a `null`-sentinel, seeds it promote-only, makes add/revoke persist-first, renders `KeysPage` with the new props, and updates the shell tests (including the E2E activation flow to drive the new form). This task restores `pnpm tsc` and `pnpm build` to green.

**Files:**
- Modify: `src/features/clientPortal/ClientPortalShell.tsx`
- Test: `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`

**Interfaces:**
- Consumes: `activeKeys`, `addExchangeKey`, `revokeExchangeKey` from `useSetupPersistence` (Task 2); `ExchangeKey`, `AddKeyInput` from `@/lib/clientPortal/exchangeKeysRepo`; the rewritten `KeysPage` props (Task 3).
- Produces: no new exports; behavior change (persisted, restored, revocable key set).

- [ ] **Step 1: Add/adjust the failing shell tests**

In `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`:

First, **update the E2E activation test's keys step** to drive the new form. Replace this line:

```ts
    rerender(<ClientPortalShell {...base} hash="#/portal/keys" />)
    await userEvent.click(screen.getByRole('button', { name: /add key/i }))
```

with:

```ts
    rerender(<ClientPortalShell {...base} hash="#/portal/keys" />)
    await userEvent.click(screen.getByRole('button', { name: /add key/i }))
    await userEvent.type(screen.getByLabelText('Label'), 'Deribit — main')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))
```

Then add these two new test cases inside the `describe('ClientPortalShell', …)` block:

```ts
  it('seeds the trading-key precondition and list from persisted keys on load', async () => {
    vi.mocked(useSetupPersistence).mockReturnValue({
      ...baseSetupPersistence,
      activeKeys: [{ keyRef: 'r1', venue: 'Deribit', label: 'Seeded — main', fingerprint: null, scopes: 'trade,read', noWithdrawal: true, ts: '1' }],
    })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/keys" onSignOut={() => {}} />)
    await screen.findByText('Seeded — main')
    const activate = screen.getByRole('button', { name: /^activate$/i })
    expect(activate.getAttribute('title') ?? '').not.toMatch(/trading api key/i)
  })

  it('shows an error banner and does not flip the trading-key precondition when the add fails', async () => {
    vi.mocked(useSetupPersistence).mockReturnValue({
      ...baseSetupPersistence,
      addExchangeKey: vi.fn(async () => ({ ok: false, error: 'key save failed' })),
    })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/keys" onSignOut={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /add key/i }))
    await userEvent.type(screen.getByLabelText('Label'), 'Deribit — main')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))
    expect(await screen.findByText(/key save failed/i)).toBeInTheDocument()
    const activate = screen.getByRole('button', { name: /^activate$/i })
    expect(activate.getAttribute('title') ?? '').toMatch(/trading api key/i)
  })

  it('revoking the last active key demotes the trading-key precondition', async () => {
    vi.mocked(useSetupPersistence).mockReturnValue({
      ...baseSetupPersistence,
      activeKeys: [{ keyRef: 'r1', venue: 'Deribit', label: 'Only — key', fingerprint: null, scopes: 'trade,read', noWithdrawal: true, ts: '1' }],
      revokeExchangeKey: vi.fn(async () => ({ ok: true })),
    })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/keys" onSignOut={() => {}} />)
    const activateBefore = screen.getByRole('button', { name: /^activate$/i })
    expect(activateBefore.getAttribute('title') ?? '').not.toMatch(/trading api key/i)
    await userEvent.click(screen.getByRole('button', { name: /revoke/i }))
    expect(screen.getByText(/no keys registered yet/i)).toBeInTheDocument()
    const activateAfter = screen.getByRole('button', { name: /^activate$/i })
    expect(activateAfter.getAttribute('title') ?? '').toMatch(/trading api key/i)
  })
```

> The activate button's `title` lists outstanding preconditions. Confirm the label used for the trading-key precondition in `ActivationControl`/`setupStatus` (it is rendered from the `tradingKey` precondition); the assertions above match either "exchange" or "trading key" case-insensitively to be robust to the exact wording. If neither substring appears in the outstanding-items label for `tradingKey`, adjust the regex to the actual label text rather than weakening the assertion.

- [ ] **Step 2: Run tests to verify the new cases fail**

Run: `pnpm vitest run src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`
Expected: FAIL — the shell still renders the old `KeysPage` props (no form to type into) and `addTradingKey` is not persist-first.

- [ ] **Step 3: Implement the shell changes**

In `src/features/clientPortal/ClientPortalShell.tsx`:

Add imports near the other `@/lib/clientPortal` / risk imports:

```ts
import type { ExchangeKey, AddKeyInput } from '@/lib/clientPortal/exchangeKeysRepo'
```

Add the null-sentinel state next to `riskLimits` (after line ~46, near `const effectiveLimits = …`):

```ts
  const [exchangeKeys, setExchangeKeys] = React.useState<ExchangeKey[] | null>(null)
  const effectiveKeys = exchangeKeys ?? []
```

Extend the seeding effect to promote the `tradingKey` precondition and seed the list (promote-only). Replace the whole seed effect body with:

```ts
  React.useEffect(() => {
    if (!persistence.loaded) return
    setSetupStatus((s) => ({
      ...s,
      appropriateness: s.appropriateness || persistence.appropriatenessSigned,
      strategy: s.strategy || !!persistence.selectedStrategy,
      riskLimits: s.riskLimits || !!persistence.savedRiskLimits,
      tradingKey: s.tradingKey || persistence.activeKeys.length > 0,
    }))
    if (persistence.selectedStrategy) setStrategy((cur) => cur ?? persistence.selectedStrategy)
    if (persistence.savedRiskLimits) setRiskLimits((cur) => cur ?? persistence.savedRiskLimits)
    if (persistence.activeKeys.length > 0) setExchangeKeys((cur) => cur ?? persistence.activeKeys)
  }, [persistence.loaded, persistence.appropriatenessSigned, persistence.selectedStrategy, persistence.savedRiskLimits, persistence.activeKeys])
```

Replace the synchronous `addTradingKey` with the async persist-first version, and add `revokeKey` right after it:

```ts
  const addTradingKey = React.useCallback(async (input: AddKeyInput) => {
    const r = await persistence.addExchangeKey(input)
    if (!r.ok || !r.keyRef) { setPersistError(r.error ?? 'Could not save your key. Please try again.'); return }
    setPersistError(null)
    const newKey: ExchangeKey = { keyRef: r.keyRef, venue: input.venue, label: input.label, fingerprint: input.fingerprint, scopes: 'trade,read', noWithdrawal: input.noWithdrawal, ts: new Date().toISOString() }
    setExchangeKeys((cur) => [...(cur ?? []), newKey])
    setSetupStatus((s) => ({ ...s, tradingKey: true }))
    appendAudit('API_KEY', `added ${input.venue} key "${input.label}" · scope trade,read · no-withdraw`)
  }, [persistence.addExchangeKey, appendAudit])

  const revokeKey = React.useCallback(async (keyRef: string) => {
    const r = await persistence.revokeExchangeKey(keyRef)
    if (!r.ok) { setPersistError(r.error ?? 'Could not revoke your key. Please try again.'); return }
    setPersistError(null)
    const next = (exchangeKeys ?? []).filter((k) => k.keyRef !== keyRef)
    setExchangeKeys(next)
    setSetupStatus((s) => ({ ...s, tradingKey: next.length > 0 }))
    appendAudit('API_KEY', `revoked exchange key`)
  }, [persistence.revokeExchangeKey, exchangeKeys, appendAudit])
```

Update the `KeysPage` render (currently `<KeysPage hasActiveKey={setupStatus.tradingKey} onAddKey={addTradingKey} />`):

```tsx
          ) : page === 'keys' ? (
            <KeysPage keys={effectiveKeys} onAddKey={addTradingKey} onRevokeKey={revokeKey} />
```

- [ ] **Step 4: Run the shell tests to verify they pass**

Run: `pnpm vitest run src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`
Expected: PASS — new cases plus the updated E2E flow and all existing cases.

- [ ] **Step 5: Full verification**

Run: `pnpm vitest run && pnpm tsc --noEmit && pnpm build`
Expected: all tests pass, no type errors (the Task 3 expected tsc error on the shell is now resolved), build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/features/clientPortal/ClientPortalShell.tsx src/features/clientPortal/__tests__/ClientPortalShell.test.tsx
git commit -m "feat(portal): persist + restore exchange keys; persist-first add/revoke with last-key demote"
```

---

## Self-Review

**Spec coverage:**
- Schema / no-secret guarantee (§1.1, §3) → Task 1 Step 1 (no credential column) ✓
- `parseEventRow` + `deriveActiveKeys` + fetch/add/revoke repo (§4.1) → Task 1 ✓
- Hook `activeKeys` + `addExchangeKey`/`revokeExchangeKey` (§4.2) → Task 2 ✓
- Shell null-sentinel, promote-only seed, persist-first add, persist-first revoke with last-key demote (§4.3) → Task 4 ✓
- KeysPage rewrite: real list, inline add-form (venue/label/fingerprint/required no-withdraw), per-row revoke, empty state, removed sample rows (§4.4) → Task 3 ✓
- Data flow (§4.5) → Tasks 2+4 ✓
- Graceful degradation: unconfigured (hook short-circuit, Task 2 Step 3), fetch error (repo `{ok:false}` → hook ignores), malformed row (`parseEventRow`→null drop, Task 1 test), add/revoke error (inline banner, Task 4) → all covered ✓
- Testing (§5): pure fold/parse, repo fetch/add/revoke/malformed, hook seed/delegate, KeysPage form-gating/add/revoke/empty, shell seed/add-fail/revoke-demote + E2E form update → Tasks 1–4 ✓
- Non-goals (§7): no Updates/Activation/audit-log persistence; no secret handling; no in-place edit; no venue verification — none introduced ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The two ⚠️-style notes (Task 3 Step 5 expected tsc error at the task boundary; Task 4 Step 1 confirm the tradingKey outstanding-label wording) are explicit implementer guidance, not placeholders. ✓

**Type consistency:** `ExchangeKeyEvent`/`ExchangeKey`/`AddKeyInput` defined once in Task 1 and imported everywhere. `fetchActiveKeys`/`addExchangeKey`/`revokeExchangeKey` signatures identical across Task 1 (def), Task 2 (consume/re-expose), and tests. Hook return fields `activeKeys`/`addExchangeKey`/`revokeExchangeKey` identical across Task 2 def, the shell-mock (Task 2 Step 4), and Task 4 consumption. `KeysPage` props `{ keys, onAddKey, onRevokeKey }` identical across Task 3 def and Task 4 render. Shell `addTradingKey` signature changes from `(label: string)` to `(input: AddKeyInput)` — consumed only by `KeysPage.onAddKey`, which matches. ✓
