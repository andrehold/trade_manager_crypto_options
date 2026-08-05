# Client Portal Persistence Slice 5 — Update Approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the client's software-update approvals to Supabase as an append-only version log, so a previously approved update restores as Installed on reload.

**Architecture:** One append-only `update_approvals` table (per-client RLS) stores immutable `(version, ts)` rows; the set of approved versions is read on load. A new `updatesRepo` provides `fetchApprovedVersions`/`saveUpdateApproval`. `useSetupPersistence` gains `approvedVersions` + `saveUpdateApproval`. `ClientPortalShell` holds a `null`-sentinel `approvedVersions`, seeds it promote-only, and makes `approveUpdate` persist-first. `UpdatesPage` becomes controlled — `installed` is derived from `approvedVersions`, no local state.

**Tech Stack:** React 18 + TypeScript, Supabase JS client, Vitest + Testing Library, pnpm.

## Global Constraints

- Repos and hook return a discriminated `{ ok: true; … } | { ok: false; error: string }` result and **never throw to the UI**.
- Design tokens only — no raw zinc/hex. Use the existing token classes (`bg-bg-surface-*`, `text-text-*`, `border-border-*`, `text-status-*`, `type-*`).
- Seeding is promote-only (`cur ?? …`) — never revert a locally-set value.
- Updates are **not** a setup precondition — nothing here touches `setupStatus` or the activation gate.
- No new dependencies; no dependency-version changes (Vitest pinned; Vite stays v5).
- Tests run with `pnpm vitest run <path>`; full verification also runs `pnpm tsc --noEmit` and `pnpm build`.
- Migrations are written here but **applied by the user** — no task runs SQL against a live DB.
- The append-only log has **no update or delete**.

---

### Task 1: Migration + `updatesRepo`

Creates the table migration and the repo (`fetchApprovedVersions` + `saveUpdateApproval`). The migration is scaffolding the repo consumes, so it lives here.

**Files:**
- Create: `supabase/migrations/20260807_add_update_approvals.sql`
- Create: `src/lib/clientPortal/updatesRepo.ts`
- Test: `src/lib/clientPortal/__tests__/updatesRepo.test.ts`

**Interfaces:**
- Consumes: `SupabaseClient` from `@supabase/supabase-js`.
- Produces:
  - `fetchApprovedVersions(supabase, clientName): Promise<{ ok: true; versions: string[] } | { ok: false; error: string }>`
  - `saveUpdateApproval(supabase, clientName, version: string): Promise<{ ok: true } | { ok: false; error: string }>`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260807_add_update_approvals.sql`:

```sql
-- Append-only client software-update approvals. The set of approved versions is read on load to restore
-- the "installed" state of pending updates. Same per-client RLS + admin-read pattern.
create table if not exists public.update_approvals (
  id          uuid primary key default gen_random_uuid(),
  client_name text not null,
  created_by  uuid default auth.uid(),
  version     text not null,
  ts          timestamptz not null default now()
);

create index if not exists update_approvals_client_idx
  on public.update_approvals (client_name);
create index if not exists update_approvals_client_ts_idx
  on public.update_approvals (client_name, ts);

alter table public.update_approvals enable row level security;

create policy "Clients read own update approvals"
  on public.update_approvals for select
  using (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Clients insert own update approvals"
  on public.update_approvals for insert
  with check (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Admins read all update approvals"
  on public.update_approvals for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/clientPortal/__tests__/updatesRepo.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchApprovedVersions, saveUpdateApproval } from '../updatesRepo'

function mockClient(over: { selectData?: unknown[]; selectError?: { message: string } | null; insertError?: { message: string } | null }) {
  const q = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: over.selectData ?? [], error: over.selectError ?? null }),
    insert: vi.fn().mockResolvedValue({ error: over.insertError ?? null }),
  }
  const from = vi.fn().mockReturnValue(q)
  return { client: { from } as unknown as SupabaseClient, from, q }
}

