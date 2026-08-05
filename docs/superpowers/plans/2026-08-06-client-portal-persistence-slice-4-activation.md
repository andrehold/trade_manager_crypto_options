# Client Portal Persistence Slice 4 — Activation State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the client's master activation (kill-switch) state to Supabase as an append-only activate/deactivate log, and restore it on reload under a precondition-gate guard.

**Architecture:** One append-only `activation_events` table (per-client RLS) stores immutable `activate`/`deactivate` rows; current state = the latest row's action. A new `activationRepo` reads the latest state / inserts a toggle. `useSetupPersistence` gains `persistedActive` + `saveActivation`. `ClientPortalShell` seeds `active` only when the persisted state is active AND `canActivate` holds from the persisted preconditions (guarded), and makes `toggleActivation` persist-first. No UI change — `ActivationControl` is untouched.

**Tech Stack:** React 18 + TypeScript, Supabase JS client, Vitest + Testing Library, pnpm.

## Global Constraints

- Repos and hook return a discriminated `{ ok: true; … } | { ok: false; error: string }` result and **never throw to the UI**.
- Reuse the single gate source `canActivate` from `./setupStatus` — do not reimplement the four-precondition check.
- Seeding is promote-only (`cur || …` / `cur ?? …`) — never revert a locally-set value. The activation seed is additionally **guarded**: restore active only when `persistedActive && canActivate(persistedStatus)`.
- No new dependencies; no dependency-version changes (Vitest pinned; Vite stays v5).
- Tests run with `pnpm vitest run <path>`; full verification also runs `pnpm tsc --noEmit` and `pnpm build`.
- Migrations are written here but **applied by the user** — no task runs SQL against a live DB.
- The append-only log has **no update or delete** — a deactivate is a new `action:'deactivate'` row.

---

### Task 1: Migration + `activationRepo`

Creates the table migration and the repo (`fetchActivationState` + `saveActivation`). The migration is scaffolding the repo consumes, so it lives here.

**Files:**
- Create: `supabase/migrations/20260806_add_activation_events.sql`
- Create: `src/lib/clientPortal/activationRepo.ts`
- Test: `src/lib/clientPortal/__tests__/activationRepo.test.ts`

**Interfaces:**
- Consumes: `SupabaseClient` from `@supabase/supabase-js`.
- Produces:
  - `fetchActivationState(supabase, clientName): Promise<{ ok: true; active: boolean } | { ok: false; error: string }>`
  - `saveActivation(supabase, clientName, active: boolean): Promise<{ ok: true } | { ok: false; error: string }>`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260806_add_activation_events.sql`:

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

- [ ] **Step 2: Write the failing test**

Create `src/lib/clientPortal/__tests__/activationRepo.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchActivationState, saveActivation } from '../activationRepo'

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

describe('fetchActivationState', () => {
  it('returns active true when the latest event is activate', async () => {
    const { client, from, q } = mockClient({ selectData: [{ action: 'activate' }] })
    const r = await fetchActivationState(client, 'TwoPrime')
    expect(from).toHaveBeenCalledWith('activation_events')
    expect(q.eq).toHaveBeenCalledWith('client_name', 'TwoPrime')
    expect(q.order).toHaveBeenCalledWith('ts', { ascending: false })
    expect(q.limit).toHaveBeenCalledWith(1)
    expect(r).toEqual({ ok: true, active: true })
  })
  it('returns active false when the latest event is deactivate', async () => {
    const { client } = mockClient({ selectData: [{ action: 'deactivate' }] })
    expect(await fetchActivationState(client, 'TwoPrime')).toEqual({ ok: true, active: false })
  })
  it('returns active false when there are no events', async () => {
    const { client } = mockClient({ selectData: [] })
    expect(await fetchActivationState(client, 'TwoPrime')).toEqual({ ok: true, active: false })
  })
  it('returns an error result on query failure', async () => {
    const { client } = mockClient({ selectData: [], selectError: { message: 'boom' } })
    expect(await fetchActivationState(client, 'TwoPrime')).toEqual({ ok: false, error: 'boom' })
  })
})

