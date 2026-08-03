# Client Portal Persistence — Slice 1 (Appropriateness + Strategy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the client's appropriateness self-assessment and strategy selection to Supabase (append-only, per-client RLS), so the portal restores those two setup preconditions on next login — with graceful in-session fallback when the DB is unavailable.

**Architecture:** Two append-only tables with per-client RLS. Thin repo helpers (`src/lib/clientPortal/`) return a discriminated `{ ok }` result like the existing `lib/positions` fetch helpers. A `useSetupPersistence(clientName)` hook fetches the latest of each on mount and exposes async `save*` functions. `ClientPortalShell` seeds `setupStatus` from the fetched records and its Sign/Select handlers become async — they `await` an insert, then flip the precondition + append the in-session audit event on success, or show a non-blocking inline error on failure.

**Tech Stack:** React 18 + TypeScript + Vite, Supabase JS, Vitest + Testing Library.

## Global Constraints

- **Per-client RLS** (from spec §2): a client may `select`/`insert` only rows where `client_name = auth.jwt() -> 'user_metadata' ->> 'client_name'`; admin (`auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'`) may `select` all.
- **Append-only**: every sign/selection is a new row; reads take the latest by `ts desc`.
- **Graceful degradation**: `!hasSupabaseClient()` or any fetch/save error must fall back to today's in-session behavior — the portal never hard-breaks.
- `valid_until` = signing time **+ 12 months**.
- Follow the `supabase/migrations/YYYYMMDD_*.sql` convention and the `src/lib/positions/fetch*` `{ ok }`-result repo style. Package manager **pnpm**; path alias `@/` → `src/`.
- **The user applies the migrations** — do not attempt to run them against any DB.
- Do not change `src/DashboardApp.tsx`, `src/App.tsx`, `src/features/auth/access.ts`. Branch: `main`.

---

## File Structure

```
supabase/migrations/
  20260803_add_appropriateness_assessments.sql   # Task 1
  20260803_add_strategy_selections.sql           # Task 1
src/lib/clientPortal/
  strategyRepo.ts                # Task 2 — fetchLatestStrategy, saveStrategy
  appropriatenessRepo.ts         # Task 3 — addMonths, mapRow, fetchLatestAppropriateness, saveAppropriateness
  __tests__/                     # repo tests (mocked Supabase client)
src/features/clientPortal/
  useSetupPersistence.ts         # Task 4 — hook: fetch on mount + async save*
  ClientPortalShell.tsx          # Task 5 — seed setupStatus, async handlers, error banner
  pages/AppropriatenessPage.tsx  # Task 5 — onSign passes { answers, attestations }
  __tests__/                     # hook + shell + appropriateness test updates
docs/client-portal-login-setup.md  # Task 1 — note admin role='admin' requirement
```

---

### Task 1: Migrations + admin-role doc note

**Files:**
- Create: `supabase/migrations/20260803_add_appropriateness_assessments.sql`
- Create: `supabase/migrations/20260803_add_strategy_selections.sql`
- Modify: `docs/client-portal-login-setup.md`

**Interfaces:**
- Produces: tables `public.appropriateness_assessments` (columns `id, client_name, created_by, answers, attestations, signed_name, valid_until, ts`) and `public.strategy_selections` (`id, client_name, created_by, module, ts`), both with per-client RLS + admin-read.

> SQL migrations cannot be unit-tested in this repo (no local Postgres). Verification is a structural grep for the required RLS policies; the user applies the migrations to Supabase.

- [ ] **Step 1: Create the appropriateness migration**

Create `supabase/migrations/20260803_add_appropriateness_assessments.sql`:
```sql
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
```

- [ ] **Step 2: Create the strategy migration**

