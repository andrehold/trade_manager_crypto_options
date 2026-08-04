# Client Portal Persistence Slice 2 — Risk Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the client's applied risk/greek limits to Supabase so they are restored on next login, reusing the Slice 1 persistence pattern.

**Architecture:** One append-only `risk_limit_selections` table stores the whole `RiskLimits` object as a `jsonb` blob under per-client RLS. A new `riskLimitsRepo` (with a pure, validating `parseRiskLimits`) reads the latest / inserts a snapshot. `useSetupPersistence` gains `savedRiskLimits` + `saveRiskLimits`. `ClientPortalShell` makes `riskLimits` a `null`-sentinel state so seeding reuses the promote-only `cur ?? persisted` idiom, and `applyRisk` becomes async (persist → flip precondition + audit on ok; inline error on fail).

**Tech Stack:** React 18 + TypeScript, Supabase JS client, Vitest + Testing Library, pnpm.

## Global Constraints

- Repos return a discriminated `{ ok: true; … } | { ok: false; error: string }` result and **never throw to the UI**.
- Never define the `RiskLimits`/`Band` shape twice — import from `src/features/clientPortal/risk/riskLimits.ts` (single source of truth).
- Design tokens only — no raw zinc/hex; but this slice touches no new visual markup beyond the existing `persistError` banner.
- Do not let any dependency change bump Vite off v5 (Vitest is pinned `^2.1.9`). This slice adds **no** dependencies.
- Tests are run with `pnpm vitest run <path>`.
- Migrations are written here but **applied by the user** — no task runs SQL against a live DB.

---

### Task 1: Migration + `riskLimitsRepo`

Creates the table migration and the repo (pure `parseRiskLimits` + `fetchLatestRiskLimits` + `saveRiskLimits`). The migration is scaffolding the repo consumes, so it lives in this task.

**Files:**
- Create: `supabase/migrations/20260804_add_risk_limit_selections.sql`
- Create: `src/lib/clientPortal/riskLimitsRepo.ts`
- Test: `src/lib/clientPortal/__tests__/riskLimitsRepo.test.ts`

**Interfaces:**
- Consumes: `RiskLimits`, `Band` from `src/features/clientPortal/risk/riskLimits.ts`; `SupabaseClient` from `@supabase/supabase-js`.
- Produces:
  - `parseRiskLimits(blob: unknown): RiskLimits | null`
  - `fetchLatestRiskLimits(supabase: SupabaseClient, clientName: string): Promise<{ ok: true; limits: RiskLimits | null } | { ok: false; error: string }>`
  - `saveRiskLimits(supabase: SupabaseClient, clientName: string, limits: RiskLimits): Promise<{ ok: true } | { ok: false; error: string }>`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260804_add_risk_limit_selections.sql`:

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

- [ ] **Step 2: Write the failing test**

Create `src/lib/clientPortal/__tests__/riskLimitsRepo.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_RISK_LIMITS } from '@/features/clientPortal/risk/riskLimits'
import { parseRiskLimits, fetchLatestRiskLimits, saveRiskLimits } from '../riskLimitsRepo'

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

describe('parseRiskLimits', () => {
  it('round-trips a fully valid blob to RiskLimits', () => {
    expect(parseRiskLimits({ ...DEFAULT_RISK_LIMITS })).toEqual(DEFAULT_RISK_LIMITS)
  })
  it('ignores unknown extra keys', () => {
    expect(parseRiskLimits({ ...DEFAULT_RISK_LIMITS, bogus: 1 })).toEqual(DEFAULT_RISK_LIMITS)
  })
  it('returns null when a scalar field is missing', () => {
    const { capitalTvlBtc, ...rest } = DEFAULT_RISK_LIMITS
    expect(parseRiskLimits(rest)).toBeNull()
  })
  it('returns null when a scalar field is the wrong type', () => {
    expect(parseRiskLimits({ ...DEFAULT_RISK_LIMITS, netDeltaMaxPct: 'x' })).toBeNull()
  })
  it('returns null when autoRoll is not a boolean', () => {
    expect(parseRiskLimits({ ...DEFAULT_RISK_LIMITS, autoRoll: 'yes' })).toBeNull()
  })
  it('returns null when a band is malformed', () => {
    expect(parseRiskLimits({ ...DEFAULT_RISK_LIMITS, vega: { min: 0 } })).toBeNull()
  })
  it('returns null for non-object input', () => {
    expect(parseRiskLimits(null)).toBeNull()
    expect(parseRiskLimits('nope')).toBeNull()
  })
})