describe('saveActivation', () => {
  it('inserts an activate row', async () => {
    const { client, q } = mockClient({})
    const r = await saveActivation(client, 'TwoPrime', true)
    expect(q.insert).toHaveBeenCalledWith({ client_name: 'TwoPrime', action: 'activate' })
    expect(r).toEqual({ ok: true })
  })
  it('inserts a deactivate row', async () => {
    const { client, q } = mockClient({})
    await saveActivation(client, 'TwoPrime', false)
    expect(q.insert).toHaveBeenCalledWith({ client_name: 'TwoPrime', action: 'deactivate' })
  })
  it('returns an error result on insert failure', async () => {
    const { client } = mockClient({ insertError: { message: 'denied' } })
    expect(await saveActivation(client, 'TwoPrime', true)).toEqual({ ok: false, error: 'denied' })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/clientPortal/__tests__/activationRepo.test.ts`
Expected: FAIL — `activationRepo` module / exports not found.

- [ ] **Step 4: Write the repo implementation**

Create `src/lib/clientPortal/activationRepo.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export type FetchActivationResult = { ok: true; active: boolean } | { ok: false; error: string }
export type SaveActivationResult = { ok: true } | { ok: false; error: string }

export async function fetchActivationState(supabase: SupabaseClient, clientName: string): Promise<FetchActivationResult> {
  const { data, error } = await supabase
    .from('activation_events')
    .select('action')
    .eq('client_name', clientName)
    .order('ts', { ascending: false })
    .limit(1)
  if (error) return { ok: false, error: error.message }
  const rows = (data ?? []) as { action: string }[]
  return { ok: true, active: rows.length > 0 && rows[0].action === 'activate' }
}

export async function saveActivation(supabase: SupabaseClient, clientName: string, active: boolean): Promise<SaveActivationResult> {
  const { error } = await supabase.from('activation_events').insert({ client_name: clientName, action: active ? 'activate' : 'deactivate' })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/lib/clientPortal/__tests__/activationRepo.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260806_add_activation_events.sql src/lib/clientPortal/activationRepo.ts src/lib/clientPortal/__tests__/activationRepo.test.ts
git commit -m "feat(portal): activation_events migration + activationRepo (append-only latest-wins)"
```

---

### Task 2: Extend `useSetupPersistence`

Adds the activation fetch to the parallel load and exposes `persistedActive` + `saveActivation`. Also adds the two new fields to the shell-test's shared persistence mock so `pnpm tsc` stays green (the shell consumes the hook's return type).

**Files:**
- Modify: `src/features/clientPortal/useSetupPersistence.ts`
- Test: `src/features/clientPortal/__tests__/useSetupPersistence.test.tsx`
- Modify (tsc-required collateral): `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`

**Interfaces:**
- Consumes: `fetchActivationState`, `saveActivation` from `@/lib/clientPortal/activationRepo` (Task 1).
- Produces: the hook return object gains `persistedActive: boolean` and `saveActivation(active: boolean): Promise<{ ok: boolean; error?: string }>`.

- [ ] **Step 1: Add the failing test cases**

In `src/features/clientPortal/__tests__/useSetupPersistence.test.tsx`, add a repo mock alongside the existing `vi.mock` calls:

```ts
vi.mock('@/lib/clientPortal/activationRepo', () => ({
  fetchActivationState: vi.fn(), saveActivation: vi.fn(),
}))
```

Add imports alongside the existing repo imports:

```ts
import { fetchActivationState, saveActivation as saveActivationRepo } from '@/lib/clientPortal/activationRepo'
```

Add mocked handles next to the existing ones:

```ts
const fAct = vi.mocked(fetchActivationState)
const sAct = vi.mocked(saveActivationRepo)
```

In the existing `beforeEach`, add default resolutions:

```ts
  fAct.mockResolvedValue({ ok: true, active: false })
  sAct.mockResolvedValue({ ok: true })
```

Add these test cases inside the `describe('useSetupPersistence', …)` block:

```ts
  it('seeds persistedActive from a fetched active state', async () => {
    fAct.mockResolvedValue({ ok: true, active: true })
    const { result } = renderHook(() => useSetupPersistence('TwoPrime'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.persistedActive).toBe(true)
  })

  it('saveActivation delegates to the repo and returns its result', async () => {
    const { result } = renderHook(() => useSetupPersistence('TwoPrime'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    const r = await result.current.saveActivation(true)
    expect(sAct).toHaveBeenCalledWith(expect.anything(), 'TwoPrime', true)
    expect(r).toEqual({ ok: true })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/clientPortal/__tests__/useSetupPersistence.test.tsx`
Expected: FAIL — `persistedActive`/`saveActivation` undefined on the hook result.

- [ ] **Step 3: Implement the hook changes**

In `src/features/clientPortal/useSetupPersistence.ts`, add the import:

```ts
import { fetchActivationState, saveActivation as saveActivationRow } from '@/lib/clientPortal/activationRepo'
```

Add state alongside the existing `useState` declarations:

```ts
  const [persistedActive, setPersistedActive] = React.useState(false)
```

In the load effect, add the fetch to the `Promise.all` and seed. Replace the existing `Promise.all` block with:

```ts
      const [appr, strat, risk, keys, activation] = await Promise.all([
        fetchLatestAppropriateness(supabase, clientName),
        fetchLatestStrategy(supabase, clientName),
        fetchLatestRiskLimits(supabase, clientName),
        fetchActiveKeys(supabase, clientName),
        fetchActivationState(supabase, clientName),
      ])
      if (ignore) return
      if (appr.ok && appr.record) setAppropriatenessSigned(true)
      if (strat.ok && strat.module) setSelectedStrategy(strat.module)
      if (risk.ok && risk.limits) setSavedRiskLimits(risk.limits)
      if (keys.ok) setActiveKeys(keys.keys)
      if (activation.ok) setPersistedActive(activation.active)
      setLoaded(true)
```

Add the save callback after `revokeExchangeKey`:

```ts
  const saveActivation = React.useCallback(async (active: boolean): Promise<SaveResult> => {
    if (!hasSupabaseClient()) return { ok: true }
    const r = await saveActivationRow(getSupabaseClient(), clientName, active)
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }, [clientName])
```

Add both to the returned object:

```ts
  return { loaded, appropriatenessSigned, selectedStrategy, savedRiskLimits, activeKeys, persistedActive, saveAppropriateness, saveStrategy, saveRiskLimits, addExchangeKey, revokeExchangeKey, saveActivation }
```

- [ ] **Step 4: Update the shell-test mock so tsc stays green**

In `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`, add the two new fields to `baseSetupPersistence`:

```ts
  persistedActive: false,
  saveActivation: vi.fn(async () => ({ ok: true })),
```

Also add the same two fields to the two existing per-test overrides in this file (the "seeds the appropriateness precondition" test and the "shows an error banner and does not sign" test) so each returned object stays shape-complete.

> Do not change the shell component or other shell tests in this task — only the mock shape. The shell does not read `persistedActive`/`saveActivation` until Task 3, which is fine.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/features/clientPortal/__tests__/useSetupPersistence.test.tsx && pnpm vitest run src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`
Expected: PASS (new hook cases + existing hook cases; shell tests still green).

- [ ] **Step 6: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/features/clientPortal/useSetupPersistence.ts src/features/clientPortal/__tests__/useSetupPersistence.test.tsx src/features/clientPortal/__tests__/ClientPortalShell.test.tsx
git commit -m "feat(portal): useSetupPersistence exposes persistedActive + saveActivation"
```

---

### Task 3: Wire the shell — guarded activation seed + persist-first toggle

Seeds `active` from persisted state under the `canActivate` guard, and makes `toggleActivation` persist-first. Restores the whole repo to green.

**Files:**
- Modify: `src/features/clientPortal/ClientPortalShell.tsx`
- Test: `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`

**Interfaces:**
- Consumes: `persistedActive`, `saveActivation` from `useSetupPersistence` (Task 2); `canActivate` from `./setupStatus`.
- Produces: no new exports; behavior change (persisted, guard-restored, persist-first activation).

- [ ] **Step 1: Add the failing shell tests**

In `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`, ensure these imports are present at the top (both were added in earlier slices — add whichever is missing):

```ts
import { DEFAULT_RISK_LIMITS } from '../risk/riskLimits'
```

Add a helper active-key constant near the top of the file (after the imports), if not already present, for reuse:

```ts
const ACTIVE_KEY = { keyRef: 'r1', venue: 'Deribit', label: 'main', fingerprint: null, scopes: 'trade,read', noWithdrawal: true, ts: '1' }
```

Add these three test cases inside the `describe('ClientPortalShell', …)` block:

```ts
  it('restores Active on load when persisted active and all preconditions are met', async () => {
    vi.mocked(useSetupPersistence).mockReturnValue({
      ...baseSetupPersistence,
      appropriatenessSigned: true, selectedStrategy: 'Obsidian Core Yield', savedRiskLimits: DEFAULT_RISK_LIMITS,
      activeKeys: [ACTIVE_KEY], persistedActive: true,
    })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/dashboard" onSignOut={() => {}} />)
    // ActivationControl renders a "Deactivate" control only while active.
    expect(await screen.findByRole('button', { name: /deactivate/i })).toBeInTheDocument()
  })

  it('stays Inactive on load when persisted active but a precondition is missing (guard)', async () => {
    vi.mocked(useSetupPersistence).mockReturnValue({
      ...baseSetupPersistence,
      appropriatenessSigned: true, selectedStrategy: 'Obsidian Core Yield', savedRiskLimits: DEFAULT_RISK_LIMITS,
      activeKeys: [], persistedActive: true, // no trading key → gate not open
    })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/dashboard" onSignOut={() => {}} />)
    expect(screen.queryByRole('button', { name: /deactivate/i })).toBeNull()
    expect(screen.getByRole('button', { name: /^activate$/i })).toBeInTheDocument()
  })

  it('shows an error banner and does not activate when the save fails', async () => {
    vi.mocked(useSetupPersistence).mockReturnValue({
      ...baseSetupPersistence,
      appropriatenessSigned: true, selectedStrategy: 'Obsidian Core Yield', savedRiskLimits: DEFAULT_RISK_LIMITS,
      activeKeys: [ACTIVE_KEY], persistedActive: false,
      saveActivation: vi.fn(async () => ({ ok: false, error: 'activation save failed' })),
    })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/dashboard" onSignOut={() => {}} />)
    // Gate is open (all four preconditions persisted), so Activate is enabled.
    await userEvent.click(await screen.findByRole('button', { name: /^activate$/i }))
    expect(await screen.findByText(/activation save failed/i)).toBeInTheDocument()
    // Still inactive — no Deactivate control appeared.
    expect(screen.queryByRole('button', { name: /deactivate/i })).toBeNull()
  })
```

- [ ] **Step 2: Run tests to verify the new cases fail**

Run: `pnpm vitest run src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`
Expected: FAIL — the shell does not yet seed `active` from `persistedActive`, and `toggleActivation` is not persist-first (no banner on failure).

- [ ] **Step 3: Implement the shell changes**

In `src/features/clientPortal/ClientPortalShell.tsx`:

Update the `setupStatus` import to also bring in `canActivate` (currently `import { EMPTY_SETUP_STATUS, type SetupStatus } from './setupStatus'`):

```ts
import { canActivate, EMPTY_SETUP_STATUS, type SetupStatus } from './setupStatus'
```

Extend the seed effect to add the guarded activation seed and its dep. Replace the whole seed effect with:

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
    // Guarded activation seed: restore active only if the persisted state is active AND the gate holds
    // from the persisted preconditions (avoids "Active with an unmet gate" after reload). Promote-only.
    const persistedStatus: SetupStatus = {
      appropriateness: persistence.appropriatenessSigned,
      strategy: !!persistence.selectedStrategy,
      riskLimits: !!persistence.savedRiskLimits,
      tradingKey: persistence.activeKeys.length > 0,
    }
    if (persistence.persistedActive && canActivate(persistedStatus)) setActive((cur) => cur || true)
  }, [persistence.loaded, persistence.appropriatenessSigned, persistence.selectedStrategy, persistence.savedRiskLimits, persistence.activeKeys, persistence.persistedActive])
```

Replace the synchronous `toggleActivation` with the async persist-first version:

```ts
  const toggleActivation = React.useCallback(async () => {
    const next = !active
    const r = await persistence.saveActivation(next)
    if (!r.ok) { setPersistError(r.error ?? 'Could not save activation state. Please try again.'); return }
    setPersistError(null)
    setActive(next)
    appendAudit(next ? 'ACTIVATION' : 'DEACTIVATION', next ? 'software activated' : 'software deactivated')
  }, [active, persistence.saveActivation, appendAudit])
```

> `ActivationControl`'s `onToggle: () => void` prop is unchanged — an `async () => void` handler is assignable to it, and the Activate button stays gated by `canActivate`.

- [ ] **Step 4: Run the shell tests to verify they pass**

Run: `pnpm vitest run src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`
Expected: PASS — new cases plus all existing cases (including the E2E activation-gate test, which asserts the Activate button becomes enabled but does not click it; the default mock's `saveActivation` resolves `{ ok: true }`).

- [ ] **Step 5: Full verification**

Run: `pnpm vitest run && pnpm tsc --noEmit && pnpm build`
Expected: all tests pass, no type errors, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/features/clientPortal/ClientPortalShell.tsx src/features/clientPortal/__tests__/ClientPortalShell.test.tsx
git commit -m "feat(portal): persist + guard-restore activation state; persist-first toggle"
```

---

## Self-Review

**Spec coverage:**
- Schema (§3) → Task 1 Step 1 (migration) ✓
- Repo `fetchActivationState`/`saveActivation` (§4.1) → Task 1 ✓
- Hook `persistedActive`/`saveActivation` (§4.2) → Task 2 ✓
- Shell guarded seed + persist-first toggle (§4.3) → Task 3 ✓
- Data flow (§4.4) → Tasks 2+3 ✓
- Graceful degradation: unconfigured (hook short-circuit, Task 2 Step 3), fetch error (repo `{ok:false}` → hook ignores, seeds nothing → inactive), save error (inline banner, Task 3) → all covered ✓
- Testing (§5): repo latest-wins/empty/error + save; hook seed/delegate; shell guard-restore + guard-block + toggle-fail → Tasks 1–3 ✓
- Non-goals (§7): no Updates/audit-log persistence; no in-session auto-deactivate — none introduced ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `fetchActivationState`/`saveActivation` signatures identical across Task 1 (def), Task 2 (consume/re-expose), and tests. Hook return fields `persistedActive`/`saveActivation` identical across Task 2 def, the shell-mock (Task 2 Step 4), and Task 3 consumption. `canActivate(persistedStatus)` uses the exact `SetupStatus` shape from `./setupStatus` (four booleans). `toggleActivation` changes from sync `() => void` to `async () => void`, still assignable to `ActivationControl`'s `onToggle: () => void`. ✓
