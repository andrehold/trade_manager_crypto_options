# Client Portal Persistence Slice 6 — Durable Audit Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every client/system audit entry to an append-only `audit_events` table and show the client's real persisted history on the Audit log page.

**Architecture:** One append-only `audit_events` table (per-client RLS) stores each entry (type/detail/actor/ts). A new `auditRepo` provides a pure `mapAuditRow` + `fetchAuditEvents`/`saveAuditEvent`. `useSetupPersistence` gains `persistedAudit` + `saveAuditEvent`. `ClientPortalShell` layers a `sessionAudit` list over `persistedAudit`; `appendAudit` (the single chokepoint) prepends optimistically and fires a best-effort persist; the log falls back to `SEED_AUDIT_EVENTS` only when empty and no DB is configured.

**Tech Stack:** React 18 + TypeScript, Supabase JS client, Vitest + Testing Library, pnpm.

## Global Constraints

- Repos and hook return a discriminated `{ ok: true; … } | { ok: false; error: string }` result and **never throw to the UI**.
- Import `AuditEvent`/`AuditType`/`AuditActor` from `src/features/clientPortal/audit.ts` — do not redefine.
- Audit persistence is **best-effort**: `appendAudit` fires the insert in the background, logs on failure, and never blocks or surfaces a banner (the domain action already persisted its own data persist-first).
- The log shows real persisted history; `SEED_AUDIT_EVENTS` is a fallback **only** when the real log is empty AND `!hasSupabaseClient()`. `SEED_AUDIT_EVENTS` is display-only and is never persisted.
- Design tokens only — no raw zinc/hex (this slice touches no new visual markup; `AuditLogPage` is unchanged).
- No new dependencies; no dependency-version changes (Vitest pinned; Vite stays v5).
- Tests run with `pnpm vitest run <path>`; full verification also runs `pnpm tsc --noEmit` and `pnpm build`.
- Migrations are written here but **applied by the user** — no task runs SQL against a live DB.
- The append-only log has **no update or delete**.

---

### Task 1: Migration + `auditRepo`

Creates the table migration and the repo (pure `mapAuditRow` + `fetchAuditEvents`/`saveAuditEvent`). The migration is scaffolding the repo consumes, so it lives here.

**Files:**
- Create: `supabase/migrations/20260808_add_audit_events.sql`
- Create: `src/lib/clientPortal/auditRepo.ts`
- Test: `src/lib/clientPortal/__tests__/auditRepo.test.ts`

**Interfaces:**
- Consumes: `SupabaseClient` from `@supabase/supabase-js`; `AuditEvent`/`AuditType`/`AuditActor` from `@/features/clientPortal/audit`.
- Produces:
  - `mapAuditRow(row: unknown): AuditEvent | null`
  - `fetchAuditEvents(supabase, clientName): Promise<{ ok: true; events: AuditEvent[] } | { ok: false; error: string }>`
  - `saveAuditEvent(supabase, clientName, event: AuditEvent): Promise<{ ok: true } | { ok: false; error: string }>`

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260808_add_audit_events.sql`:

```sql
-- Append-only client audit log. Every client/system action is recorded as one immutable row.
-- type/actor stored as free text (the UI tolerates unknown types via a colour fallback). Same
-- per-client RLS + admin-read pattern.
create table if not exists public.audit_events (
  id          uuid primary key default gen_random_uuid(),
  client_name text not null,
  created_by  uuid default auth.uid(),
  type        text not null,
  detail      text not null,
  actor       text not null,
  ts          timestamptz not null default now()
);

create index if not exists audit_events_client_idx
  on public.audit_events (client_name);
create index if not exists audit_events_client_ts_idx
  on public.audit_events (client_name, ts);

alter table public.audit_events enable row level security;