Create `supabase/migrations/20260803_add_strategy_selections.sql`:
```sql
-- Append-only client strategy-module selections. Same per-client RLS + admin-read pattern.
create table if not exists public.strategy_selections (
  id          uuid primary key default gen_random_uuid(),
  client_name text not null,
  created_by  uuid default auth.uid(),
  module      text not null,
  ts          timestamptz not null default now()
);

create index if not exists strategy_selections_client_idx
  on public.strategy_selections (client_name);
create index if not exists strategy_selections_client_ts_idx
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

- [ ] **Step 3: Add the admin-role note to the login-setup doc**

In `docs/client-portal-login-setup.md`, append a new section at the end:
```markdown
## Admin DB access (client-portal persistence)

Client-portal tables (`appropriateness_assessments`, `strategy_selections`, …) use per-client RLS.
A client can only read/write their own rows. For an **admin** to read all clients' rows via RLS, the
admin user must carry `app_metadata.role = 'admin'` — the `VITE_SUPABASE_ADMIN_EMAILS` allowlist is
browser-only and invisible to Postgres. Set it in the Supabase SQL editor:

​```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where email = 'you@example.com';
​```
```
(Remove the zero-width spaces before the inner code fences when pasting.)

- [ ] **Step 4: Structural verification**

Run: `grep -c "create policy" supabase/migrations/20260803_add_appropriateness_assessments.sql supabase/migrations/20260803_add_strategy_selections.sql`
Expected: each file reports `3` (client-select, client-insert, admin-select).

Run: `grep -l "auth.jwt() -> 'user_metadata' ->> 'client_name'" supabase/migrations/20260803_*.sql | wc -l`
Expected: `2`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260803_add_appropriateness_assessments.sql supabase/migrations/20260803_add_strategy_selections.sql docs/client-portal-login-setup.md
git commit -m "feat(db): add appropriateness + strategy tables with per-client RLS"
```

---

### Task 2: strategyRepo

**Files:**
- Create: `src/lib/clientPortal/strategyRepo.ts`
- Test: `src/lib/clientPortal/__tests__/strategyRepo.test.ts`

**Interfaces:**
- Consumes: `SupabaseClient` type from `@supabase/supabase-js`.
- Produces:
  - `type FetchStrategyResult = { ok: true; module: string | null } | { ok: false; error: string }`
  - `type SaveStrategyResult = { ok: true } | { ok: false; error: string }`
  - `fetchLatestStrategy(supabase: SupabaseClient, clientName: string): Promise<FetchStrategyResult>` — selects `module` from `strategy_selections` where `client_name` = clientName, `order('ts', { ascending: false })`, `limit(1)`; returns the latest module or null.
  - `saveStrategy(supabase: SupabaseClient, clientName: string, module: string): Promise<SaveStrategyResult>` — inserts `{ client_name, module }`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/clientPortal/__tests__/strategyRepo.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchLatestStrategy, saveStrategy } from '../strategyRepo'

function mockClient(over: { selectData?: unknown[]; selectError?: { message: string } | null; insertError?: { message: string } | null }) {
  const q = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: over.selectData ?? [], error: over.selectError ?? null }),
    insert: vi.fn().mockResolvedValue({ error: over.insertError ?? null }),
  }
  const from = vi.fn().mockReturnValue(q)
  return { client: { from } as unknown as SupabaseClient, from, q }
}

describe('fetchLatestStrategy', () => {
  it('returns the latest module scoped + ordered by the client', async () => {
    const { client, from, q } = mockClient({ selectData: [{ module: 'Range Condor' }] })
    const r = await fetchLatestStrategy(client, 'TwoPrime')
    expect(from).toHaveBeenCalledWith('strategy_selections')
    expect(q.eq).toHaveBeenCalledWith('client_name', 'TwoPrime')
    expect(q.order).toHaveBeenCalledWith('ts', { ascending: false })
    expect(q.limit).toHaveBeenCalledWith(1)
    expect(r).toEqual({ ok: true, module: 'Range Condor' })
  })
  it('returns null when there is no selection', async () => {
    const { client } = mockClient({ selectData: [] })
    expect(await fetchLatestStrategy(client, 'TwoPrime')).toEqual({ ok: true, module: null })
  })
  it('returns an error result on query failure', async () => {
    const { client } = mockClient({ selectData: [], selectError: { message: 'boom' } })
    expect(await fetchLatestStrategy(client, 'TwoPrime')).toEqual({ ok: false, error: 'boom' })
  })
})