describe('fetchLatestRiskLimits', () => {
  it('returns the parsed latest limits scoped + ordered by the client', async () => {
    const { client, from, q } = mockClient({ selectData: [{ limits: { ...DEFAULT_RISK_LIMITS } }] })
    const r = await fetchLatestRiskLimits(client, 'TwoPrime')
    expect(from).toHaveBeenCalledWith('risk_limit_selections')
    expect(q.eq).toHaveBeenCalledWith('client_name', 'TwoPrime')
    expect(q.order).toHaveBeenCalledWith('ts', { ascending: false })
    expect(q.limit).toHaveBeenCalledWith(1)
    expect(r).toEqual({ ok: true, limits: DEFAULT_RISK_LIMITS })
  })
  it('returns null limits when there is no row', async () => {
    const { client } = mockClient({ selectData: [] })
    expect(await fetchLatestRiskLimits(client, 'TwoPrime')).toEqual({ ok: true, limits: null })
  })
  it('returns null limits (not an error) when the stored blob is malformed', async () => {
    const { client } = mockClient({ selectData: [{ limits: { autoRoll: 'yes' } }] })
    expect(await fetchLatestRiskLimits(client, 'TwoPrime')).toEqual({ ok: true, limits: null })
  })
  it('returns an error result on query failure', async () => {
    const { client } = mockClient({ selectData: [], selectError: { message: 'boom' } })
    expect(await fetchLatestRiskLimits(client, 'TwoPrime')).toEqual({ ok: false, error: 'boom' })
  })
})

