# Client Intervention Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a single "Modified" badge on a client's position rows in the client portal whenever the client has intervened on that position — whether through the portal or directly on the venue.

**Architecture:** A new `position_interventions` Supabase table records one row per intervention, keyed by `position_id`, with a `source` of `platform` (portal Modify/Close) or `venue` (backend-written drift, later). A lib helper fetches the latest intervention per position; a portal hook merges those with an optimistic local overlay so the badge appears instantly and works in sample-data mode. The client Positions page renders one row per option leg, so each leg row carries its parent `positionId` and looks the badge up by it.

**Tech Stack:** React + TypeScript, Supabase (`@supabase/supabase-js`), Tailwind v4 semantic tokens, Vitest + React Testing Library.

## Global Constraints

- **No raw colors in components.** Use semantic tokens (`text-text-primary`, `bg-bg-surface-*`, `border-border-*`) or the sanctioned accent scales (`amber-*` for warning/divergence). Never raw zinc/slate/hex.
- **Client scoping:** in the client portal, always fetch/write with `{ clientName, isAdmin: false }`. Admin-vs-client access is enforced in the app layer, matching `fetchSavedStructures` and `saveTransactionLogs`.
- **File style for `src/lib/positions/*` and `src/features/clientPortal/*`:** single quotes, no semicolons, 2-space indent (match `saveTransactionLogs.ts` and `portfolio.ts`).
- **Badge label is exactly `Modified`** for both channels; the source is disclosed only in the tooltip.
- **Test runner:** `pnpm test` runs `vitest run`. Run individual files with `pnpm exec vitest run <path>`.

---

### Task 1: Supabase migration for `position_interventions`

**Files:**
- Create: `supabase/migrations/20260729_add_position_interventions.sql`

**Interfaces:**
- Produces: table `public.position_interventions` with columns `id, position_id, client_name, source, action, detail, created_by, ts`. Consumed by Tasks 2 (fetch/record).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260729_add_position_interventions.sql`:

```sql
-- Records client interventions on a position, from either the portal ('platform')
-- or a change made directly on the exchange that the system later detects ('venue').
-- Admin-vs-client access is enforced in the application layer (isAdmin flag), matching
-- the convention in 20260325_clients_rls_update.sql.
create table if not exists public.position_interventions (
  id          uuid primary key default gen_random_uuid(),
  position_id text not null,
  client_name text,
  source      text not null check (source in ('platform', 'venue')),
  action      text not null check (action in ('open', 'modify', 'close')),
  detail      text,
  created_by  uuid,
  ts          timestamptz not null default now()
);

create index if not exists position_interventions_position_idx
  on public.position_interventions (position_id);

create index if not exists position_interventions_client_idx
  on public.position_interventions (client_name);

create index if not exists position_interventions_ts_idx
  on public.position_interventions (ts desc);

alter table public.position_interventions enable row level security;

create policy "Authenticated users can read interventions"
  on public.position_interventions
  for select
  using (auth.role() = 'authenticated');

create policy "Authenticated users can insert interventions"
  on public.position_interventions
  for insert
  with check (auth.role() = 'authenticated');
```

- [ ] **Step 2: Sanity-check the SQL**

This repo has no automated test for migrations (they are reviewed and applied out of band, like `20241205_add_transaction_logs.sql`). Verify by eye:
- Column names/types match the fetch/record row shapes in Task 2 (`position_id`, `client_name`, `source`, `action`, `detail`, `created_by`, `ts`).
- `check` constraints list exactly `platform`/`venue` and `open`/`modify`/`close`.
- RLS is enabled with `authenticated` select + insert policies.

Expected: file matches the two conventions it is modeled on (`20241205_add_transaction_logs.sql` for the table, `20260325_clients_rls_update.sql` for the policies).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260729_add_position_interventions.sql
git commit -m "feat(db): add position_interventions table + RLS"
```

---

### Task 2: `interventions` lib helper (types, fetch, record, merge)

**Files:**
- Create: `src/lib/positions/interventions.ts`
- Test: `src/lib/positions/__tests__/interventions.test.ts`