create policy "Clients read own audit events"
  on public.audit_events for select
  using (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Clients insert own audit events"
  on public.audit_events for insert
  with check (client_name = (auth.jwt() -> 'user_metadata' ->> 'client_name'));

create policy "Admins read all audit events"
  on public.audit_events for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/clientPortal/__tests__/auditRepo.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mapAuditRow, fetchAuditEvents, saveAuditEvent } from '../auditRepo'
import type { AuditEvent } from '@/features/clientPortal/audit'

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

describe('mapAuditRow', () => {
  it('maps a well-formed row', () => {
    expect(mapAuditRow({ id: 'a1', type: 'UPDATE', detail: 'approved v2.4.1', actor: 'client', ts: 't1' }))
      .toEqual({ id: 'a1', ts: 't1', actor: 'client', type: 'UPDATE', detail: 'approved v2.4.1' })
  })
  it('coerces actor: system stays system, anything else becomes client', () => {
    expect(mapAuditRow({ id: 'a', type: 'EXECUTION', detail: 'd', actor: 'system', ts: 't' })?.actor).toBe('system')
    expect(mapAuditRow({ id: 'a', type: 'X', detail: 'd', actor: 'weird', ts: 't' })?.actor).toBe('client')
    expect(mapAuditRow({ id: 'a', type: 'X', detail: 'd', ts: 't' })?.actor).toBe('client')
  })
  it('returns null when a required string field is missing or wrong-typed', () => {
    expect(mapAuditRow({ type: 'X', detail: 'd', actor: 'client', ts: 't' })).toBeNull()
    expect(mapAuditRow({ id: 'a', detail: 'd', actor: 'client', ts: 't' })).toBeNull()
    expect(mapAuditRow({ id: 'a', type: 'X', actor: 'client', ts: 't' })).toBeNull()
    expect(mapAuditRow({ id: 'a', type: 'X', detail: 'd', actor: 'client', ts: 5 })).toBeNull()
    expect(mapAuditRow(null)).toBeNull()
  })
})

describe('fetchAuditEvents', () => {
  it('returns the mapped events ordered by the client, dropping malformed rows', async () => {
    const { client, from, q } = mockClient({ selectData: [
      { id: 'a1', type: 'UPDATE', detail: 'd1', actor: 'client', ts: '2' },
      { nonsense: true },
      { id: 'a2', type: 'ACTIVATION', detail: 'd2', actor: 'client', ts: '1' },
    ] })
    const r = await fetchAuditEvents(client, 'TwoPrime')
    expect(from).toHaveBeenCalledWith('audit_events')
    expect(q.eq).toHaveBeenCalledWith('client_name', 'TwoPrime')
    expect(q.order).toHaveBeenCalledWith('ts', { ascending: false })
    expect(r).toEqual({ ok: true, events: [
      { id: 'a1', ts: '2', actor: 'client', type: 'UPDATE', detail: 'd1' },
      { id: 'a2', ts: '1', actor: 'client', type: 'ACTIVATION', detail: 'd2' },
    ] })
  })
  it('returns an error result on query failure', async () => {
    const { client } = mockClient({ selectData: [], selectError: { message: 'boom' } })
    expect(await fetchAuditEvents(client, 'TwoPrime')).toEqual({ ok: false, error: 'boom' })
  })
})