describe('saveStrategy', () => {
  it('inserts the selection and returns ok', async () => {
    const { client, q } = mockClient({})
    const r = await saveStrategy(client, 'TwoPrime', 'Range Condor')
    expect(q.insert).toHaveBeenCalledWith({ client_name: 'TwoPrime', module: 'Range Condor' })
    expect(r).toEqual({ ok: true })
  })
  it('returns an error result on insert failure', async () => {
    const { client } = mockClient({ insertError: { message: 'denied' } })
    expect(await saveStrategy(client, 'TwoPrime', 'X')).toEqual({ ok: false, error: 'denied' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test strategyRepo`
Expected: FAIL — cannot find module `../strategyRepo`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/clientPortal/strategyRepo.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export type FetchStrategyResult = { ok: true; module: string | null } | { ok: false; error: string }
export type SaveStrategyResult = { ok: true } | { ok: false; error: string }

export async function fetchLatestStrategy(supabase: SupabaseClient, clientName: string): Promise<FetchStrategyResult> {
  const { data, error } = await supabase
    .from('strategy_selections')
    .select('module')
    .eq('client_name', clientName)
    .order('ts', { ascending: false })
    .limit(1)
  if (error) return { ok: false, error: error.message }
  const module = data && data.length > 0 ? (data[0] as { module: string }).module : null
  return { ok: true, module }
}

export async function saveStrategy(supabase: SupabaseClient, clientName: string, module: string): Promise<SaveStrategyResult> {
  const { error } = await supabase.from('strategy_selections').insert({ client_name: clientName, module })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test strategyRepo`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clientPortal/strategyRepo.ts src/lib/clientPortal/__tests__/strategyRepo.test.ts
git commit -m "feat(portal): add strategy selection repo"
```

---

### Task 3: appropriatenessRepo

**Files:**
- Create: `src/lib/clientPortal/appropriatenessRepo.ts`
- Test: `src/lib/clientPortal/__tests__/appropriatenessRepo.test.ts`

**Interfaces:**
- Produces:
  - `type AppropriatenessRecord = { signedName: string | null; validUntil: string | null; ts: string }`
  - `type AppropriatenessInput = { answers: unknown; attestations: unknown; signedName: string }`
  - `type FetchApprResult = { ok: true; record: AppropriatenessRecord | null } | { ok: false; error: string }`
  - `type SaveApprResult = { ok: true; record: AppropriatenessRecord } | { ok: false; error: string }`
  - `addMonths(iso: string, months: number): string` — pure; returns ISO string `months` after `iso`.
  - `mapRow(row: { signed_name: string | null; valid_until: string | null; ts: string }): AppropriatenessRecord`
  - `fetchLatestAppropriateness(supabase, clientName): Promise<FetchApprResult>` — latest row by `ts desc`.
  - `saveAppropriateness(supabase, clientName, input): Promise<SaveApprResult>` — inserts with `valid_until = addMonths(now, 12)`, returns the created row mapped.

- [ ] **Step 1: Write the failing test**

Create `src/lib/clientPortal/__tests__/appropriatenessRepo.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { addMonths, mapRow, fetchLatestAppropriateness, saveAppropriateness } from '../appropriatenessRepo'

describe('addMonths', () => {
  it('adds whole months to an ISO instant', () => {
    expect(addMonths('2026-08-03T00:00:00.000Z', 12)).toBe('2027-08-03T00:00:00.000Z')
  })
})

describe('mapRow', () => {
  it('maps snake_case row to the domain record', () => {
    expect(mapRow({ signed_name: 'R. Quandt', valid_until: '2027-08-03T00:00:00.000Z', ts: '2026-08-03T00:00:00.000Z' }))
      .toEqual({ signedName: 'R. Quandt', validUntil: '2027-08-03T00:00:00.000Z', ts: '2026-08-03T00:00:00.000Z' })
  })
})

function mockClient(over: { selectData?: unknown[]; selectError?: { message: string } | null; insertRow?: unknown; insertError?: { message: string } | null }) {
  const q = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: over.selectData ?? [], error: over.selectError ?? null }),
    insert: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: over.insertRow ?? null, error: over.insertError ?? null }),
  }
  const from = vi.fn().mockReturnValue(q)
  return { client: { from } as unknown as SupabaseClient, from, q }
}

describe('fetchLatestAppropriateness', () => {
  it('returns the latest mapped record', async () => {
    const row = { signed_name: 'R. Quandt', valid_until: '2027-08-03T00:00:00.000Z', ts: '2026-08-03T00:00:00.000Z' }
    const { client, from, q } = mockClient({ selectData: [row] })
    const r = await fetchLatestAppropriateness(client, 'TwoPrime')
    expect(from).toHaveBeenCalledWith('appropriateness_assessments')
    expect(q.eq).toHaveBeenCalledWith('client_name', 'TwoPrime')
    expect(r).toEqual({ ok: true, record: { signedName: 'R. Quandt', validUntil: row.valid_until, ts: row.ts } })
  })
  it('returns null record when none exists', async () => {
    const { client } = mockClient({ selectData: [] })
    expect(await fetchLatestAppropriateness(client, 'TwoPrime')).toEqual({ ok: true, record: null })
  })
  it('returns an error result on failure', async () => {
    const { client } = mockClient({ selectData: [], selectError: { message: 'nope' } })
    expect(await fetchLatestAppropriateness(client, 'TwoPrime')).toEqual({ ok: false, error: 'nope' })
  })
})

describe('saveAppropriateness', () => {
  it('inserts with a 12-month validity and returns the mapped record', async () => {
    const row = { signed_name: 'R. Quandt', valid_until: '2027-08-03T00:00:00.000Z', ts: '2026-08-03T00:00:00.000Z' }
    const { client, q } = mockClient({ insertRow: row })
    const r = await saveAppropriateness(client, 'TwoPrime', { answers: [3, 2], attestations: [true, true, true], signedName: 'R. Quandt' })
    expect(q.insert).toHaveBeenCalledTimes(1)
    const arg = q.insert.mock.calls[0][0] as Record<string, unknown>
    expect(arg.client_name).toBe('TwoPrime')
    expect(arg.signed_name).toBe('R. Quandt')
    expect(arg.answers).toEqual([3, 2])
    expect(typeof arg.valid_until).toBe('string')
    expect(r).toEqual({ ok: true, record: { signedName: 'R. Quandt', validUntil: row.valid_until, ts: row.ts } })
  })
  it('returns an error result on insert failure', async () => {
    const { client } = mockClient({ insertError: { message: 'denied' } })
    const r = await saveAppropriateness(client, 'TwoPrime', { answers: [], attestations: [], signedName: 'X' })
    expect(r).toEqual({ ok: false, error: 'denied' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test appropriatenessRepo`
Expected: FAIL — cannot find module `../appropriatenessRepo`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/clientPortal/appropriatenessRepo.ts`:
```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export type AppropriatenessRecord = { signedName: string | null; validUntil: string | null; ts: string }
export type AppropriatenessInput = { answers: unknown; attestations: unknown; signedName: string }
export type FetchApprResult = { ok: true; record: AppropriatenessRecord | null } | { ok: false; error: string }
export type SaveApprResult = { ok: true; record: AppropriatenessRecord } | { ok: false; error: string }

export function addMonths(iso: string, months: number): string {
  const d = new Date(iso)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString()
}

export function mapRow(row: { signed_name: string | null; valid_until: string | null; ts: string }): AppropriatenessRecord {
  return { signedName: row.signed_name, validUntil: row.valid_until, ts: row.ts }
}

export async function fetchLatestAppropriateness(supabase: SupabaseClient, clientName: string): Promise<FetchApprResult> {
  const { data, error } = await supabase
    .from('appropriateness_assessments')
    .select('signed_name, valid_until, ts')
    .eq('client_name', clientName)
    .order('ts', { ascending: false })
    .limit(1)
  if (error) return { ok: false, error: error.message }
  const rows = (data ?? []) as { signed_name: string | null; valid_until: string | null; ts: string }[]
  return { ok: true, record: rows.length > 0 ? mapRow(rows[0]) : null }
}

export async function saveAppropriateness(
  supabase: SupabaseClient,
  clientName: string,
  input: AppropriatenessInput,
): Promise<SaveApprResult> {
  const validUntil = addMonths(new Date().toISOString(), 12)
  const { data, error } = await supabase
    .from('appropriateness_assessments')
    .insert({
      client_name: clientName,
      answers: input.answers,
      attestations: input.attestations,
      signed_name: input.signedName,
      valid_until: validUntil,
    })
    .select('signed_name, valid_until, ts')
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, record: mapRow(data as { signed_name: string | null; valid_until: string | null; ts: string }) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test appropriatenessRepo`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clientPortal/appropriatenessRepo.ts src/lib/clientPortal/__tests__/appropriatenessRepo.test.ts
git commit -m "feat(portal): add appropriateness assessment repo"
```

---

### Task 4: useSetupPersistence hook

**Files:**
- Create: `src/features/clientPortal/useSetupPersistence.ts`
- Test: `src/features/clientPortal/__tests__/useSetupPersistence.test.tsx`

**Interfaces:**
- Consumes: `getSupabaseClient`, `hasSupabaseClient` from `@/lib/supabase`; `fetchLatestStrategy`, `saveStrategy` from `@/lib/clientPortal/strategyRepo`; `fetchLatestAppropriateness`, `saveAppropriateness`, `type AppropriatenessInput` from `@/lib/clientPortal/appropriatenessRepo`.
- Produces: `useSetupPersistence(clientName: string): { loaded: boolean; appropriatenessSigned: boolean; selectedStrategy: string | null; saveAppropriateness: (input: AppropriatenessInput) => Promise<{ ok: boolean; error?: string }>; saveStrategy: (module: string) => Promise<{ ok: boolean; error?: string }> }`
  - On mount / `clientName` change: if `!hasSupabaseClient()` → `loaded=true`, nulls (in-session mode). Else fetch both in parallel; seed `appropriatenessSigned` (record present) + `selectedStrategy` (module present); `loaded=true`. Fetch errors are treated as "no record".
  - `save*`: `!hasSupabaseClient()` → resolve `{ ok: true }` (in-session). Else call the repo and re-expose `{ ok }`/`{ ok:false, error }`.

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/__tests__/useSetupPersistence.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('@/lib/supabase', () => ({ getSupabaseClient: () => ({}), hasSupabaseClient: () => true }))
vi.mock('@/lib/clientPortal/strategyRepo', () => ({
  fetchLatestStrategy: vi.fn(), saveStrategy: vi.fn(),
}))
vi.mock('@/lib/clientPortal/appropriatenessRepo', () => ({
  fetchLatestAppropriateness: vi.fn(), saveAppropriateness: vi.fn(),
}))

import { fetchLatestStrategy, saveStrategy } from '@/lib/clientPortal/strategyRepo'
import { fetchLatestAppropriateness, saveAppropriateness } from '@/lib/clientPortal/appropriatenessRepo'
import { useSetupPersistence } from '../useSetupPersistence'

const fApp = vi.mocked(fetchLatestAppropriateness)
const fStr = vi.mocked(fetchLatestStrategy)
const sApp = vi.mocked(saveAppropriateness)
const sStr = vi.mocked(saveStrategy)

beforeEach(() => {
  fApp.mockResolvedValue({ ok: true, record: null })
  fStr.mockResolvedValue({ ok: true, module: null })
  sApp.mockResolvedValue({ ok: true, record: { signedName: 'R', validUntil: null, ts: 't' } })
  sStr.mockResolvedValue({ ok: true })
})

describe('useSetupPersistence', () => {
  it('seeds signed + selected strategy from fetched records', async () => {
    fApp.mockResolvedValue({ ok: true, record: { signedName: 'R', validUntil: null, ts: 't' } })
    fStr.mockResolvedValue({ ok: true, module: 'Range Condor' })
    const { result } = renderHook(() => useSetupPersistence('TwoPrime'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.appropriatenessSigned).toBe(true)
    expect(result.current.selectedStrategy).toBe('Range Condor')
  })

  it('saveStrategy delegates to the repo and returns its result', async () => {
    const { result } = renderHook(() => useSetupPersistence('TwoPrime'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    const r = await result.current.saveStrategy('Range Condor')
    expect(sStr).toHaveBeenCalledWith(expect.anything(), 'TwoPrime', 'Range Condor')
    expect(r).toEqual({ ok: true })
  })

  it('surfaces a save error from the repo', async () => {
    sApp.mockResolvedValue({ ok: false, error: 'denied' })
    const { result } = renderHook(() => useSetupPersistence('TwoPrime'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    const r = await result.current.saveAppropriateness({ answers: [], attestations: [], signedName: 'X' })
    expect(r).toEqual({ ok: false, error: 'denied' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test useSetupPersistence`
Expected: FAIL — cannot find module `../useSetupPersistence`.

- [ ] **Step 3: Write the implementation**

Create `src/features/clientPortal/useSetupPersistence.ts`:
```ts
import React from 'react'
import { getSupabaseClient, hasSupabaseClient } from '@/lib/supabase'
import { fetchLatestStrategy, saveStrategy as saveStrategyRow } from '@/lib/clientPortal/strategyRepo'
import { fetchLatestAppropriateness, saveAppropriateness as saveApprRow, type AppropriatenessInput } from '@/lib/clientPortal/appropriatenessRepo'

type SaveResult = { ok: boolean; error?: string }

export function useSetupPersistence(clientName: string) {
  const [loaded, setLoaded] = React.useState(false)
  const [appropriatenessSigned, setAppropriatenessSigned] = React.useState(false)
  const [selectedStrategy, setSelectedStrategy] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!hasSupabaseClient()) { setLoaded(true); return }
    let ignore = false
    ;(async () => {
      const supabase = getSupabaseClient()
      const [appr, strat] = await Promise.all([
        fetchLatestAppropriateness(supabase, clientName),
        fetchLatestStrategy(supabase, clientName),
      ])
      if (ignore) return
      if (appr.ok && appr.record) setAppropriatenessSigned(true)
      if (strat.ok && strat.module) setSelectedStrategy(strat.module)
      setLoaded(true)
    })()
    return () => { ignore = true }
  }, [clientName])

  const saveAppropriateness = React.useCallback(async (input: AppropriatenessInput): Promise<SaveResult> => {
    if (!hasSupabaseClient()) return { ok: true }
    const r = await saveApprRow(getSupabaseClient(), clientName, input)
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }, [clientName])

  const saveStrategy = React.useCallback(async (module: string): Promise<SaveResult> => {
    if (!hasSupabaseClient()) return { ok: true }
    const r = await saveStrategyRow(getSupabaseClient(), clientName, module)
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }, [clientName])

  return { loaded, appropriatenessSigned, selectedStrategy, saveAppropriateness, saveStrategy }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test useSetupPersistence`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/useSetupPersistence.ts src/features/clientPortal/__tests__/useSetupPersistence.test.tsx
git commit -m "feat(portal): add useSetupPersistence hook (fetch on load + async save)"
```

---

### Task 5: Wire persistence into the shell + appropriateness payload

**Files:**
- Modify: `src/features/clientPortal/ClientPortalShell.tsx`
- Modify: `src/features/clientPortal/pages/AppropriatenessPage.tsx`
- Modify: `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`
- Modify: `src/features/clientPortal/__tests__/AppropriatenessPage.test.tsx`

**Interfaces:**
- Consumes: `useSetupPersistence` from `./useSetupPersistence`; `type AppropriatenessInput` from `@/lib/clientPortal/appropriatenessRepo`.
- Behavior: shell calls `useSetupPersistence(clientName)`, seeds `setupStatus.appropriateness`/`.strategy` + `strategy` from the fetched values once `loaded`, and makes `signAppropriateness`/`selectStrategy` async — they `await` the hook's `save*`, then on success flip the precondition + append the audit event; on failure set a `persistError` shown as an inline banner. `AppropriatenessPage.onSign` now passes `{ answers, attestations }`.

- [ ] **Step 1: Update the AppropriatenessPage test for the payload**

In `src/features/clientPortal/__tests__/AppropriatenessPage.test.tsx`, change the sign assertion so it expects a payload:
```tsx
    await userEvent.click(sign)
    expect(onSign).toHaveBeenCalledWith(expect.objectContaining({ attestations: [true, true, true] }))
```
(Replace the previous `expect(onSign).toHaveBeenCalledOnce()` line.)

- [ ] **Step 2: Run the appropriateness test to verify it fails**

Run: `pnpm test AppropriatenessPage`
Expected: FAIL — `onSign` is called with no argument.

- [ ] **Step 3: Make AppropriatenessPage pass the payload**

In `src/features/clientPortal/pages/AppropriatenessPage.tsx`:
1. Change the prop type:
```tsx
export function AppropriatenessPage({ signed, onSign }: { signed: boolean; onSign: (payload: { answers: number[]; attestations: boolean[] }) => void }) {
```
2. Change the Sign button's handler to pass the current answers + attestations:
```tsx
            <Button variant="primary" size="sm" disabled={!allAttested} onClick={() => onSign({ answers, attestations: checked })}>Sign &amp; complete assessment</Button>
```

- [ ] **Step 4: Run the appropriateness test to verify it passes**

Run: `pnpm test AppropriatenessPage`
Expected: PASS.

- [ ] **Step 5: Add the failing shell test**

In `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`, add a mock for the persistence hook near the other mocks at the top of the file:
```tsx
vi.mock('../useSetupPersistence', () => ({
  useSetupPersistence: vi.fn(() => ({
    loaded: true, appropriatenessSigned: false, selectedStrategy: null,
    saveAppropriateness: vi.fn(async () => ({ ok: true })),
    saveStrategy: vi.fn(async () => ({ ok: true })),
  })),
}))
```
Then add a test that a fetched signed record seeds the state (place it after the existing tests):
```tsx
it('seeds the appropriateness precondition from persisted state on load', async () => {
  const mod = await import('../useSetupPersistence')
  vi.mocked(mod.useSetupPersistence).mockReturnValueOnce({
    loaded: true, appropriatenessSigned: true, selectedStrategy: 'Range Condor',
    saveAppropriateness: vi.fn(async () => ({ ok: true })),
    saveStrategy: vi.fn(async () => ({ ok: true })),
  })
  render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/appropriateness" onSignOut={() => {}} />)
  await screen.findByText(/completed & signed/i)
})
```

- [ ] **Step 6: Run the shell test to verify it fails**

Run: `pnpm test ClientPortalShell`
Expected: FAIL — the shell doesn't consume `useSetupPersistence` yet, so nothing seeds "Completed & signed".

- [ ] **Step 7: Wire the shell**

In `src/features/clientPortal/ClientPortalShell.tsx`:
1. Add imports with the others:
```tsx
import { useSetupPersistence } from './useSetupPersistence'
import { type AppropriatenessInput } from '@/lib/clientPortal/appropriatenessRepo'
```
2. Right after the `useClientPositions` line, add the persistence hook, error state, and seeding effect:
```tsx
  const persistence = useSetupPersistence(clientName)
  const [persistError, setPersistError] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!persistence.loaded) return
    setSetupStatus((s) => ({ ...s, appropriateness: persistence.appropriatenessSigned, strategy: !!persistence.selectedStrategy }))
    if (persistence.selectedStrategy) setStrategy(persistence.selectedStrategy)
  }, [persistence.loaded, persistence.appropriatenessSigned, persistence.selectedStrategy])
```
3. Replace `signAppropriateness` and `selectStrategy` with async versions that persist first:
```tsx
  const signAppropriateness = React.useCallback(async (payload: { answers: number[]; attestations: boolean[] }) => {
    const input: AppropriatenessInput = { answers: payload.answers, attestations: payload.attestations, signedName: clientName }
    const r = await persistence.saveAppropriateness(input)
    if (!r.ok) { setPersistError(r.error ?? 'Could not save your assessment. Please try again.'); return }
    setPersistError(null)
    setSetupStatus((s) => ({ ...s, appropriateness: true }))
    appendAudit('APPROPRIATENESS', 'self-assessment completed & signed')
  }, [persistence, appendAudit, clientName])
  const selectStrategy = React.useCallback(async (name: string) => {
    const r = await persistence.saveStrategy(name)
    if (!r.ok) { setPersistError(r.error ?? 'Could not save your strategy selection. Please try again.'); return }
    setPersistError(null)
    setStrategy(name)
    setSetupStatus((s) => ({ ...s, strategy: true }))
    appendAudit('STRATEGY', `selected module "${name}"`)
  }, [persistence, appendAudit])
```
   (Delete the old synchronous `signAppropriateness` / `selectStrategy` definitions.)
4. Render the error banner: immediately inside `<main …>`, before the page conditional, add:
```tsx
          {persistError && (
            <div className="mb-4 rounded-xl border border-status-danger/30 bg-status-danger/10 px-4 py-2.5 type-caption text-status-danger">
              {persistError}
            </div>
          )}
```

- [ ] **Step 8: Run the shell tests to verify they pass**

Run: `pnpm test ClientPortalShell`
Expected: PASS — the new seeding test plus all existing shell tests (the end-to-end activation flow still works because the default hook mock resolves `save*` to `{ ok: true }`).

- [ ] **Step 9: Full typecheck, test, build**

Run: `pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: no type errors; all tests pass; build succeeds.

- [ ] **Step 10: Commit**

```bash
git add src/features/clientPortal/ClientPortalShell.tsx src/features/clientPortal/pages/AppropriatenessPage.tsx src/features/clientPortal/__tests__/ClientPortalShell.test.tsx src/features/clientPortal/__tests__/AppropriatenessPage.test.tsx
git commit -m "feat(portal): persist appropriateness + strategy via Supabase, restore on load"
```

---

## Self-Review

**Spec coverage:**
- Two append-only tables + per-client RLS + admin-read → Task 1. ✓ (spec §3)
- `created_by` from auth → Task 1 (`default auth.uid()`). ✓
- Repos in `lib/clientPortal` with `{ ok }` results → Tasks 2, 3. ✓ (spec §4.1)
- `useSetupPersistence` fetch-on-load + async save → Task 4. ✓ (spec §4.2)
- Shell seeds preconditions + async handlers + inline error → Task 5. ✓ (spec §4.2–4.4)
- Graceful degradation (no supabase / errors) → Task 4 hook (`!hasSupabaseClient()` short-circuits) + Task 5 (save failure shows error, doesn't flip). ✓ (spec §4.4)
- `valid_until` = +12 months → Task 3 (`addMonths(now, 12)`). ✓ (spec §8)
- Admin-role operational note → Task 1 Step 3 doc. ✓ (spec §6)
- User applies migrations → stated (Task 1 note). ✓

**Placeholder scan:** No "TBD"/vague steps; every code step is complete. SQL "verification" is a structural grep (migrations can't be unit-tested locally) — explicitly justified.

**Type consistency:** `FetchStrategyResult`/`SaveStrategyResult`/`FetchApprResult`/`SaveApprResult`/`AppropriatenessRecord`/`AppropriatenessInput`/`addMonths`/`mapRow`/`fetchLatestStrategy`/`saveStrategy`/`fetchLatestAppropriateness`/`saveAppropriateness`/`useSetupPersistence` are defined once and consumed with matching signatures across tasks. The hook's `saveAppropriateness(input)` and the shell's `signAppropriateness(payload)` agree on `{ answers, attestations }`; `AppropriatenessPage.onSign` passes the same shape.

**Deferred (out of scope, per spec §7):** persistence for keys/updates/risk/activation/audit; tightening RLS on existing tables; admin compliance UI; multi-record editing.