**Interfaces:**
- Consumes: `SupabaseClient` type from `@/lib/supabase`, `SupabaseClientScope` from `./clientScope`.
- Produces:
  - `type InterventionSource = 'platform' | 'venue'`
  - `type InterventionAction = 'open' | 'modify' | 'close'`
  - `type PositionIntervention = { positionId: string; source: InterventionSource; action: InterventionAction; detail?: string | null; ts: string }`
  - `type InterventionMap = Map<string, PositionIntervention>`
  - `mergeInterventionMaps(a: InterventionMap, b: InterventionMap): InterventionMap` — newest `ts` per key wins.
  - `fetchPositionInterventions(client, scope?): Promise<{ ok: true; interventions: InterventionMap } | { ok: false; error: string }>`
  - `recordPositionIntervention(client, params): Promise<{ ok: true } | { ok: false; error: string }>` where `params = { positionId, source, action, detail?, clientScope?, createdBy? }`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/positions/__tests__/interventions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  mergeInterventionMaps,
  fetchPositionInterventions,
  recordPositionIntervention,
  type InterventionMap,
} from '../interventions'

// Minimal chainable Supabase mock: select/order/eq return the (thenable) builder,
// awaiting it resolves the select response; insert resolves its own response.
function makeClient(opts: { selectData?: unknown[]; selectError?: { message: string } | null; insertError?: { message: string } | null } = {}) {
  const calls: { eq: [string, string][]; inserted: unknown[] } = { eq: [], inserted: [] }
  const builder: Record<string, unknown> = {
    select: () => builder,
    order: () => builder,
    eq: (col: string, val: string) => { calls.eq.push([col, val]); return builder },
    insert: (row: unknown) => { calls.inserted.push(row); return Promise.resolve({ error: opts.insertError ?? null }) },
    then: (resolve: (v: unknown) => void) => resolve({ data: opts.selectData ?? [], error: opts.selectError ?? null }),
  }
  return { client: { from: () => builder } as never, calls }
}

describe('mergeInterventionMaps', () => {
  it('keeps the newest intervention per position regardless of argument order', () => {
    const older: InterventionMap = new Map([['p1', { positionId: 'p1', source: 'platform', action: 'modify', ts: '2026-07-29T09:00:00Z' }]])
    const newer: InterventionMap = new Map([['p1', { positionId: 'p1', source: 'venue', action: 'close', ts: '2026-07-29T12:00:00Z' }]])
    expect(mergeInterventionMaps(older, newer).get('p1')?.source).toBe('venue')
    expect(mergeInterventionMaps(newer, older).get('p1')?.source).toBe('venue')
  })
})

describe('fetchPositionInterventions', () => {
  it('reduces rows (newest-first) to the latest per position and filters by client', async () => {
    const { client, calls } = makeClient({
      selectData: [
        { position_id: 'p1', client_name: 'Acme', source: 'venue', action: 'close', detail: null, ts: '2026-07-29T12:00:00Z' },
        { position_id: 'p1', client_name: 'Acme', source: 'platform', action: 'modify', detail: null, ts: '2026-07-29T09:00:00Z' },
        { position_id: 'p2', client_name: 'Acme', source: 'platform', action: 'open', detail: null, ts: '2026-07-29T08:00:00Z' },
      ],
    })
    const res = await fetchPositionInterventions(client, { clientName: 'Acme', isAdmin: false })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.interventions.get('p1')?.source).toBe('venue')
      expect(res.interventions.get('p2')?.action).toBe('open')
    }
    expect(calls.eq).toContainEqual(['client_name', 'Acme'])
  })

  it('returns the error when the query fails', async () => {
    const { client } = makeClient({ selectError: { message: 'boom' } })
    const res = await fetchPositionInterventions(client, { clientName: 'Acme', isAdmin: false })
    expect(res).toEqual({ ok: false, error: 'boom' })
  })
})