describe('saveRiskLimits', () => {
  it('inserts the snapshot and returns ok', async () => {
    const { client, q } = mockClient({})
    const r = await saveRiskLimits(client, 'TwoPrime', DEFAULT_RISK_LIMITS)
    expect(q.insert).toHaveBeenCalledWith({ client_name: 'TwoPrime', limits: DEFAULT_RISK_LIMITS })
    expect(r).toEqual({ ok: true })
  })
  it('returns an error result on insert failure', async () => {
    const { client } = mockClient({ insertError: { message: 'denied' } })
    expect(await saveRiskLimits(client, 'TwoPrime', DEFAULT_RISK_LIMITS)).toEqual({ ok: false, error: 'denied' })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/clientPortal/__tests__/riskLimitsRepo.test.ts`
Expected: FAIL — `riskLimitsRepo` module / exports not found.

- [ ] **Step 4: Write the repo implementation**

Create `src/lib/clientPortal/riskLimitsRepo.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RiskLimits, Band } from '@/features/clientPortal/risk/riskLimits'

export type FetchRiskLimitsResult = { ok: true; limits: RiskLimits | null } | { ok: false; error: string }
export type SaveRiskLimitsResult = { ok: true } | { ok: false; error: string }

const NUMBER_FIELDS = [
  'capitalTvlBtc', 'maxConcurrent', 'expiryMinDte', 'expiryMaxDte',
  'gammaFloor', 'gammaCap', 'thetaFloor',
  'stressLossMaxPct', 'netDeltaMaxPct', 'drawdownReducePct', 'drawdownStopPct',
] as const

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function parseBand(v: unknown): Band | null {
  if (typeof v !== 'object' || v === null) return null
  const b = v as Record<string, unknown>
  if (!isFiniteNumber(b.min) || !isFiniteNumber(b.max)) return null
  return { min: b.min, max: b.max }
}

// Validating parse of an untyped jsonb blob. Returns a fully typed RiskLimits (copying only
// the known fields) or null on any missing / wrong-typed field, so callers can fall back to
// defaults instead of trusting malformed or legacy-shaped data.
export function parseRiskLimits(blob: unknown): RiskLimits | null {
  if (typeof blob !== 'object' || blob === null) return null
  const o = blob as Record<string, unknown>
  for (const k of NUMBER_FIELDS) if (!isFiniteNumber(o[k])) return null
  if (typeof o.autoRoll !== 'boolean') return null
  const deltaLongGamma = parseBand(o.deltaLongGamma)
  const deltaShortGamma = parseBand(o.deltaShortGamma)
  const vega = parseBand(o.vega)
  if (!deltaLongGamma || !deltaShortGamma || !vega) return null
  return {
    capitalTvlBtc: o.capitalTvlBtc as number,
    maxConcurrent: o.maxConcurrent as number,
    expiryMinDte: o.expiryMinDte as number,
    expiryMaxDte: o.expiryMaxDte as number,
    autoRoll: o.autoRoll,
    deltaLongGamma,
    deltaShortGamma,
    gammaFloor: o.gammaFloor as number,
    gammaCap: o.gammaCap as number,
    vega,
    thetaFloor: o.thetaFloor as number,
    stressLossMaxPct: o.stressLossMaxPct as number,
    netDeltaMaxPct: o.netDeltaMaxPct as number,
    drawdownReducePct: o.drawdownReducePct as number,
    drawdownStopPct: o.drawdownStopPct as number,
  }
}

export async function fetchLatestRiskLimits(supabase: SupabaseClient, clientName: string): Promise<FetchRiskLimitsResult> {
  const { data, error } = await supabase
    .from('risk_limit_selections')
    .select('limits')
    .eq('client_name', clientName)
    .order('ts', { ascending: false })
    .limit(1)
  if (error) return { ok: false, error: error.message }
  const rows = (data ?? []) as { limits: unknown }[]
  const limits = rows.length > 0 ? parseRiskLimits(rows[0].limits) : null
  return { ok: true, limits }
}

export async function saveRiskLimits(supabase: SupabaseClient, clientName: string, limits: RiskLimits): Promise<SaveRiskLimitsResult> {
  const { error } = await supabase.from('risk_limit_selections').insert({ client_name: clientName, limits })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/lib/clientPortal/__tests__/riskLimitsRepo.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260804_add_risk_limit_selections.sql src/lib/clientPortal/riskLimitsRepo.ts src/lib/clientPortal/__tests__/riskLimitsRepo.test.ts
git commit -m "feat(portal): risk_limit_selections migration + riskLimitsRepo with validating parse"
```

---

### Task 2: Extend `useSetupPersistence`

Adds the risk-limits fetch to the parallel load and exposes `savedRiskLimits` + `saveRiskLimits`.

**Files:**
- Modify: `src/features/clientPortal/useSetupPersistence.ts`
- Test: `src/features/clientPortal/__tests__/useSetupPersistence.test.tsx`

**Interfaces:**
- Consumes: `fetchLatestRiskLimits`, `saveRiskLimits` from `@/lib/clientPortal/riskLimitsRepo` (Task 1); `RiskLimits` from `@/features/clientPortal/risk/riskLimits`.
- Produces: the hook return object gains `savedRiskLimits: RiskLimits | null` and `saveRiskLimits(limits: RiskLimits): Promise<{ ok: boolean; error?: string }>`.

- [ ] **Step 1: Add the failing test cases**

In `src/features/clientPortal/__tests__/useSetupPersistence.test.tsx`, add a repo mock and two test cases. First, add this mock block alongside the existing `vi.mock` calls (after the appropriatenessRepo mock):

```ts
vi.mock('@/lib/clientPortal/riskLimitsRepo', () => ({
  fetchLatestRiskLimits: vi.fn(), saveRiskLimits: vi.fn(),
}))
```

Add these imports alongside the existing repo imports:

```ts
import { fetchLatestRiskLimits, saveRiskLimits as saveRiskLimitsRepo } from '@/lib/clientPortal/riskLimitsRepo'
import { DEFAULT_RISK_LIMITS } from '@/features/clientPortal/risk/riskLimits'
```

Add these mocked handles next to `fApp`/`fStr`:

```ts
const fRisk = vi.mocked(fetchLatestRiskLimits)
const sRisk = vi.mocked(saveRiskLimitsRepo)
```

In the existing `beforeEach`, add default resolutions:

```ts
  fRisk.mockResolvedValue({ ok: true, limits: null })
  sRisk.mockResolvedValue({ ok: true })
```

Add these two test cases inside the `describe('useSetupPersistence', …)` block:

```ts
  it('seeds savedRiskLimits from a fetched record', async () => {
    fRisk.mockResolvedValue({ ok: true, limits: DEFAULT_RISK_LIMITS })
    const { result } = renderHook(() => useSetupPersistence('TwoPrime'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.savedRiskLimits).toEqual(DEFAULT_RISK_LIMITS)
  })

  it('saveRiskLimits delegates to the repo and returns its result', async () => {
    const { result } = renderHook(() => useSetupPersistence('TwoPrime'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    const r = await result.current.saveRiskLimits(DEFAULT_RISK_LIMITS)
    expect(sRisk).toHaveBeenCalledWith(expect.anything(), 'TwoPrime', DEFAULT_RISK_LIMITS)
    expect(r).toEqual({ ok: true })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/clientPortal/__tests__/useSetupPersistence.test.tsx`
Expected: FAIL — `savedRiskLimits`/`saveRiskLimits` undefined on the hook result.

- [ ] **Step 3: Implement the hook changes**

In `src/features/clientPortal/useSetupPersistence.ts`, add imports:

```ts
import { fetchLatestRiskLimits, saveRiskLimits as saveRiskLimitsRow } from '@/lib/clientPortal/riskLimitsRepo'
import type { RiskLimits } from '@/features/clientPortal/risk/riskLimits'
```

Add state alongside the existing `useState` declarations:

```ts
  const [savedRiskLimits, setSavedRiskLimits] = React.useState<RiskLimits | null>(null)
```

In the load effect, add the fetch to the `Promise.all` and seed on success. Replace the existing `Promise.all` destructuring and seeding block with:

```ts
      const [appr, strat, risk] = await Promise.all([
        fetchLatestAppropriateness(supabase, clientName),
        fetchLatestStrategy(supabase, clientName),
        fetchLatestRiskLimits(supabase, clientName),
      ])
      if (ignore) return
      if (appr.ok && appr.record) setAppropriatenessSigned(true)
      if (strat.ok && strat.module) setSelectedStrategy(strat.module)
      if (risk.ok && risk.limits) setSavedRiskLimits(risk.limits)
      setLoaded(true)
```

Add the save callback after `saveStrategy`:

```ts
  const saveRiskLimits = React.useCallback(async (limits: RiskLimits): Promise<SaveResult> => {
    if (!hasSupabaseClient()) return { ok: true }
    const r = await saveRiskLimitsRow(getSupabaseClient(), clientName, limits)
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }, [clientName])
```

Add both to the returned object:

```ts
  return { loaded, appropriatenessSigned, selectedStrategy, savedRiskLimits, saveAppropriateness, saveStrategy, saveRiskLimits }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/features/clientPortal/__tests__/useSetupPersistence.test.tsx`
Expected: PASS (new cases + all existing cases).

- [ ] **Step 5: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/features/clientPortal/useSetupPersistence.ts src/features/clientPortal/__tests__/useSetupPersistence.test.tsx
git commit -m "feat(portal): useSetupPersistence exposes savedRiskLimits + saveRiskLimits"
```

---

### Task 3: Wire the shell — null-sentinel `riskLimits`, seeding, async apply

Makes `riskLimits` a `null`-sentinel state, seeds it promote-only from the DB, and turns `applyRisk` async (persist → flip + audit on ok; inline error on fail).

**Files:**
- Modify: `src/features/clientPortal/ClientPortalShell.tsx`
- Test: `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`

**Interfaces:**
- Consumes: `savedRiskLimits`, `saveRiskLimits` from `useSetupPersistence` (Task 2); `DEFAULT_RISK_LIMITS`, `RiskLimits` (already imported in the shell).
- Produces: no new exports; behavior change only (persisted, restored risk limits).

- [ ] **Step 1: Update the shared persistence mock and add failing shell tests**

In `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`, extend `baseSetupPersistence` with the two new fields:

```ts
const baseSetupPersistence = {
  loaded: true, appropriatenessSigned: false, selectedStrategy: null, savedRiskLimits: null,
  saveAppropriateness: vi.fn(async () => ({ ok: true })),
  saveStrategy: vi.fn(async () => ({ ok: true })),
  saveRiskLimits: vi.fn(async () => ({ ok: true })),
}
```

Add `savedRiskLimits` + `saveRiskLimits` to the two existing per-test overrides (the "seeds the appropriateness precondition" test and the "shows an error banner and does not sign" test) so their returned objects stay shape-complete — add these two properties to each override object literal:

```ts
      savedRiskLimits: null,
      saveRiskLimits: vi.fn(async () => ({ ok: true })),
```

Add an import for the default limits near the top of the test file:

```ts
import { DEFAULT_RISK_LIMITS } from '../risk/riskLimits'
```

Add these two test cases inside the `describe('ClientPortalShell', …)` block:

```ts
  it('seeds the risk precondition from persisted risk limits on load', async () => {
    vi.mocked(useSetupPersistence).mockReturnValue({
      ...baseSetupPersistence, savedRiskLimits: DEFAULT_RISK_LIMITS,
    })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/risk" onSignOut={() => {}} />)
    // With the risk precondition seeded, the disabled activate button's outstanding list omits "Risk limits".
    await waitFor(() => {
      const activate = screen.getByRole('button', { name: /^activate$/i })
      expect(activate.getAttribute('title') ?? '').not.toMatch(/risk limits/i)
    })
  })

  it('shows an error banner and does not flip the risk precondition when the save fails', async () => {
    vi.mocked(useSetupPersistence).mockReturnValue({
      ...baseSetupPersistence, saveRiskLimits: vi.fn(async () => ({ ok: false, error: 'risk save failed' })),
    })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/risk" onSignOut={() => {}} />)
    await userEvent.click(screen.getAllByRole('button', { name: /apply deployment/i })[0])
    expect(await screen.findByText(/risk save failed/i)).toBeInTheDocument()
    // Precondition not flipped: the activate button still lists "Risk limits" as outstanding.
    const activate = screen.getByRole('button', { name: /^activate$/i })
    expect(activate.getAttribute('title') ?? '').toMatch(/risk limits/i)
  })
```

Also add `waitFor` to the testing-library import at the top of the file:

```ts
import { render, screen, waitFor } from '@testing-library/react'
```

- [ ] **Step 2: Run tests to verify the new cases fail**

Run: `pnpm vitest run src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`
Expected: FAIL on the two new cases — save failure currently flips the precondition (sync `applyRisk`) and there is no `persistError` from a risk save; the seed case may already pass, but the save-failure case must fail until Step 3.

- [ ] **Step 3: Implement the shell changes**

In `src/features/clientPortal/ClientPortalShell.tsx`:

Change the `riskLimits` state to a null sentinel (line ~45):

```ts
  const [riskLimits, setRiskLimits] = React.useState<RiskLimits | null>(null)
```

Add a derived effective value just after the state declarations (before the seeding effect):

```ts
  const effectiveLimits = riskLimits ?? DEFAULT_RISK_LIMITS
```

Extend the seeding effect to promote the risk precondition and seed the limits (promote-only):

```ts
  React.useEffect(() => {
    if (!persistence.loaded) return
    setSetupStatus((s) => ({
      ...s,
      appropriateness: s.appropriateness || persistence.appropriatenessSigned,
      strategy: s.strategy || !!persistence.selectedStrategy,
      riskLimits: s.riskLimits || !!persistence.savedRiskLimits,
    }))
    if (persistence.selectedStrategy) setStrategy((cur) => cur ?? persistence.selectedStrategy)
    if (persistence.savedRiskLimits) setRiskLimits((cur) => cur ?? persistence.savedRiskLimits)
  }, [persistence.loaded, persistence.appropriatenessSigned, persistence.selectedStrategy, persistence.savedRiskLimits])
```

Replace the synchronous `applyRisk` with the async persist-first version:

```ts
  const applyRisk = React.useCallback(async (next: RiskLimits) => {
    const r = await persistence.saveRiskLimits(next)
    if (!r.ok) { setPersistError(r.error ?? 'Could not save your risk limits. Please try again.'); return }
    setPersistError(null)
    setRiskLimits(next)
    setSetupStatus((s) => ({ ...s, riskLimits: true }))
    appendAudit('RISK_PARAM', 'risk & greek limits applied')
  }, [persistence.saveRiskLimits, appendAudit])
```

Pass the derived value (never null) to `RiskPage`:

```tsx
          {page === 'risk' ? (
            <RiskPage limits={effectiveLimits} onApply={applyRisk} />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`
Expected: PASS — new cases plus all existing cases (including "flips the risk setup status on apply" and the end-to-end activation flow, since the default mock's `saveRiskLimits` resolves `{ ok: true }`).

- [ ] **Step 5: Run the full suite + typecheck + build**

Run: `pnpm vitest run && pnpm tsc --noEmit && pnpm build`
Expected: all tests pass, no type errors, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/features/clientPortal/ClientPortalShell.tsx src/features/clientPortal/__tests__/ClientPortalShell.test.tsx
git commit -m "feat(portal): persist + restore risk limits via null-sentinel state and async apply"
```

---

## Self-Review

**Spec coverage:**
- Schema (§3) → Task 1 Step 1 (migration) ✓
- Repo `parseRiskLimits`/`fetchLatestRiskLimits`/`saveRiskLimits` (§4.1) → Task 1 ✓
- Hook `savedRiskLimits`/`saveRiskLimits` (§4.2) → Task 2 ✓
- Shell null-sentinel refactor, promote-only seeding, async apply (§4.3) → Task 3 ✓
- Data flow (§4.4) → Tasks 2+3 ✓
- Graceful degradation: unconfigured (hook short-circuit, Task 2 Step 3), fetch error (repo `{ ok:false }` → hook ignores, seeds nothing), malformed blob (`parseRiskLimits` → null, Task 1 test), save error (inline banner, Task 3) → all covered ✓
- Testing (§5): parse pure tests, repo fetch/save/malformed, hook seed/save, shell seed + save-failure → Tasks 1–3 ✓
- Non-goals (§7): no keys/updates/activation/audit persistence, no greek engine, no provenance UI — none introduced ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `parseRiskLimits`, `fetchLatestRiskLimits`, `saveRiskLimits` signatures identical across Task 1 (def), Task 2 (consume), and tests. Hook return field names `savedRiskLimits`/`saveRiskLimits` identical across Task 2 and Task 3. `RiskLimits`/`Band` imported from the single source in every file. `applyRisk` remains `(next: RiskLimits) => …` — `RiskPage`'s existing `onApply` contract is unchanged, only its `async` nature differs (a fire-and-forget handler React tolerates). ✓