describe('fetchApprovedVersions', () => {
  it('returns the deduped approved version set for the client (insertion order)', async () => {
    const { client, from, q } = mockClient({ selectData: [{ version: 'v2.4.1' }, { version: 'v2.4.1' }, { version: 'v2.3.5' }] })
    const r = await fetchApprovedVersions(client, 'TwoPrime')
    expect(from).toHaveBeenCalledWith('update_approvals')
    expect(q.select).toHaveBeenCalledWith('version')
    expect(q.eq).toHaveBeenCalledWith('client_name', 'TwoPrime')
    expect(r).toEqual({ ok: true, versions: ['v2.4.1', 'v2.3.5'] })
  })
  it('returns an empty set with no rows', async () => {
    const { client } = mockClient({ selectData: [] })
    expect(await fetchApprovedVersions(client, 'TwoPrime')).toEqual({ ok: true, versions: [] })
  })
  it('skips a non-string version', async () => {
    const { client } = mockClient({ selectData: [{ version: 5 }, { version: 'v2.4.1' }] })
    expect(await fetchApprovedVersions(client, 'TwoPrime')).toEqual({ ok: true, versions: ['v2.4.1'] })
  })
  it('returns an error result on query failure', async () => {
    const { client } = mockClient({ selectData: [], selectError: { message: 'boom' } })
    expect(await fetchApprovedVersions(client, 'TwoPrime')).toEqual({ ok: false, error: 'boom' })
  })
})