describe('recordPositionIntervention', () => {
  it('inserts a nullified row and reports success', async () => {
    const { client, calls } = makeClient()
    const res = await recordPositionIntervention(client, {
      positionId: 'p9', source: 'platform', action: 'modify', clientScope: { clientName: 'Acme', isAdmin: false },
    })
    expect(res).toEqual({ ok: true })
    expect(calls.inserted[0]).toMatchObject({
      position_id: 'p9', client_name: 'Acme', source: 'platform', action: 'modify', detail: null, created_by: null,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/positions/__tests__/interventions.test.ts`
Expected: FAIL — cannot resolve `../interventions`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/positions/interventions.ts`:

```ts
import type { SupabaseClient } from '@/lib/supabase'
import type { SupabaseClientScope } from './clientScope'

export type InterventionSource = 'platform' | 'venue'
export type InterventionAction = 'open' | 'modify' | 'close'

export type PositionIntervention = {
  positionId: string
  source: InterventionSource
  action: InterventionAction
  detail?: string | null
  ts: string
}

export type InterventionMap = Map<string, PositionIntervention>

type RawInterventionRow = {
  position_id: string | null
  client_name: string | null
  source: string | null
  action: string | null
  detail: string | null
  ts: string | null
}

const SOURCES: InterventionSource[] = ['platform', 'venue']
const ACTIONS: InterventionAction[] = ['open', 'modify', 'close']

function toSource(raw: string | null): InterventionSource | null {
  return SOURCES.includes(raw as InterventionSource) ? (raw as InterventionSource) : null
}

function toAction(raw: string | null): InterventionAction | null {
  return ACTIONS.includes(raw as InterventionAction) ? (raw as InterventionAction) : null
}

/** Keep the newest intervention per key across two maps (e.g. fetched + optimistic overlay). */
export function mergeInterventionMaps(a: InterventionMap, b: InterventionMap): InterventionMap {
  const merged: InterventionMap = new Map(a)
  for (const [id, iv] of b) {
    const existing = merged.get(id)
    if (!existing || Date.parse(iv.ts) >= Date.parse(existing.ts)) merged.set(id, iv)
  }
  return merged
}

export type FetchInterventionsResult =
  | { ok: true; interventions: InterventionMap }
  | { ok: false; error: string }

export async function fetchPositionInterventions(
  client: SupabaseClient,
  scope: SupabaseClientScope = {},
): Promise<FetchInterventionsResult> {
  const clientName = scope.clientName?.trim()
  const restrictByClient = Boolean(clientName) && !scope.isAdmin

  let query = client
    .from('position_interventions')
    .select('position_id, client_name, source, action, detail, ts')
    .order('ts', { ascending: false })

  if (restrictByClient && clientName) {
    query = query.eq('client_name', clientName)
  }

  const { data, error } = await query
  if (error) return { ok: false, error: error.message }

  const interventions: InterventionMap = new Map()
  for (const row of (data as RawInterventionRow[] | null) ?? []) {
    const positionId = typeof row.position_id === 'string' ? row.position_id : null
    const source = toSource(row.source)
    const action = toAction(row.action)
    if (!positionId || !source || !action || !row.ts) continue
    // Rows arrive newest-first; the first one seen per position is the latest.
    if (interventions.has(positionId)) continue
    interventions.set(positionId, { positionId, source, action, detail: row.detail, ts: row.ts })
  }
  return { ok: true, interventions }
}

export type RecordInterventionParams = {
  positionId: string
  source: InterventionSource
  action: InterventionAction
  detail?: string | null
  clientScope?: SupabaseClientScope
  createdBy?: string | null
}

export type RecordInterventionResult = { ok: true } | { ok: false; error: string }

export async function recordPositionIntervention(
  client: SupabaseClient,
  params: RecordInterventionParams,
): Promise<RecordInterventionResult> {
  const clientName = params.clientScope?.clientName?.trim() ?? null
  const row = {
    position_id: params.positionId,
    client_name: clientName,
    source: params.source,
    action: params.action,
    detail: params.detail ?? null,
    created_by: params.createdBy ?? null,
  }
  const { error } = await client.from('position_interventions').insert(row)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/positions/__tests__/interventions.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/positions/interventions.ts src/lib/positions/__tests__/interventions.test.ts
git commit -m "feat(portal): add position intervention fetch/record helpers"
```

---

### Task 3: Thread `positionId` onto leg summary rows

**Files:**
- Modify: `src/features/clientPortal/portfolio.ts` (the `LegSummaryRow` type + `legSummaryRows`)
- Test: `src/features/clientPortal/__tests__/portfolio.test.ts`

**Interfaces:**
- Consumes: `Position` from `@/utils`.
- Produces: `LegSummaryRow` gains `positionId: string` (the parent `Position.id`). Consumed by Task 6.

- [ ] **Step 1: Write the failing test**

Add to `src/features/clientPortal/__tests__/portfolio.test.ts` (import `legSummaryRows` alongside the existing imports — change the import line to `import { portfolioSummary, positionSummaryRows, legSummaryRows } from '../portfolio'`):

```ts
describe('legSummaryRows', () => {
  it('threads the parent positionId onto every leg row', () => {
    const p = pos({
      id: 'pos-42',
      legs: [{
        key: 'pos-42-90000-P', strike: 90000, optionType: 'P',
        openLots: [{ qty: 1, price: 0.004, sign: -1 }], realizedPnl: 0, netPremium: 0,
        qtyNet: -1, trades: [], expiry: '2025-12-14',
      }],
    })
    const rows = legSummaryRows([p])
    expect(rows).toHaveLength(1)
    expect(rows[0].positionId).toBe('pos-42')
    expect(rows[0].id).toBe('pos-42-90000-P')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/clientPortal/__tests__/portfolio.test.ts`
Expected: FAIL — `rows[0].positionId` is `undefined` (property does not exist yet; also a TS error on the type).

- [ ] **Step 3: Add the field and populate it**

In `src/features/clientPortal/portfolio.ts`, add `positionId` to the `LegSummaryRow` type (place it first):

```ts
export type LegSummaryRow = {
  id: string
  positionId: string
  option: string
  underlying: string
  expiry: string
  dte: number
  netPremium: number
  realizedPnl: number
  unrealizedPnl: number | null
  delta: number | null
  asset: string
}
```

In `legSummaryRows`, inside the `for (const leg of p.legs)` loop, add `positionId: p.id` to the pushed row (right after `id: leg.key,`):

```ts
      rows.push({
        id: leg.key,
        positionId: p.id,
        option: legInstrument(p, leg),
        underlying: p.underlying,
        expiry,
        dte: daysTo(expiry),
        netPremium: legNetPremium(leg),
        realizedPnl: leg.realizedPnl,
        unrealizedPnl,
        delta,
        asset: p.underlying,
      })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/features/clientPortal/__tests__/portfolio.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/portfolio.ts src/features/clientPortal/__tests__/portfolio.test.ts
git commit -m "feat(portal): carry parent positionId on leg summary rows"
```

---

### Task 4: `InterventionBadge` component

**Files:**
- Create: `src/features/clientPortal/components/InterventionBadge.tsx`
- Test: `src/features/clientPortal/components/__tests__/InterventionBadge.test.tsx`

**Interfaces:**
- Consumes: `PositionIntervention` from `@/lib/positions/interventions`.
- Produces:
  - `InterventionBadge({ intervention }: { intervention: PositionIntervention })` — an amber pill reading `Modified` with a `title` tooltip.
  - `formatInterventionTooltip(intervention: PositionIntervention): string`.

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/components/__tests__/InterventionBadge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InterventionBadge, formatInterventionTooltip } from '../InterventionBadge'

describe('InterventionBadge', () => {
  it('renders the Modified label and a platform tooltip', () => {
    render(<InterventionBadge intervention={{ positionId: 'p1', source: 'platform', action: 'modify', ts: '2026-07-29T12:03:00Z' }} />)
    const badge = screen.getByText('Modified')
    expect(badge).toBeInTheDocument()
    expect(badge.getAttribute('title')).toMatch(/via the platform/i)
  })

  it('discloses the venue channel in the tooltip', () => {
    const tip = formatInterventionTooltip({ positionId: 'p1', source: 'venue', action: 'close', ts: '2026-07-29T12:03:00Z' })
    expect(tip).toMatch(/directly on venue/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/clientPortal/components/__tests__/InterventionBadge.test.tsx`
Expected: FAIL — cannot resolve `../InterventionBadge`.

- [ ] **Step 3: Write the component**

Create `src/features/clientPortal/components/InterventionBadge.tsx`:

```tsx
import React from 'react'
import type { PositionIntervention } from '@/lib/positions/interventions'

const SOURCE_ACTION_LABELS: Record<string, string> = {
  'platform:open': 'You opened this via the platform',
  'platform:modify': 'You modified this via the platform',
  'platform:close': 'You closed this via the platform',
  'venue:open': 'Changed directly on venue',
  'venue:modify': 'Changed directly on venue',
  'venue:close': 'Changed directly on venue',
}

function formatTs(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(d)
}

export function formatInterventionTooltip(intervention: PositionIntervention): string {
  const label = SOURCE_ACTION_LABELS[`${intervention.source}:${intervention.action}`] ?? 'Client intervention'
  const when = formatTs(intervention.ts)
  return when ? `${label} · ${when}` : label
}

export function InterventionBadge({ intervention }: { intervention: PositionIntervention }) {
  return (
    <span
      className="ml-2 inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-semibold text-amber-600 cursor-help"
      title={formatInterventionTooltip(intervention)}
    >
      Modified
    </span>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/features/clientPortal/components/__tests__/InterventionBadge.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/components/InterventionBadge.tsx src/features/clientPortal/components/__tests__/InterventionBadge.test.tsx
git commit -m "feat(portal): add InterventionBadge component"
```

---

### Task 5: `usePositionInterventions` hook (fetch + optimistic overlay)

**Files:**
- Create: `src/features/clientPortal/usePositionInterventions.ts`
- Test: `src/features/clientPortal/__tests__/usePositionInterventions.test.ts`

**Interfaces:**
- Consumes: `hasSupabaseClient`, `getSupabaseClient` from `@/lib/supabase`; `fetchPositionInterventions`, `recordPositionIntervention`, `mergeInterventionMaps`, `InterventionAction`, `InterventionMap`, `PositionIntervention` from `@/lib/positions/interventions`.
- Produces: `usePositionInterventions(clientName: string | null): { interventions: InterventionMap; record: (positionId: string, action: InterventionAction, opts?: { persist?: boolean }) => void; reload: () => void }`. Consumed by Task 7.

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/__tests__/usePositionInterventions.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// No Supabase in tests → the fetch effect is skipped and record() only updates the overlay.
vi.mock('@/lib/supabase', () => ({
  hasSupabaseClient: () => false,
  getSupabaseClient: () => { throw new Error('should not be called in this test') },
}))

import { usePositionInterventions } from '../usePositionInterventions'

describe('usePositionInterventions', () => {
  it('optimistically records a platform intervention on the overlay', () => {
    const { result } = renderHook(() => usePositionInterventions('Acme'))
    expect(result.current.interventions.size).toBe(0)
    act(() => { result.current.record('p1', 'modify', { persist: false }) })
    const iv = result.current.interventions.get('p1')
    expect(iv?.source).toBe('platform')
    expect(iv?.action).toBe('modify')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/clientPortal/__tests__/usePositionInterventions.test.ts`
Expected: FAIL — cannot resolve `../usePositionInterventions`.

- [ ] **Step 3: Write the hook**

Create `src/features/clientPortal/usePositionInterventions.ts`:

```ts
import React from 'react'
import { getSupabaseClient, hasSupabaseClient } from '@/lib/supabase'
import {
  fetchPositionInterventions,
  recordPositionIntervention,
  mergeInterventionMaps,
  type InterventionAction,
  type InterventionMap,
  type PositionIntervention,
} from '@/lib/positions/interventions'

export function usePositionInterventions(clientName: string | null) {
  const [fetched, setFetched] = React.useState<InterventionMap>(new Map())
  const [overlay, setOverlay] = React.useState<InterventionMap>(new Map())
  const [nonce, setNonce] = React.useState(0)

  React.useEffect(() => {
    if (!hasSupabaseClient()) return
    let ignore = false
    ;(async () => {
      const res = await fetchPositionInterventions(getSupabaseClient(), { clientName, isAdmin: false })
      if (!ignore && res.ok) setFetched(res.interventions)
    })()
    return () => { ignore = true }
  }, [clientName, nonce])

  const reload = React.useCallback(() => setNonce((n) => n + 1), [])

  const record = React.useCallback((positionId: string, action: InterventionAction, opts?: { persist?: boolean }) => {
    const iv: PositionIntervention = { positionId, source: 'platform', action, ts: new Date().toISOString() }
    // Optimistic: show the badge immediately, and drive the sample-data mode where there is no write.
    setOverlay((prev) => { const next = new Map(prev); next.set(positionId, iv); return next })

    const shouldPersist = opts?.persist !== false && hasSupabaseClient() && Boolean(clientName)
    if (!shouldPersist) return
    void recordPositionIntervention(getSupabaseClient(), {
      positionId, source: 'platform', action, clientScope: { clientName, isAdmin: false },
    }).then((res) => { if (res.ok) reload() })
  }, [clientName, reload])

  const interventions = React.useMemo(() => mergeInterventionMaps(fetched, overlay), [fetched, overlay])

  return { interventions, record, reload }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/features/clientPortal/__tests__/usePositionInterventions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/usePositionInterventions.ts src/features/clientPortal/__tests__/usePositionInterventions.test.ts
git commit -m "feat(portal): add usePositionInterventions hook"
```

---

### Task 6: Render the badge and pass `positionId` in `PositionsPage`

**Files:**
- Modify: `src/features/clientPortal/pages/PositionsPage.tsx`
- Test: `src/features/clientPortal/pages/__tests__/PositionsPage.test.tsx`

**Interfaces:**
- Consumes: `InterventionMap` from `@/lib/positions/interventions`; `InterventionBadge` from `../components/InterventionBadge`; `LegSummaryRow.positionId` from Task 3.
- Produces: `PositionsPage` gains an `interventions?: InterventionMap` prop; `onModify`/`onClose` now receive a `positionId: string` (the parent position, not the leg key). Consumed by Task 7.

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/pages/__tests__/PositionsPage.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PositionsPage } from '../PositionsPage'
import { SAMPLE_POSITIONS } from '../../sampleData'
import type { InterventionMap } from '@/lib/positions/interventions'

describe('PositionsPage', () => {
  it('badges every leg of an intervened position and none of the others', () => {
    const map: InterventionMap = new Map([
      ['sample-ic-1', { positionId: 'sample-ic-1', source: 'platform', action: 'modify', ts: '2026-07-29T12:00:00Z' }],
    ])
    render(<PositionsPage positions={SAMPLE_POSITIONS} interventions={map} onModify={() => {}} onClose={() => {}} />)
    expect(screen.getAllByText('Modified')).toHaveLength(SAMPLE_POSITIONS[0].legs.length)
  })

  it('shows no badge when there are no interventions', () => {
    render(<PositionsPage positions={SAMPLE_POSITIONS} onModify={() => {}} onClose={() => {}} />)
    expect(screen.queryByText('Modified')).toBeNull()
  })

  it('passes the parent positionId to onModify', async () => {
    const onModify = vi.fn()
    render(<PositionsPage positions={SAMPLE_POSITIONS} onModify={onModify} onClose={() => {}} />)
    await userEvent.click(screen.getAllByRole('button', { name: /^modify$/i })[0])
    expect(onModify).toHaveBeenCalledWith('sample-ic-1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/clientPortal/pages/__tests__/PositionsPage.test.tsx`
Expected: FAIL — no `Modified` badge rendered; `onModify` called with a leg key instead of `sample-ic-1`.

- [ ] **Step 3: Update `PositionsPage`**

Replace the whole file `src/features/clientPortal/pages/PositionsPage.tsx` with:

```tsx
import React from 'react'
import { DataTable, type Column } from '@/components/ui'
import { Button } from '@/components/ui/Button'
import { fmtPremium, fmtNumber, type Position, type MarksMap } from '@/utils'
import type { InterventionMap } from '@/lib/positions/interventions'
import { InterventionBadge } from '../components/InterventionBadge'
import { legSummaryRows, type LegSummaryRow } from '../portfolio'

const EMPTY_INTERVENTIONS: InterventionMap = new Map()

export function PositionsPage({ positions, marks, interventions = EMPTY_INTERVENTIONS, onModify, onClose }: {
  positions: Position[]; marks?: MarksMap; interventions?: InterventionMap
  onModify: (positionId: string) => void; onClose: (positionId: string) => void
}) {
  const rows = React.useMemo(() => legSummaryRows(positions, marks), [positions, marks])

  const columns: Column<LegSummaryRow>[] = React.useMemo(() => [
    {
      key: 'option', header: 'Option',
      render: (r) => {
        const iv = interventions.get(r.positionId)
        return (
          <span className="inline-flex items-center">
            <span className="font-medium text-text-primary">{r.option}</span>
            {iv && <InterventionBadge intervention={iv} />}
          </span>
        )
      },
    },
    { key: 'underlying', header: 'Underlying', render: (r) => r.underlying },
    { key: 'expiry', header: 'Expiry', render: (r) => r.expiry },
    { key: 'dte', header: 'DTE', align: 'right', render: (r) => r.dte },
    { key: 'netPremium', header: 'Net Prem', align: 'right', render: (r) => fmtPremium(r.netPremium, r.asset) },
    { key: 'realizedPnl', header: 'Real. PnL', align: 'right', render: (r) => <span className={r.realizedPnl < 0 ? 'text-status-danger' : 'text-status-success'}>{fmtPremium(r.realizedPnl, r.asset)}</span> },
    { key: 'unrealizedPnl', header: 'uPnL', align: 'right', render: (r) => r.unrealizedPnl == null ? '—' : <span className={r.unrealizedPnl < 0 ? 'text-status-danger' : 'text-status-success'}>{fmtPremium(r.unrealizedPnl, r.asset)}</span> },
    { key: 'delta', header: 'Δ', align: 'right', headerAbbr: 'Delta', render: (r) => r.delta != null ? fmtNumber(r.delta) : '—' },
    {
      key: 'control', header: 'Control', align: 'right',
      render: (r) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => onModify(r.positionId)}>Modify</Button>
          <Button size="sm" variant="danger" onClick={() => onClose(r.positionId)}>Close</Button>
        </div>
      ),
    },
  ], [interventions, onModify, onClose])

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="type-title-l font-bold text-text-primary">Positions</h1>
        <p className="mt-1 type-subhead text-text-secondary">Monitor trades &amp; risk. Modify or close any position yourself — your action overrides the software.</p>
      </div>
      <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-5">
        <DataTable columns={columns} data={rows} rowKey={(r) => r.id} emptyMessage="No open positions." />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/features/clientPortal/pages/__tests__/PositionsPage.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/pages/PositionsPage.tsx src/features/clientPortal/pages/__tests__/PositionsPage.test.tsx
git commit -m "feat(portal): render intervention badge on position rows"
```

---

### Task 7: Wire the hook into `ClientPortalShell`

**Files:**
- Modify: `src/features/clientPortal/ClientPortalShell.tsx`
- Test: `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`

**Interfaces:**
- Consumes: `usePositionInterventions` from `./usePositionInterventions` (Task 5); the updated `PositionsPage` props (Task 6).
- Produces: end-to-end behavior — clicking Modify/Close records an intervention (persisted only when not in sample mode) and badges that position.

- [ ] **Step 1: Write the failing test**

Add this test to `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx` inside the existing `describe('ClientPortalShell', ...)` block (the file already mocks `useClientPositions` to return no positions, so the shell renders the labeled sample positions; `hasSupabaseClient()` is false in tests, so no network and no persistence):

```tsx
  it('flags a position as Modified after the client clicks Modify', async () => {
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/positions" onSignOut={() => {}} />)
    expect(screen.queryByText('Modified')).toBeNull()
    await userEvent.click(screen.getAllByRole('button', { name: /^modify$/i })[0])
    expect(screen.getAllByText('Modified').length).toBeGreaterThan(0)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`
Expected: FAIL — no `Modified` badge appears after the click (the shell does not yet use the hook or pass `interventions`).

- [ ] **Step 3: Wire the hook in**

In `src/features/clientPortal/ClientPortalShell.tsx`:

First, add the import near the other feature imports (e.g. right after the `useClientPositions` import on line 9):

```tsx
import { usePositionInterventions } from './usePositionInterventions'
```

Then, inside the component, right after the `useClientPositions` line (`const { positions, loading, error, reload } = useClientPositions(clientName)`), add:

```tsx
  const { interventions, record } = usePositionInterventions(clientName)
```

Finally, replace the existing `PositionsPage` usage:

```tsx
                {page === 'positions' ? (
                  <PositionsPage positions={shownPositions} marks={shownMarks} onModify={(id) => appendAudit('POSITION', `modify requested · ${id}`)} onClose={(id) => appendAudit('POSITION', `manual close · ${id} · client override`)} />
                ) : (
```

with:

```tsx
                {page === 'positions' ? (
                  <PositionsPage
                    positions={shownPositions}
                    marks={shownMarks}
                    interventions={interventions}
                    onModify={(positionId) => {
                      record(positionId, 'modify', { persist: !usingSample })
                      appendAudit('POSITION', `modify requested · ${positionId}`)
                    }}
                    onClose={(positionId) => {
                      record(positionId, 'close', { persist: !usingSample })
                      appendAudit('POSITION', `manual close · ${positionId} · client override`)
                    }}
                  />
                ) : (
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`
Expected: PASS (all existing tests plus the new one).

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/ClientPortalShell.tsx src/features/clientPortal/__tests__/ClientPortalShell.test.tsx
git commit -m "feat(portal): record + badge client interventions from the shell"
```

---

### Task 8: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm test`
Expected: PASS, including the new `interventions`, `portfolio`, `InterventionBadge`, `usePositionInterventions`, `PositionsPage`, and `ClientPortalShell` tests.

- [ ] **Step 2: Type-check and build**

Run: `pnpm build`
Expected: no TypeScript errors (the new `positionId` field, `interventions` prop, and changed `onModify`/`onClose` signatures all type-check).

- [ ] **Step 3: Visual check in the browser**

Start the dev server (port 5174 per project convention) and open the client portal Positions page. Confirm:
- Clicking **Modify** or **Close** on a row makes an amber **Modified** badge appear next to the option name on every leg of that position.
- Hovering the badge shows the tooltip disclosing the source and time (e.g. "You modified this via the platform · …").

- [ ] **Step 4: Final commit (if any incidental fixes were needed)**

```bash
git add -A
git commit -m "chore(portal): verification fixups for intervention indicator"
```

---

## Self-Review Notes

- **Spec coverage:** data model → Task 1 + 2; platform channel wired live → Tasks 5 + 7; venue channel as a backend-writable source → Task 1 (`source='venue'` allowed) + Task 2 (fetch/render handles both, `InterventionBadge` labels venue rows) ; position-level granularity with per-leg display → Task 3 + 6; badge "Modified" + tooltip → Task 4; optimistic/sample-mode behavior → Task 5 + 7; error handling (non-blocking fetch, optimistic overlay) → Task 5; tests for helper/portfolio/page → Tasks 2, 3, 6.
- **Out of scope confirmed absent:** no drift-detection logic, no admin-dashboard badge.
- **Type consistency:** `InterventionMap`, `PositionIntervention`, `InterventionAction`, `mergeInterventionMaps`, `fetchPositionInterventions`, `recordPositionIntervention` names match across Tasks 2, 5, 6, 7; `record(positionId, action, { persist })` signature matches between Task 5 (definition) and Task 7 (call); `LegSummaryRow.positionId` matches between Task 3 (definition) and Task 6 (use).