describe('saveAuditEvent', () => {
  const EV: AuditEvent = { id: 'evt-1-abc', ts: '2026-08-01T00:00:00Z', actor: 'client', type: 'UPDATE', detail: 'approved v2.4.1' }
  it('inserts the event fields (not the client id)', async () => {
    const { client, q } = mockClient({})
    const r = await saveAuditEvent(client, 'TwoPrime', EV)
    expect(q.insert).toHaveBeenCalledWith({ client_name: 'TwoPrime', type: 'UPDATE', detail: 'approved v2.4.1', actor: 'client', ts: '2026-08-01T00:00:00Z' })
    expect(r).toEqual({ ok: true })
  })
  it('returns an error result on insert failure', async () => {
    const { client } = mockClient({ insertError: { message: 'denied' } })
    expect(await saveAuditEvent(client, 'TwoPrime', EV)).toEqual({ ok: false, error: 'denied' })
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/clientPortal/__tests__/auditRepo.test.ts`
Expected: FAIL — `auditRepo` module / exports not found.

- [ ] **Step 4: Write the repo implementation**

Create `src/lib/clientPortal/auditRepo.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuditEvent, AuditType, AuditActor } from '@/features/clientPortal/audit'

export type FetchAuditResult = { ok: true; events: AuditEvent[] } | { ok: false; error: string }
export type SaveAuditResult = { ok: true } | { ok: false; error: string }

// Validating map of an untyped row. Returns null on a malformed row so callers drop it from the list.
export function mapAuditRow(row: unknown): AuditEvent | null {
  if (typeof row !== 'object' || row === null) return null
  const o = row as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.type !== 'string' || typeof o.detail !== 'string' || typeof o.ts !== 'string') return null
  const actor: AuditActor = o.actor === 'system' ? 'system' : 'client'
  return { id: o.id, ts: o.ts, actor, type: o.type as AuditType, detail: o.detail }
}

export async function fetchAuditEvents(supabase: SupabaseClient, clientName: string): Promise<FetchAuditResult> {
  const { data, error } = await supabase
    .from('audit_events')
    .select('id, type, detail, actor, ts')
    .eq('client_name', clientName)
    .order('ts', { ascending: false })
  if (error) return { ok: false, error: error.message }
  const events = (data ?? []).map(mapAuditRow).filter((e): e is AuditEvent => e !== null)
  return { ok: true, events }
}

export async function saveAuditEvent(supabase: SupabaseClient, clientName: string, event: AuditEvent): Promise<SaveAuditResult> {
  const { error } = await supabase.from('audit_events').insert({
    client_name: clientName, type: event.type, detail: event.detail, actor: event.actor, ts: event.ts,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/lib/clientPortal/__tests__/auditRepo.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260808_add_audit_events.sql src/lib/clientPortal/auditRepo.ts src/lib/clientPortal/__tests__/auditRepo.test.ts
git commit -m "feat(portal): audit_events migration + auditRepo (append-only, mapAuditRow)"
```

---

### Task 2: Extend `useSetupPersistence`

Adds the audit fetch to the parallel load and exposes `persistedAudit` + `saveAuditEvent`. Also adds the two new fields to the shell-test's shared persistence mock so `pnpm tsc` stays green.

**Files:**
- Modify: `src/features/clientPortal/useSetupPersistence.ts`
- Test: `src/features/clientPortal/__tests__/useSetupPersistence.test.tsx`
- Modify (tsc-required collateral): `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`

**Interfaces:**
- Consumes: `fetchAuditEvents`, `saveAuditEvent` from `@/lib/clientPortal/auditRepo` (Task 1); `AuditEvent` from `@/features/clientPortal/audit`.
- Produces: the hook return object gains `persistedAudit: AuditEvent[]` and `saveAuditEvent(event: AuditEvent): Promise<{ ok: boolean; error?: string }>`.

- [ ] **Step 1: Add the failing test cases**

In `src/features/clientPortal/__tests__/useSetupPersistence.test.tsx`, add a repo mock alongside the existing `vi.mock` calls:

```ts
vi.mock('@/lib/clientPortal/auditRepo', () => ({
  fetchAuditEvents: vi.fn(), saveAuditEvent: vi.fn(),
}))
```

Add imports alongside the existing repo imports:

```ts
import { fetchAuditEvents, saveAuditEvent as saveAuditEventRepo } from '@/lib/clientPortal/auditRepo'
```

Add mocked handles next to the existing ones:

```ts
const fAud = vi.mocked(fetchAuditEvents)
const sAud = vi.mocked(saveAuditEventRepo)
```

In the existing `beforeEach`, add default resolutions:

```ts
  fAud.mockResolvedValue({ ok: true, events: [] })
  sAud.mockResolvedValue({ ok: true })
```

Add these test cases inside the `describe('useSetupPersistence', …)` block:

```ts
  it('seeds persistedAudit from a fetched set', async () => {
    fAud.mockResolvedValue({ ok: true, events: [{ id: 'a1', ts: 't1', actor: 'client', type: 'UPDATE', detail: 'd1' }] })
    const { result } = renderHook(() => useSetupPersistence('TwoPrime'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.persistedAudit).toEqual([{ id: 'a1', ts: 't1', actor: 'client', type: 'UPDATE', detail: 'd1' }])
  })

  it('saveAuditEvent delegates to the repo and returns its result', async () => {
    const { result } = renderHook(() => useSetupPersistence('TwoPrime'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    const ev = { id: 'evt-x', ts: 't', actor: 'client' as const, type: 'UPDATE' as const, detail: 'd' }
    const r = await result.current.saveAuditEvent(ev)
    expect(sAud).toHaveBeenCalledWith(expect.anything(), 'TwoPrime', ev)
    expect(r).toEqual({ ok: true })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/clientPortal/__tests__/useSetupPersistence.test.tsx`
Expected: FAIL — `persistedAudit`/`saveAuditEvent` undefined on the hook result.

- [ ] **Step 3: Implement the hook changes**

In `src/features/clientPortal/useSetupPersistence.ts`, add imports:

```ts
import { fetchAuditEvents, saveAuditEvent as saveAuditEventRow } from '@/lib/clientPortal/auditRepo'
import type { AuditEvent } from '@/features/clientPortal/audit'
```

Add state alongside the existing `useState` declarations:

```ts
  const [persistedAudit, setPersistedAudit] = React.useState<AuditEvent[]>([])
```

In the load effect, add the fetch to the `Promise.all` and seed. Replace the existing `Promise.all` block with:

```ts
      const [appr, strat, risk, keys, activation, updates, audit] = await Promise.all([
        fetchLatestAppropriateness(supabase, clientName),
        fetchLatestStrategy(supabase, clientName),
        fetchLatestRiskLimits(supabase, clientName),
        fetchActiveKeys(supabase, clientName),
        fetchActivationState(supabase, clientName),
        fetchApprovedVersions(supabase, clientName),
        fetchAuditEvents(supabase, clientName),
      ])
      if (ignore) return
      if (appr.ok && appr.record) setAppropriatenessSigned(true)
      if (strat.ok && strat.module) setSelectedStrategy(strat.module)
      if (risk.ok && risk.limits) setSavedRiskLimits(risk.limits)
      if (keys.ok) setActiveKeys(keys.keys)
      if (activation.ok) setPersistedActive(activation.active)
      if (updates.ok) setApprovedVersions(updates.versions)
      if (audit.ok) setPersistedAudit(audit.events)
      setLoaded(true)
```

Add the save callback after `saveUpdateApproval`:

```ts
  const saveAuditEvent = React.useCallback(async (event: AuditEvent): Promise<SaveResult> => {
    if (!hasSupabaseClient()) return { ok: true }
    const r = await saveAuditEventRow(getSupabaseClient(), clientName, event)
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }, [clientName])
```

Add both to the returned object:

```ts
  return { loaded, appropriatenessSigned, selectedStrategy, savedRiskLimits, activeKeys, persistedActive, approvedVersions, persistedAudit, saveAppropriateness, saveStrategy, saveRiskLimits, addExchangeKey, revokeExchangeKey, saveActivation, saveUpdateApproval, saveAuditEvent }
```

- [ ] **Step 4: Update the shell-test mock so tsc stays green**

In `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`, add the two new fields to `baseSetupPersistence`:

```ts
  persistedAudit: [],
  saveAuditEvent: vi.fn(async () => ({ ok: true })),
```

Also add the same two fields to any OTHER full-object `useSetupPersistence` override in this file (search for `mockReturnValue({` — object literals that do NOT spread `...baseSetupPersistence` must stay shape-complete; spread-based overrides need nothing).

> Do not change the shell component or other shell tests in this task — only the mock shape. The shell does not read `persistedAudit`/`saveAuditEvent` until Task 3, which is fine.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/features/clientPortal/__tests__/useSetupPersistence.test.tsx && pnpm vitest run src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`
Expected: PASS (new hook cases + existing hook cases; shell tests still green).

- [ ] **Step 6: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/features/clientPortal/useSetupPersistence.ts src/features/clientPortal/__tests__/useSetupPersistence.test.tsx src/features/clientPortal/__tests__/ClientPortalShell.test.tsx
git commit -m "feat(portal): useSetupPersistence exposes persistedAudit + saveAuditEvent"
```

---

### Task 3: Wire the shell — session audit layered over persisted, best-effort persist

Refactors the shell's audit state to layer this session's entries over the persisted history, makes `appendAudit` fire a best-effort persist, and derives the displayed log with the SEED fallback. Restores the whole repo to green.

**Files:**
- Modify: `src/features/clientPortal/ClientPortalShell.tsx`
- Test: `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`

**Interfaces:**
- Consumes: `persistedAudit`, `saveAuditEvent` from `useSetupPersistence` (Task 2); `hasSupabaseClient` from `@/lib/supabase`; `AuditActor` from `@/features/clientPortal/audit`.
- Produces: no new exports; behavior change (persisted, real-history audit log).

- [ ] **Step 1: Add the failing shell tests**

In `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`, add these two test cases inside the `describe('ClientPortalShell', …)` block:

```ts
  it('renders persisted audit entries on the audit log page', async () => {
    vi.mocked(useSetupPersistence).mockReturnValue({
      ...baseSetupPersistence,
      persistedAudit: [{ id: 'a1', ts: '2026-08-01T00:00:00Z', actor: 'client', type: 'STRATEGY', detail: 'selected module "Twin Flow"' }],
    })
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/audit" onSignOut={() => {}} />)
    expect(await screen.findByText(/selected module "Twin Flow"/i)).toBeInTheDocument()
  })

  it('appends a visible audit entry and persists it when the client acts', async () => {
    const saveAuditEvent = vi.fn(async () => ({ ok: true }))
    vi.mocked(useSetupPersistence).mockReturnValue({ ...baseSetupPersistence, saveAuditEvent })
    const base = { clientName: 'TwoPrime', program: 'Obsidian Core', onSignOut: () => {} }
    const { rerender } = render(<ClientPortalShell {...base} hash="#/portal/updates" />)
    await userEvent.click(await screen.findByRole('button', { name: /approve & install/i }))
    expect(saveAuditEvent).toHaveBeenCalled()
    rerender(<ClientPortalShell {...base} hash="#/portal/audit" />)
    expect(screen.getByText(/reviewed & approved v2\.4\.1/i)).toBeInTheDocument()
  })
```

> The existing test "renders the audit log with seed entries" now exercises the SEED fallback path (default test env: `persistedAudit: []`, `hasSupabaseClient()` false) and must keep passing unchanged.

- [ ] **Step 2: Run tests to verify the new cases fail**

Run: `pnpm vitest run src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`
Expected: FAIL — the shell still seeds `auditEvents` from `SEED_AUDIT_EVENTS` and does not read `persistedAudit` or call `saveAuditEvent`.

- [ ] **Step 3: Implement the shell changes**

In `src/features/clientPortal/ClientPortalShell.tsx`:

Update the audit import (line 23) to add `AuditActor`:

```ts
import { newEvent, SEED_AUDIT_EVENTS, type AuditEvent, type AuditType, type AuditActor } from './audit'
```

Add the supabase import near the other `@/lib` imports:

```ts
import { hasSupabaseClient } from '@/lib/supabase'
```

Replace the audit state declaration (currently `const [auditEvents, setAuditEvents] = React.useState<AuditEvent[]>(SEED_AUDIT_EVENTS)`) with:

```ts
  const [sessionAudit, setSessionAudit] = React.useState<AuditEvent[]>([])
```

Replace the `appendAudit` callback (currently prepends `newEvent(...)` to `setAuditEvents`) with the optimistic + best-effort-persist version:

```ts
  const appendAudit = React.useCallback((type: AuditType, detail: string, actor: AuditActor = 'client') => {
    const e = newEvent(type, detail, actor)
    setSessionAudit((evs) => [e, ...evs])
    persistence.saveAuditEvent(e).then((r) => { if (!r.ok) console.error('audit persist failed', r.error) })
  }, [persistence.saveAuditEvent])
```

Add the derived display value immediately after `appendAudit` (real history layered under this session's entries; SEED only when empty and no DB):

```ts
  const shownAudit = React.useMemo(() => {
    const real = [...sessionAudit, ...persistence.persistedAudit]
    if (real.length > 0) return real
    return hasSupabaseClient() ? [] : SEED_AUDIT_EVENTS
  }, [sessionAudit, persistence.persistedAudit])
```

Update the `AuditLogPage` render (currently `<AuditLogPage events={auditEvents} clientName={clientName} />`):

```tsx
            <AuditLogPage events={shownAudit} clientName={clientName} />
```

- [ ] **Step 4: Run the shell tests to verify they pass**

Run: `pnpm vitest run src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`
Expected: PASS — the two new cases, the existing seed-fallback case, and all other cases.

- [ ] **Step 5: Full verification**

Run: `pnpm vitest run && pnpm tsc --noEmit && pnpm build`
Expected: all tests pass, no type errors, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/features/clientPortal/ClientPortalShell.tsx src/features/clientPortal/__tests__/ClientPortalShell.test.tsx
git commit -m "feat(portal): durable audit log — session entries over persisted history, best-effort persist"
```

---

## Self-Review

**Spec coverage:**
- Schema (§3) → Task 1 Step 1 (migration) ✓
- Repo `mapAuditRow`/`fetchAuditEvents`/`saveAuditEvent` (§4.1) → Task 1 ✓
- Hook `persistedAudit`/`saveAuditEvent` (§4.2) → Task 2 ✓
- Shell `sessionAudit`, best-effort `appendAudit`, `shownAudit` with SEED-only-when-empty-and-no-DB, `hasSupabaseClient` import (§4.3) → Task 3 Step 3 ✓
- AuditLogPage unchanged (§4.4) → confirmed (no task touches it) ✓
- Data flow (§4.5) → Tasks 2+3 ✓
- Graceful degradation: unconfigured (hook short-circuit + SEED fallback), fetch error (repo `{ok:false}` → hook ignores → empty), save error (console.error, no block/surface — best-effort) → all covered ✓
- Testing (§5): mapAuditRow valid/malformed/actor-coerce; repo fetch mapped+dropped+error + save payload/error; hook seed/delegate; shell persisted-renders + action-appends-and-persists + seed-fallback (existing test) → Tasks 1–3 ✓
- Non-goals (§7): no DB trigger; CSV/tamper-evident stub untouched; SEED never persisted → none introduced ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `mapAuditRow`/`fetchAuditEvents`/`saveAuditEvent` signatures identical across Task 1 (def), Task 2 (consume/re-expose), and tests. Hook return fields `persistedAudit`/`saveAuditEvent` identical across Task 2 def, the shell-mock (Task 2 Step 4), and Task 3 consumption. `AuditEvent`/`AuditType`/`AuditActor` imported from the single source `@/features/clientPortal/audit` in every file. `appendAudit` changes its `actor` default type annotation from an inline `'client' | 'system'` to the equivalent `AuditActor` (same values) — all existing call sites pass no actor or `'client'`/`'system'` literals, which remain assignable. `shownAudit` (type `AuditEvent[]`) feeds `AuditLogPage`'s existing `events: AuditEvent[]` prop. ✓