describe('saveUpdateApproval', () => {
  it('inserts the approval', async () => {
    const { client, q } = mockClient({})
    const r = await saveUpdateApproval(client, 'TwoPrime', 'v2.4.1')
    expect(q.insert).toHaveBeenCalledWith({ client_name: 'TwoPrime', version: 'v2.4.1' })
    expect(r).toEqual({ ok: true })
  })
  it('returns an error result on insert failure', async () => {
    const { client } = mockClient({ insertError: { message: 'denied' } })
    expect(await saveUpdateApproval(client, 'TwoPrime', 'v2.4.1')).toEqual({ ok: false, error: 'denied' })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/clientPortal/__tests__/updatesRepo.test.ts`
Expected: FAIL — `updatesRepo` module / exports not found.

- [ ] **Step 4: Write the repo implementation**

Create `src/lib/clientPortal/updatesRepo.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export type FetchApprovedVersionsResult = { ok: true; versions: string[] } | { ok: false; error: string }
export type SaveUpdateApprovalResult = { ok: true } | { ok: false; error: string }

export async function fetchApprovedVersions(supabase: SupabaseClient, clientName: string): Promise<FetchApprovedVersionsResult> {
  const { data, error } = await supabase
    .from('update_approvals')
    .select('version')
    .eq('client_name', clientName)
  if (error) return { ok: false, error: error.message }
  const rows = (data ?? []) as { version: unknown }[]
  const versions = Array.from(new Set(rows.map((r) => r.version).filter((v): v is string => typeof v === 'string')))
  return { ok: true, versions }
}

export async function saveUpdateApproval(supabase: SupabaseClient, clientName: string, version: string): Promise<SaveUpdateApprovalResult> {
  const { error } = await supabase.from('update_approvals').insert({ client_name: clientName, version })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/lib/clientPortal/__tests__/updatesRepo.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260807_add_update_approvals.sql src/lib/clientPortal/updatesRepo.ts src/lib/clientPortal/__tests__/updatesRepo.test.ts
git commit -m "feat(portal): update_approvals migration + updatesRepo (append-only approved-version set)"
```

---

### Task 2: Extend `useSetupPersistence`

Adds the approved-versions fetch to the parallel load and exposes `approvedVersions` + `saveUpdateApproval`. Also adds the two new fields to the shell-test's shared persistence mock so `pnpm tsc` stays green (the shell consumes the hook's return type).

**Files:**
- Modify: `src/features/clientPortal/useSetupPersistence.ts`
- Test: `src/features/clientPortal/__tests__/useSetupPersistence.test.tsx`
- Modify (tsc-required collateral): `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`

**Interfaces:**
- Consumes: `fetchApprovedVersions`, `saveUpdateApproval` from `@/lib/clientPortal/updatesRepo` (Task 1).
- Produces: the hook return object gains `approvedVersions: string[]` and `saveUpdateApproval(version: string): Promise<{ ok: boolean; error?: string }>`.

- [ ] **Step 1: Add the failing test cases**

In `src/features/clientPortal/__tests__/useSetupPersistence.test.tsx`, add a repo mock alongside the existing `vi.mock` calls:

```ts
vi.mock('@/lib/clientPortal/updatesRepo', () => ({
  fetchApprovedVersions: vi.fn(), saveUpdateApproval: vi.fn(),
}))
```

Add imports alongside the existing repo imports:

```ts
import { fetchApprovedVersions, saveUpdateApproval as saveUpdateApprovalRepo } from '@/lib/clientPortal/updatesRepo'
```

Add mocked handles next to the existing ones:

```ts
const fUpd = vi.mocked(fetchApprovedVersions)
const sUpd = vi.mocked(saveUpdateApprovalRepo)
```

In the existing `beforeEach`, add default resolutions:

```ts
  fUpd.mockResolvedValue({ ok: true, versions: [] })
  sUpd.mockResolvedValue({ ok: true })
```

Add these test cases inside the `describe('useSetupPersistence', …)` block:

```ts
  it('seeds approvedVersions from a fetched set', async () => {
    fUpd.mockResolvedValue({ ok: true, versions: ['v2.4.1'] })
    const { result } = renderHook(() => useSetupPersistence('TwoPrime'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.approvedVersions).toEqual(['v2.4.1'])
  })

  it('saveUpdateApproval delegates to the repo and returns its result', async () => {
    const { result } = renderHook(() => useSetupPersistence('TwoPrime'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    const r = await result.current.saveUpdateApproval('v2.4.1')
    expect(sUpd).toHaveBeenCalledWith(expect.anything(), 'TwoPrime', 'v2.4.1')
    expect(r).toEqual({ ok: true })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/clientPortal/__tests__/useSetupPersistence.test.tsx`
Expected: FAIL — `approvedVersions`/`saveUpdateApproval` undefined on the hook result.

- [ ] **Step 3: Implement the hook changes**

In `src/features/clientPortal/useSetupPersistence.ts`, add the import:

```ts
import { fetchApprovedVersions, saveUpdateApproval as saveUpdateApprovalRow } from '@/lib/clientPortal/updatesRepo'
```

Add state alongside the existing `useState` declarations:

```ts
  const [approvedVersions, setApprovedVersions] = React.useState<string[]>([])
```

In the load effect, add the fetch to the `Promise.all` and seed. Replace the existing `Promise.all` block with:

```ts
      const [appr, strat, risk, keys, activation, updates] = await Promise.all([
        fetchLatestAppropriateness(supabase, clientName),
        fetchLatestStrategy(supabase, clientName),
        fetchLatestRiskLimits(supabase, clientName),
        fetchActiveKeys(supabase, clientName),
        fetchActivationState(supabase, clientName),
        fetchApprovedVersions(supabase, clientName),
      ])
      if (ignore) return
      if (appr.ok && appr.record) setAppropriatenessSigned(true)
      if (strat.ok && strat.module) setSelectedStrategy(strat.module)
      if (risk.ok && risk.limits) setSavedRiskLimits(risk.limits)
      if (keys.ok) setActiveKeys(keys.keys)
      if (activation.ok) setPersistedActive(activation.active)
      if (updates.ok) setApprovedVersions(updates.versions)
      setLoaded(true)
```

Add the save callback after `saveActivation`:

```ts
  const saveUpdateApproval = React.useCallback(async (version: string): Promise<SaveResult> => {
    if (!hasSupabaseClient()) return { ok: true }
    const r = await saveUpdateApprovalRow(getSupabaseClient(), clientName, version)
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }, [clientName])
```

Add both to the returned object:

```ts
  return { loaded, appropriatenessSigned, selectedStrategy, savedRiskLimits, activeKeys, persistedActive, approvedVersions, saveAppropriateness, saveStrategy, saveRiskLimits, addExchangeKey, revokeExchangeKey, saveActivation, saveUpdateApproval }
```

- [ ] **Step 4: Update the shell-test mock so tsc stays green**

In `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`, add the two new fields to `baseSetupPersistence`:

```ts
  approvedVersions: [],
  saveUpdateApproval: vi.fn(async () => ({ ok: true })),
```

Also add the same two fields to any other per-test `useSetupPersistence` override object literals in this file (search for `mockReturnValue({` — each full-object override must stay shape-complete; spread-based overrides that use `...baseSetupPersistence` need nothing).

> Do not change the shell component or other shell tests in this task — only the mock shape. The shell does not read `approvedVersions`/`saveUpdateApproval` until Task 3, which is fine.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/features/clientPortal/__tests__/useSetupPersistence.test.tsx && pnpm vitest run src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`
Expected: PASS (new hook cases + existing hook cases; shell tests still green).

- [ ] **Step 6: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/features/clientPortal/useSetupPersistence.ts src/features/clientPortal/__tests__/useSetupPersistence.test.tsx src/features/clientPortal/__tests__/ClientPortalShell.test.tsx
git commit -m "feat(portal): useSetupPersistence exposes approvedVersions + saveUpdateApproval"
```

---

### Task 3: Controlled `UpdatesPage` + shell wiring

Makes `UpdatesPage` controlled off `approvedVersions`, and wires the shell: null-sentinel `approvedVersions`, promote-only seed, persist-first `approveUpdate`, and the new render prop. Both files change together so `pnpm tsc` never breaks mid-task.

**Files:**
- Modify: `src/features/clientPortal/pages/UpdatesPage.tsx` (full rewrite)
- Modify: `src/features/clientPortal/ClientPortalShell.tsx`
- Test: `src/features/clientPortal/__tests__/UpdatesPage.test.tsx` (rewrite)
- Test: `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`

**Interfaces:**
- Consumes: `approvedVersions`, `saveUpdateApproval` from `useSetupPersistence` (Task 2).
- Produces: `UpdatesPage` with props `{ approvedVersions: string[]; onApprove: (ver: string) => void }`.

- [ ] **Step 1: Rewrite the UpdatesPage test**

Replace the contents of `src/features/clientPortal/__tests__/UpdatesPage.test.tsx` with:

```ts
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UpdatesPage } from '../pages/UpdatesPage'

describe('UpdatesPage', () => {
  it('shows the pending update and approves it', async () => {
    const onApprove = vi.fn()
    render(<UpdatesPage approvedVersions={[]} onApprove={onApprove} />)
    expect(screen.getByText(/1 pending your approval/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /approve & install/i }))
    expect(onApprove).toHaveBeenCalledWith('v2.4.1')
  })

  it('renders Installed when the pending version is already approved', () => {
    render(<UpdatesPage approvedVersions={['v2.4.1']} onApprove={() => {}} />)
    expect(screen.getByRole('button', { name: /installed/i })).toBeDisabled()
    expect(screen.queryByText(/1 pending your approval/i)).toBeNull()
  })
})
```

- [ ] **Step 2: Add the failing shell tests**

In `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`, add these two test cases inside the `describe('ClientPortalShell', …)` block:

```ts
  it('restores the Updates page to Installed when the pending version is persisted', async () => {
    vi.mocked(useSetupPersistence).mockReturnValue({ ...baseSetupPersistence, approvedVersions: ['v2.4.1'] })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/updates" onSignOut={() => {}} />)
    expect(await screen.findByRole('button', { name: /installed/i })).toBeInTheDocument()
  })

  it('shows an error banner and leaves the update pending when the approval save fails', async () => {
    vi.mocked(useSetupPersistence).mockReturnValue({ ...baseSetupPersistence, saveUpdateApproval: vi.fn(async () => ({ ok: false, error: 'update save failed' })) })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/updates" onSignOut={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: /approve & install/i }))
    expect(await screen.findByText(/update save failed/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /approve & install/i })).toBeInTheDocument()
  })
```

- [ ] **Step 3: Run tests to verify the new cases fail**

Run: `pnpm vitest run src/features/clientPortal/__tests__/UpdatesPage.test.tsx src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`
Expected: FAIL — `UpdatesPage` still uses old props (no `approvedVersions`), and the shell still passes only `onApprove` / isn't persist-first.

- [ ] **Step 4: Rewrite `UpdatesPage`**

Replace the contents of `src/features/clientPortal/pages/UpdatesPage.tsx` with:

```tsx
import { Download, Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'

const PENDING = {
  ver: 'v2.4.1',
  changelog: [
    'Deribit reconnection hardening after venue maintenance windows',
    'Drawdown-stop evaluation moved to per-tick (was per-minute)',
    'Audit-log export now includes cryptographic chain hash',
  ],
}
const HISTORY = [
  { ver: 'v2.4.0', date: '2026-07-11', note: 'Portfolio-greeks aggregation fix' },
  { ver: 'v2.3.5', date: '2026-06-28', note: 'CoinCall venue adapter' },
]

export function UpdatesPage({ approvedVersions, onApprove }: { approvedVersions: string[]; onApprove: (ver: string) => void }) {
  const installed = approvedVersions.includes(PENDING.ver)
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="type-title-l font-bold text-text-primary">Software updates</h1>
        <span className="rounded-full bg-bg-surface-2 px-2.5 py-1 font-mono type-caption text-text-tertiary">current v2.4.0</span>
        {!installed && <span className="rounded-full bg-status-warning/15 px-2.5 py-1 type-caption font-semibold text-status-warning">1 pending your approval</span>}
      </div>
      <p className="type-subhead text-text-secondary">Updates install only after you review and approve them. Nothing is applied automatically.</p>
      <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-5">
        <div className={`flex flex-wrap gap-3.5 rounded-xl border p-4 ${installed ? 'border-status-success/30 bg-status-success/10' : 'border-status-warning/30 bg-status-warning/10'}`}>
          <span className={installed ? 'text-status-success' : 'text-status-warning'}>{installed ? <Check className="h-5 w-5" /> : <Download className="h-5 w-5" />}</span>
          <div className="min-w-0 flex-1">
            <div className="type-subhead font-semibold text-text-primary">Update {installed ? 'applied' : 'available'} — <span className="font-mono text-status-warning">{PENDING.ver}</span></div>
            <ul className="mt-2 list-disc pl-4 type-caption text-text-secondary">{PENDING.changelog.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
          <div className="self-center">
            <Button variant="primary" size="sm" disabled={installed} onClick={() => onApprove(PENDING.ver)}>{installed ? 'Installed' : 'Approve & install'}</Button>
          </div>
        </div>
        <div className="mt-4">
          {HISTORY.map((h) => (
            <div key={h.ver} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-default py-2.5 type-caption">
              <span className="w-16 font-mono font-semibold text-text-secondary">{h.ver}</span>
              <span className="font-mono text-text-tertiary">{h.date}</span>
              <span className="text-text-secondary">{h.note}</span>
              <span className="ml-auto text-text-tertiary">approved by <b className="text-text-secondary">R. Quandt</b></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Wire the shell**

In `src/features/clientPortal/ClientPortalShell.tsx`:

Add the null-sentinel state next to `exchangeKeys` (after `const effectiveKeys = exchangeKeys ?? []`):

```ts
  const [approvedVersions, setApprovedVersions] = React.useState<string[] | null>(null)
  const effectiveApproved = approvedVersions ?? []
```

Extend the seed effect to seed `approvedVersions` (promote-only) and add its dep. Add this line inside the effect, right after the `setExchangeKeys` seed line:

```ts
    if (persistence.approvedVersions.length > 0) setApprovedVersions((cur) => cur ?? persistence.approvedVersions)
```

and add `persistence.approvedVersions` to the effect's dependency array (append it to the existing list).

Replace the synchronous `approveUpdate` with the persist-first version:

```ts
  const approveUpdate = React.useCallback(async (ver: string) => {
    const r = await persistence.saveUpdateApproval(ver)
    if (!r.ok) { setPersistError(r.error ?? 'Could not save your update approval. Please try again.'); return }
    setPersistError(null)
    setApprovedVersions((cur) => ((cur ?? []).includes(ver) ? cur : [...(cur ?? []), ver]))
    appendAudit('UPDATE', `reviewed & approved ${ver} → installed`)
  }, [persistence.saveUpdateApproval, appendAudit])
```

Update the `UpdatesPage` render (currently `<UpdatesPage onApprove={approveUpdate} />`):

```tsx
            <UpdatesPage approvedVersions={effectiveApproved} onApprove={approveUpdate} />
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run src/features/clientPortal/__tests__/UpdatesPage.test.tsx src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`
Expected: PASS — UpdatesPage cases + the two new shell cases + all existing cases.

- [ ] **Step 7: Full verification**

Run: `pnpm vitest run && pnpm tsc --noEmit && pnpm build`
Expected: all tests pass, no type errors, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/features/clientPortal/pages/UpdatesPage.tsx src/features/clientPortal/ClientPortalShell.tsx src/features/clientPortal/__tests__/UpdatesPage.test.tsx src/features/clientPortal/__tests__/ClientPortalShell.test.tsx
git commit -m "feat(portal): persist + restore update approvals; controlled UpdatesPage, persist-first approve"
```

---

## Self-Review

**Spec coverage:**
- Schema (§3) → Task 1 Step 1 (migration) ✓
- Repo `fetchApprovedVersions`/`saveUpdateApproval` (§4.1) → Task 1 ✓
- Hook `approvedVersions`/`saveUpdateApproval` (§4.2) → Task 2 ✓
- Shell null-sentinel, promote-only seed, persist-first approve (§4.3) → Task 3 Step 5 ✓
- UpdatesPage controlled: `installed` derived, no local state, `onApprove(PENDING.ver)`, pending badge, history illustrative (§4.4) → Task 3 Step 4 ✓
- Data flow (§4.5) → Tasks 2+3 ✓
- Graceful degradation: unconfigured (hook short-circuit, Task 2 Step 3), fetch error (repo `{ok:false}` → hook ignores → empty), save error (inline banner, Task 3 Step 5) → all covered ✓
- Testing (§5): repo versions/empty/non-string/error + save; hook seed/delegate; UpdatesPage installed/approve; shell restore-installed + save-fail → Tasks 1–3 ✓
- Non-goals (§7): no durable general audit log; history illustrative; no update catalog — none introduced ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `fetchApprovedVersions`/`saveUpdateApproval` signatures identical across Task 1 (def), Task 2 (consume/re-expose), and tests. Hook return fields `approvedVersions`/`saveUpdateApproval` identical across Task 2 def, the shell-mock (Task 2 Step 4), and Task 3 consumption. `UpdatesPage` props `{ approvedVersions, onApprove }` identical across Task 3 def (Step 4) and shell render (Step 5). Shell `approveUpdate` changes from sync `(ver: string) => void` to `async (ver: string) => void` — consumed only by `UpdatesPage.onApprove: (ver: string) => void`, which matches (async handler assignable). The `PENDING.ver` constant (`'v2.4.1'`) is the single version string referenced by both the UpdatesPage derive and the tests. ✓
