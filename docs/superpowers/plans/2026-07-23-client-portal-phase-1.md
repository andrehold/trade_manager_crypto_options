# Client Portal — Phase 1 Implementation Plan (Shell, Routing, Login Doors, Dashboard, Positions)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a role-gated client portal shell — a branded client login door, a grouped dashboard-first sidebar, persistent activation/kill-switch + responsibility chrome, and working Dashboard + Positions pages fed by the signed-in client's real positions — without changing the existing admin `DashboardApp`.

**Architecture:** A new `RootRouter` (rendered by `main.tsx`) chooses between the existing admin app and the new client portal based on `resolveClientAccess(user)` and the URL hash. The client portal lives entirely in `src/features/clientPortal/`. Pure logic (route/door parsing, activation gating, portfolio aggregation) is extracted into testable modules; presentational components reuse `src/components/ui` primitives and the existing design-token classes.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind v4, Supabase auth/data, Vitest + Testing Library (added in Task 0), `lucide-react` icons.

## Global Constraints

- **The software never advises, recommends, or renders a verdict.** No "recommended"/"suggested" markers, no software-issued appropriateness verdict. Copy records the client's decisions only. (Verbatim from spec §2.)
- **Design tokens only** — use existing semantic classes as in `ClientDashboardPage.tsx`: `bg-bg-surface-{0..4}`, `text-text-{primary,secondary,tertiary}`, `border-border-{default,subtle}`, `type-{title-l,subhead,caption}`, `text-accent-400`, `text-status-{success,danger}`, `bg-accent-500`. **No raw zinc/slate/hex.**
- **Package manager: pnpm.**
- **Path alias:** `@/` → `src/` (both `vite.config.ts` and `tsconfig.json`).
- **Do not modify** `src/DashboardApp.tsx` behavior except where a task explicitly refactors shared helpers out of `ClientDashboardPage.tsx` (Task 3) with no behavior change.
- **Admin path untouched:** the existing admin experience (`App.tsx` → `DashboardApp`) must render exactly as before for admin users.
- Commit after each task. Branch: `client-portal` (create before Task 0 if on `main`).

---

## File Structure

```
src/features/clientPortal/
  routing.ts                 # Task 1  — door + portal-page hash parsing (pure)
  setupStatus.ts             # Task 2  — SetupStatus, canActivate, outstandingItems (pure)
  portfolio.ts               # Task 3  — portfolioSummary, positionSummaryRows (pure, extracted)
  ResponsibilityStrip.tsx    # Task 4
  ActivationControl.tsx      # Task 5
  ClientSidebar.tsx          # Task 6
  LoginDoor.tsx              # Task 7
  DevDoorSwitch.tsx          # Task 7
  useClientPositions.ts      # Task 10
  ClientPortalShell.tsx      # Task 10
  pages/
    DashboardPage.tsx        # Task 8
    PositionsPage.tsx        # Task 9
  __tests__/                 # co-located vitest specs
src/RootRouter.tsx           # Task 11 — top-level role/route chooser
src/main.tsx                 # Task 11 — render <RootRouter/> instead of <App/>
src/test/setup.ts            # Task 0
vite.config.ts               # Task 0 — add vitest `test` block
package.json                 # Task 0 — add test scripts + devDeps
src/features/clientDashboard/ClientDashboardPage.tsx  # Task 3 — use extracted helpers
```

---

### Task 0: Test infrastructure (Vitest + Testing Library)

**Files:**
- Modify: `package.json` (scripts + devDependencies)
- Modify: `vite.config.ts` (add `test` block)
- Create: `src/test/setup.ts`
- Create: `src/features/clientPortal/__tests__/smoke.test.ts`

**Interfaces:**
- Produces: `pnpm test` runs Vitest once; `pnpm test:watch` watches. Test env = jsdom, globals enabled, `@testing-library/jest-dom` matchers available.

- [ ] **Step 1: Install dev dependencies**

Run:
```bash
pnpm add -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

- [ ] **Step 2: Add test scripts to `package.json`**

In the `"scripts"` block add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Add the Vitest `test` block to `vite.config.ts`**

Change the top import from `import { defineConfig } from 'vite'` to:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
```
Then add a `test` property to the config object (sibling of `plugins`, `resolve`, `build`):
```ts
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
```

- [ ] **Step 4: Create the test setup file**

Create `src/test/setup.ts`:
```ts
import '@testing-library/jest-dom'
```

- [ ] **Step 5: Add a smoke test**

Create `src/features/clientPortal/__tests__/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('test harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 6: Run the tests**

Run: `pnpm test`
Expected: PASS — 1 test file, 1 test passing.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml vite.config.ts src/test/setup.ts src/features/clientPortal/__tests__/smoke.test.ts
git commit -m "chore: add vitest + testing-library test harness"
```

---

### Task 1: Portal routing (pure)

**Files:**
- Create: `src/features/clientPortal/routing.ts`
- Test: `src/features/clientPortal/__tests__/routing.test.ts`

**Interfaces:**
- Produces:
  - `type PortalPage = 'dashboard' | 'positions' | 'appropriateness' | 'strategy' | 'risk' | 'keys' | 'updates' | 'audit'`
  - `type Door = 'client' | 'admin'`
  - `parseDoor(hash: string): Door`
  - `isPortalRoute(hash: string): boolean`
  - `parsePortalPage(hash: string): PortalPage`
  - `portalHash(page: PortalPage): string`

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/__tests__/routing.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseDoor, isPortalRoute, parsePortalPage, portalHash } from '../routing'

describe('parseDoor', () => {
  it('detects the admin door', () => {
    expect(parseDoor('#/admin')).toBe('admin')
    expect(parseDoor('#/admin/login')).toBe('admin')
  })
  it('defaults to the client door', () => {
    expect(parseDoor('#/login')).toBe('client')
    expect(parseDoor('')).toBe('client')
    expect(parseDoor('#/portal/audit')).toBe('client')
  })
})

describe('isPortalRoute', () => {
  it('is true only for #/portal/*', () => {
    expect(isPortalRoute('#/portal')).toBe(true)
    expect(isPortalRoute('#/portal/positions')).toBe(true)
    expect(isPortalRoute('#/login')).toBe(false)
    expect(isPortalRoute('#/admin')).toBe(false)
  })
})

describe('parsePortalPage', () => {
  it('reads the page segment', () => {
    expect(parsePortalPage('#/portal/positions')).toBe('positions')
    expect(parsePortalPage('#/portal/audit')).toBe('audit')
  })
  it('defaults unknown or missing to dashboard', () => {
    expect(parsePortalPage('#/portal')).toBe('dashboard')
    expect(parsePortalPage('#/portal/nope')).toBe('dashboard')
  })
})

describe('portalHash', () => {
  it('builds a portal hash', () => {
    expect(portalHash('risk')).toBe('#/portal/risk')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test routing`
Expected: FAIL — cannot find module `../routing`.

- [ ] **Step 3: Write the implementation**

Create `src/features/clientPortal/routing.ts`:
```ts
export type PortalPage =
  | 'dashboard' | 'positions' | 'appropriateness' | 'strategy'
  | 'risk' | 'keys' | 'updates' | 'audit'

export type Door = 'client' | 'admin'

const PORTAL_PAGES: PortalPage[] = [
  'dashboard', 'positions', 'appropriateness', 'strategy',
  'risk', 'keys', 'updates', 'audit',
]

function segments(hash: string): string[] {
  return (hash || '').replace(/^#\/?/, '').split('/').filter(Boolean)
}

export function parseDoor(hash: string): Door {
  return segments(hash)[0] === 'admin' ? 'admin' : 'client'
}

export function isPortalRoute(hash: string): boolean {
  return segments(hash)[0] === 'portal'
}

export function parsePortalPage(hash: string): PortalPage {
  const page = segments(hash)[1] as PortalPage | undefined
  return page && PORTAL_PAGES.includes(page) ? page : 'dashboard'
}

export function portalHash(page: PortalPage): string {
  return `#/portal/${page}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test routing`
Expected: PASS — all routing tests green.

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/routing.ts src/features/clientPortal/__tests__/routing.test.ts
git commit -m "feat(client-portal): add door + portal-page hash routing"
```

---

### Task 2: Setup status & activation gating (pure)

**Files:**
- Create: `src/features/clientPortal/setupStatus.ts`
- Test: `src/features/clientPortal/__tests__/setupStatus.test.ts`

**Interfaces:**
- Produces:
  - `type SetupStatus = { appropriateness: boolean; strategy: boolean; riskLimits: boolean; tradingKey: boolean }`
  - `canActivate(s: SetupStatus): boolean` — true only when all four are true (spec §9).
  - `outstandingItems(s: SetupStatus): string[]` — human labels for the incomplete preconditions.
  - `EMPTY_SETUP_STATUS: SetupStatus` — all false (Phase-1 default until later phases wire real data).

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/__tests__/setupStatus.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { canActivate, outstandingItems, EMPTY_SETUP_STATUS, type SetupStatus } from '../setupStatus'

const complete: SetupStatus = { appropriateness: true, strategy: true, riskLimits: true, tradingKey: true }

describe('canActivate', () => {
  it('is true only when all four preconditions are met', () => {
    expect(canActivate(complete)).toBe(true)
  })
  it('is false if any precondition is missing', () => {
    expect(canActivate({ ...complete, appropriateness: false })).toBe(false)
    expect(canActivate({ ...complete, strategy: false })).toBe(false)
    expect(canActivate({ ...complete, riskLimits: false })).toBe(false)
    expect(canActivate({ ...complete, tradingKey: false })).toBe(false)
    expect(canActivate(EMPTY_SETUP_STATUS)).toBe(false)
  })
})

describe('outstandingItems', () => {
  it('lists only the incomplete items', () => {
    expect(outstandingItems(complete)).toEqual([])
    expect(outstandingItems({ ...complete, tradingKey: false })).toEqual(['Active trading API key'])
    expect(outstandingItems(EMPTY_SETUP_STATUS)).toHaveLength(4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test setupStatus`
Expected: FAIL — cannot find module `../setupStatus`.

- [ ] **Step 3: Write the implementation**

Create `src/features/clientPortal/setupStatus.ts`:
```ts
export type SetupStatus = {
  appropriateness: boolean
  strategy: boolean
  riskLimits: boolean
  tradingKey: boolean
}

export const EMPTY_SETUP_STATUS: SetupStatus = {
  appropriateness: false,
  strategy: false,
  riskLimits: false,
  tradingKey: false,
}

export function canActivate(s: SetupStatus): boolean {
  return s.appropriateness && s.strategy && s.riskLimits && s.tradingKey
}

export function outstandingItems(s: SetupStatus): string[] {
  const out: string[] = []
  if (!s.appropriateness) out.push('Appropriateness self-assessment')
  if (!s.strategy) out.push('Strategy selection')
  if (!s.riskLimits) out.push('Risk limits')
  if (!s.tradingKey) out.push('Active trading API key')
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test setupStatus`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/setupStatus.ts src/features/clientPortal/__tests__/setupStatus.test.ts
git commit -m "feat(client-portal): add setup status + four-precondition activation gate"
```

---

### Task 3: Portfolio aggregation helpers (extract from ClientDashboardPage)

**Files:**
- Create: `src/features/clientPortal/portfolio.ts`
- Modify: `src/features/clientDashboard/ClientDashboardPage.tsx` (use the extracted helpers — no behavior change)
- Test: `src/features/clientPortal/__tests__/portfolio.test.ts`

**Interfaces:**
- Consumes: `Position`, `MarksMap`, `positionUnrealizedPnL`, `positionGreeks` from `@/utils`.
- Produces:
  - `type PortfolioSummary = { totalEquity: number; totalPnl: number | null; totalRealized: number; pnlPct: number | null; delta: number; gamma: number; theta: number; vega: number; hasAnyMarks: boolean; programName: string; exchange: string; asset: string }`
  - `type PositionSummaryRow = { id: string; strategy: string; underlying: string; expiry: string; dte: number; status: Position['status']; netPremium: number; realizedPnl: number; unrealizedPnl: number | null; delta: number | null; gamma: number | null; theta: number | null; vega: number | null; asset: string }`
  - `portfolioSummary(positions: Position[], marks?: MarksMap): PortfolioSummary`
  - `positionSummaryRows(positions: Position[], marks?: MarksMap): PositionSummaryRow[]`

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/__tests__/portfolio.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { portfolioSummary, positionSummaryRows } from '../portfolio'
import type { Position } from '@/utils'

function pos(partial: Partial<Position>): Position {
  return {
    id: 'p1', underlying: 'BTC', programName: 'Weekend Vol', exchange: 'deribit',
    expiryISO: '2025-12-14', dte: 1, status: 'open', netPremium: 0.004,
    realizedPnl: 0.001, strategy: 'Iron Condor', structureId: 's1', legs: [],
    ...partial,
  } as unknown as Position
}

describe('portfolioSummary', () => {
  it('sums equity/realized and reports no PnL when marks are absent', () => {
    const s = portfolioSummary([pos({ netPremium: 0.004, realizedPnl: 0.001 }), pos({ id: 'p2', netPremium: 0.006, realizedPnl: 0.002 })])
    expect(s.totalEquity).toBeCloseTo(0.01)
    expect(s.totalRealized).toBeCloseTo(0.003)
    expect(s.hasAnyMarks).toBe(false)
    expect(s.totalPnl).toBeNull()
    expect(s.pnlPct).toBeNull()
    expect(s.asset).toBe('BTC')
    expect(s.programName).toBe('Weekend Vol')
  })
})

describe('positionSummaryRows', () => {
  it('maps positions to rows with null greeks when marks are absent', () => {
    const rows = positionSummaryRows([pos({})])
    expect(rows).toHaveLength(1)
    expect(rows[0].strategy).toBe('Iron Condor')
    expect(rows[0].unrealizedPnl).toBeNull()
    expect(rows[0].delta).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test portfolio`
Expected: FAIL — cannot find module `../portfolio`.

- [ ] **Step 3: Create the helpers by moving the logic out of `ClientDashboardPage`**

Create `src/features/clientPortal/portfolio.ts` (this is the exact aggregation currently inlined in `ClientDashboardPage.tsx` lines 41–132, lifted verbatim into pure functions):
```ts
import {
  positionUnrealizedPnL, positionGreeks,
  type Position, type MarksMap,
} from '@/utils'

export type PortfolioSummary = {
  totalEquity: number
  totalPnl: number | null
  totalRealized: number
  pnlPct: number | null
  delta: number
  gamma: number
  theta: number
  vega: number
  hasAnyMarks: boolean
  programName: string
  exchange: string
  asset: string
}

export type PositionSummaryRow = {
  id: string
  strategy: string
  underlying: string
  expiry: string
  dte: number
  status: Position['status']
  netPremium: number
  realizedPnl: number
  unrealizedPnl: number | null
  delta: number | null
  gamma: number | null
  theta: number | null
  vega: number | null
  asset: string
}

export function portfolioSummary(positions: Position[], marks?: MarksMap): PortfolioSummary {
  let totalEquity = 0, totalRealized = 0, totalUnrealized = 0
  let hasAnyMarks = false
  let delta = 0, gamma = 0, theta = 0, vega = 0

  for (const p of positions) {
    totalEquity += p.netPremium
    totalRealized += p.realizedPnl
    if (marks) {
      const uPnl = positionUnrealizedPnL(p, marks)
      if (uPnl != null) { totalUnrealized += uPnl; hasAnyMarks = true }
      const g = positionGreeks(p, marks)
      if (g) { delta += g.delta; gamma += g.gamma; theta += g.theta; vega += g.vega }
    }
  }

  const totalPnl = hasAnyMarks ? totalRealized + totalUnrealized : null
  const pnlPct = totalPnl != null && Math.abs(totalEquity) > 0
    ? (totalPnl / Math.abs(totalEquity)) * 100
    : null

  const programName = positions.find((p) => p.programName)?.programName ?? '—'
  const exchange = positions.find((p) => p.exchange)?.exchange ?? '—'
  const asset = positions[0]?.underlying ?? 'BTC'

  return { totalEquity, totalPnl, totalRealized, pnlPct, programName, exchange, asset, delta, gamma, theta, vega, hasAnyMarks }
}

export function positionSummaryRows(positions: Position[], marks?: MarksMap): PositionSummaryRow[] {
  return positions.map((p) => {
    const uPnl = marks ? positionUnrealizedPnL(p, marks) : null
    const g = marks ? positionGreeks(p, marks) : null
    return {
      id: p.id,
      strategy: p.strategy ?? p.structureId ?? p.underlying,
      underlying: p.underlying,
      expiry: p.expiryISO,
      dte: p.dte,
      status: p.status,
      netPremium: p.netPremium,
      realizedPnl: p.realizedPnl,
      unrealizedPnl: uPnl,
      delta: g?.delta ?? null,
      gamma: g?.gamma ?? null,
      theta: g?.theta ?? null,
      vega: g?.vega ?? null,
      asset: p.underlying,
    }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test portfolio`
Expected: PASS.

- [ ] **Step 5: Refactor `ClientDashboardPage.tsx` to use the helpers (no behavior change)**

In `src/features/clientDashboard/ClientDashboardPage.tsx`:
1. Add import near the other imports:
```ts
import { portfolioSummary, positionSummaryRows, type PositionSummaryRow } from '../clientPortal/portfolio'
```
2. Delete the local `type PositionSummaryRow = { ... }` block (lines ~41–56) — it now comes from the import.
3. Replace the `const portfolio = React.useMemo(() => { ... }, [positions, marks])` block (lines ~71–108) with:
```ts
  const portfolio = React.useMemo(() => portfolioSummary(positions, marks), [positions, marks])
```
4. Replace the `const positionRows = React.useMemo<PositionSummaryRow[]>(() => { ... }, [positions, marks])` block (lines ~111–132) with:
```ts
  const positionRows = React.useMemo(() => positionSummaryRows(positions, marks), [positions, marks])
```

- [ ] **Step 6: Typecheck and run the full test suite**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: no type errors; all tests pass.

- [ ] **Step 7: Verify the admin client dashboard still renders**

Start the dev server via the preview tool (config name from `.claude/launch.json`), sign in, open `#/client-dashboard`, confirm Portfolio Details KPIs and Positions table render unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/features/clientPortal/portfolio.ts src/features/clientPortal/__tests__/portfolio.test.ts src/features/clientDashboard/ClientDashboardPage.tsx
git commit -m "refactor(client): extract portfolio aggregation into pure helpers"
```

---

### Task 4: ResponsibilityStrip

**Files:**
- Create: `src/features/clientPortal/ResponsibilityStrip.tsx`
- Test: `src/features/clientPortal/__tests__/ResponsibilityStrip.test.tsx`

**Interfaces:**
- Produces: `ResponsibilityStrip(props: { onOpenAudit: () => void }): JSX.Element` — non-dismissible band; the link calls `onOpenAudit`.

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/__tests__/ResponsibilityStrip.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResponsibilityStrip } from '../ResponsibilityStrip'

describe('ResponsibilityStrip', () => {
  it('states responsibility and no-advice, and links to the audit log', async () => {
    const onOpenAudit = vi.fn()
    render(<ResponsibilityStrip onOpenAudit={onOpenAudit} />)
    expect(screen.getByText(/regulatory compliance/i)).toBeInTheDocument()
    expect(screen.getByText(/no advice or recommendation/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /audit log/i }))
    expect(onOpenAudit).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test ResponsibilityStrip`
Expected: FAIL — cannot find module `../ResponsibilityStrip`.

- [ ] **Step 3: Write the implementation**

Create `src/features/clientPortal/ResponsibilityStrip.tsx`:
```tsx
import { Shield } from 'lucide-react'

export function ResponsibilityStrip({ onOpenAudit }: { onOpenAudit: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-6 py-2 bg-accent-500/15 border-b border-accent-500/40 text-accent-400" role="note">
      <Shield className="h-4 w-4 shrink-0" />
      <span className="type-caption text-text-secondary flex-1 min-w-0">
        You retain full responsibility for <strong className="text-text-primary">regulatory compliance</strong> and all{' '}
        <strong className="text-text-primary">investment decisions</strong>. This software executes only the parameters you set — it provides no advice or recommendation.
      </span>
      <button type="button" onClick={onOpenAudit} className="type-caption font-semibold text-accent-400 hover:underline whitespace-nowrap">
        View attestations &amp; audit log →
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test ResponsibilityStrip`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/ResponsibilityStrip.tsx src/features/clientPortal/__tests__/ResponsibilityStrip.test.tsx
git commit -m "feat(client-portal): add non-dismissible responsibility strip"
```

---

### Task 5: ActivationControl (master switch + kill-switch, gated)

**Files:**
- Create: `src/features/clientPortal/ActivationControl.tsx`
- Test: `src/features/clientPortal/__tests__/ActivationControl.test.tsx`

**Interfaces:**
- Consumes: `SetupStatus`, `canActivate`, `outstandingItems` from `./setupStatus`.
- Produces: `ActivationControl(props: { active: boolean; setupStatus: SetupStatus; onToggle: () => void }): JSX.Element`
  - When `active`: shows "Active" + a **Deactivate** (kill) button (always enabled).
  - When inactive: shows "Inactive" + an **Activate** button, disabled unless `canActivate(setupStatus)`; disabled state exposes the outstanding items via `title`.

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/__tests__/ActivationControl.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActivationControl } from '../ActivationControl'
import { EMPTY_SETUP_STATUS } from '../setupStatus'

const complete = { appropriateness: true, strategy: true, riskLimits: true, tradingKey: true }

describe('ActivationControl', () => {
  it('disables Activate until all preconditions are met', () => {
    render(<ActivationControl active={false} setupStatus={EMPTY_SETUP_STATUS} onToggle={() => {}} />)
    expect(screen.getByRole('button', { name: /activate/i })).toBeDisabled()
  })

  it('enables Activate when setup is complete and toggles', async () => {
    const onToggle = vi.fn()
    render(<ActivationControl active={false} setupStatus={complete} onToggle={onToggle} />)
    const btn = screen.getByRole('button', { name: /activate/i })
    expect(btn).toBeEnabled()
    await userEvent.click(btn)
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('shows Deactivate (kill switch) when active', () => {
    render(<ActivationControl active setupStatus={complete} onToggle={() => {}} />)
    expect(screen.getByRole('button', { name: /deactivate/i })).toBeEnabled()
    expect(screen.getByText(/^active$/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test ActivationControl`
Expected: FAIL — cannot find module `../ActivationControl`.

- [ ] **Step 3: Write the implementation**

Create `src/features/clientPortal/ActivationControl.tsx`:
```tsx
import { Play, Square } from 'lucide-react'
import { canActivate, outstandingItems, type SetupStatus } from './setupStatus'

export function ActivationControl({
  active, setupStatus, onToggle,
}: { active: boolean; setupStatus: SetupStatus; onToggle: () => void }) {
  const gateOpen = canActivate(setupStatus)
  const outstanding = outstandingItems(setupStatus)

  return (
    <div className={`flex items-center gap-3 rounded-xl border px-3 py-1.5 ${active ? 'border-status-success/30 bg-status-success/10' : 'border-border-default bg-bg-surface-2'}`}>
      <span className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${active ? 'bg-status-success' : 'bg-text-tertiary'}`} />
        <span className="leading-tight">
          <span className="block type-caption uppercase tracking-wide text-text-tertiary">Software</span>
          <span className={`type-subhead font-semibold ${active ? 'text-status-success' : 'text-text-primary'}`}>
            {active ? 'Active' : 'Inactive'}
          </span>
        </span>
      </span>
      {active ? (
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center gap-1.5 rounded-lg border border-status-danger/30 bg-status-danger/15 px-3 py-1.5 type-caption font-semibold text-status-danger hover:bg-status-danger/25"
        >
          <Square className="h-3.5 w-3.5" /> Deactivate
        </button>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          disabled={!gateOpen}
          title={gateOpen ? undefined : `Complete first: ${outstanding.join(', ')}`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-status-success px-3 py-1.5 type-caption font-semibold text-white disabled:opacity-45 disabled:cursor-not-allowed"
        >
          <Play className="h-3.5 w-3.5" /> Activate
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test ActivationControl`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/ActivationControl.tsx src/features/clientPortal/__tests__/ActivationControl.test.tsx
git commit -m "feat(client-portal): add gated activation + kill-switch control"
```

---

### Task 6: ClientSidebar

**Files:**
- Create: `src/features/clientPortal/ClientSidebar.tsx`
- Test: `src/features/clientPortal/__tests__/ClientSidebar.test.tsx`

**Interfaces:**
- Consumes: `PortalPage` from `./routing`; `SetupStatus` from `./setupStatus`.
- Produces: `ClientSidebar(props: { clientName: string; program: string; active: PortalPage; setupStatus: SetupStatus; onNavigate: (page: PortalPage) => void; onSignOut: () => void }): JSX.Element`
  - Groups: top (Dashboard, Positions); "Setup & controls" (Appropriateness, Strategy module, Risk & deployment, Exchange keys, Updates); "Record" (Audit log).
  - Setup items show a green check when the matching `setupStatus` flag is true, else an amber dot.

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/__tests__/ClientSidebar.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientSidebar } from '../ClientSidebar'
import { EMPTY_SETUP_STATUS } from '../setupStatus'

describe('ClientSidebar', () => {
  it('renders the grouped nav and routes on click', async () => {
    const onNavigate = vi.fn()
    render(
      <ClientSidebar
        clientName="TwoPrime" program="Obsidian Core" active="dashboard"
        setupStatus={EMPTY_SETUP_STATUS} onNavigate={onNavigate} onSignOut={() => {}}
      />,
    )
    expect(screen.getByText('TwoPrime')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /risk & deployment/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /positions/i }))
    expect(onNavigate).toHaveBeenCalledWith('positions')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test ClientSidebar`
Expected: FAIL — cannot find module `../ClientSidebar`.

- [ ] **Step 3: Write the implementation**

Create `src/features/clientPortal/ClientSidebar.tsx`:
```tsx
import { LayoutDashboard, TrendingUp, ClipboardCheck, BookOpen, ShieldCheck, KeyRound, ArrowDownToLine, FileText, LogOut, Check } from 'lucide-react'
import type { PortalPage } from './routing'
import type { SetupStatus } from './setupStatus'

type Item = { page: PortalPage; label: string; icon: React.ComponentType<{ className?: string }>; statusKey?: keyof SetupStatus }

const TOP: Item[] = [
  { page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { page: 'positions', label: 'Positions', icon: TrendingUp },
]
const SETUP: Item[] = [
  { page: 'appropriateness', label: 'Appropriateness', icon: ClipboardCheck, statusKey: 'appropriateness' },
  { page: 'strategy', label: 'Strategy module', icon: BookOpen, statusKey: 'strategy' },
  { page: 'risk', label: 'Risk & deployment', icon: ShieldCheck, statusKey: 'riskLimits' },
  { page: 'keys', label: 'Exchange keys', icon: KeyRound, statusKey: 'tradingKey' },
  { page: 'updates', label: 'Updates', icon: ArrowDownToLine },
]
const RECORD: Item[] = [{ page: 'audit', label: 'Audit log', icon: FileText }]

function NavButton({ item, active, done, onNavigate }: { item: Item; active: boolean; done?: boolean; onNavigate: (p: PortalPage) => void }) {
  const Icon = item.icon
  return (
    <button
      type="button"
      onClick={() => onNavigate(item.page)}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 type-subhead text-left transition-colors ${active ? 'bg-accent-500/15 text-accent-400 border border-accent-500/40' : 'text-text-secondary hover:bg-bg-surface-2 hover:text-text-primary border border-transparent'}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1">{item.label}</span>
      {item.statusKey && (done
        ? <Check className="h-3.5 w-3.5 text-status-success" />
        : <span className="h-1.5 w-1.5 rounded-full bg-status-warning" />)}
    </button>
  )
}

export function ClientSidebar({
  clientName, program, active, setupStatus, onNavigate, onSignOut,
}: { clientName: string; program: string; active: PortalPage; setupStatus: SetupStatus; onNavigate: (page: PortalPage) => void; onSignOut: () => void }) {
  return (
    <aside className="flex h-screen w-[244px] shrink-0 flex-col border-r border-border-default bg-bg-surface-0/70">
      <div className="flex items-center gap-3 border-b border-border-default px-4 py-4">
        <div className="grid h-9 w-9 place-items-center rounded-xl border border-accent-500/40 bg-bg-surface-2 type-subhead font-bold text-accent-400">
          {clientName.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <div className="type-subhead font-semibold text-text-primary">{clientName}</div>
          <div className="type-caption text-text-tertiary">{program}</div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-1">
          {TOP.map((it) => <NavButton key={it.page} item={it} active={active === it.page} onNavigate={onNavigate} />)}
        </div>
        <div className="px-2 pb-1.5 pt-4 type-caption uppercase tracking-wider text-text-tertiary">Setup &amp; controls</div>
        <div className="flex flex-col gap-1">
          {SETUP.map((it) => <NavButton key={it.page} item={it} active={active === it.page} done={it.statusKey ? setupStatus[it.statusKey] : undefined} onNavigate={onNavigate} />)}
        </div>
        <div className="px-2 pb-1.5 pt-4 type-caption uppercase tracking-wider text-text-tertiary">Record</div>
        <div className="flex flex-col gap-1">
          {RECORD.map((it) => <NavButton key={it.page} item={it} active={active === it.page} onNavigate={onNavigate} />)}
        </div>
      </nav>
      <div className="border-t border-border-default p-3">
        <button type="button" onClick={onSignOut} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 type-subhead text-text-secondary hover:bg-bg-surface-2 hover:text-status-danger">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </aside>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test ClientSidebar`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/ClientSidebar.tsx src/features/clientPortal/__tests__/ClientSidebar.test.tsx
git commit -m "feat(client-portal): add grouped dashboard-first sidebar"
```

---

### Task 7: LoginDoor + DevDoorSwitch

**Files:**
- Create: `src/features/clientPortal/LoginDoor.tsx`
- Create: `src/features/clientPortal/DevDoorSwitch.tsx`
- Test: `src/features/clientPortal/__tests__/LoginDoor.test.tsx`

**Interfaces:**
- Consumes: `Door` from `./routing`; existing `SupabaseLogin` from `@/features/auth/SupabaseLogin`.
- Produces:
  - `LoginDoor(props: { role: Door }): JSX.Element` — branded container (client = accent, admin = amber) with a route-hint line, wrapping `<SupabaseLogin />` (auth logic reused, not duplicated), and a "records but never advises" note for the client role.
  - `DevDoorSwitch(props: { role: Door }): JSX.Element | null` — returns `null` unless `import.meta.env.DEV`; a fixed bottom-left control that sets `window.location.hash` to `#/login` or `#/admin`.

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/__tests__/LoginDoor.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/features/auth/SupabaseLogin', () => ({ SupabaseLogin: () => <div data-testid="supabase-login" /> }))

import { LoginDoor } from '../LoginDoor'

describe('LoginDoor', () => {
  it('renders the client door with the sign-in form and no-advice note', () => {
    render(<LoginDoor role="client" />)
    expect(screen.getByText(/client sign-in/i)).toBeInTheDocument()
    expect(screen.getByTestId('supabase-login')).toBeInTheDocument()
    expect(screen.getByText(/no advice/i)).toBeInTheDocument()
  })
  it('renders the admin door label', () => {
    render(<LoginDoor role="admin" />)
    expect(screen.getByText(/administrator sign-in/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test LoginDoor`
Expected: FAIL — cannot find module `../LoginDoor`.

- [ ] **Step 3: Write `LoginDoor.tsx`**

Create `src/features/clientPortal/LoginDoor.tsx`:
```tsx
import { Zap, Lock } from 'lucide-react'
import { SupabaseLogin } from '@/features/auth/SupabaseLogin'
import type { Door } from './routing'

export function LoginDoor({ role }: { role: Door }) {
  const admin = role === 'admin'
  return (
    <div className={`grid min-h-screen place-items-center px-5 py-8 ${admin ? 'bg-bg-surface-0' : 'bg-bg-surface-0'}`}>
      <div className="w-full max-w-[400px] rounded-2xl border border-border-default bg-bg-surface-1 p-7 shadow-xl">
        <div className="mb-5 flex items-center gap-3">
          <span className={`grid h-9 w-9 place-items-center rounded-xl ${admin ? 'bg-status-warning' : 'bg-accent-500'}`}>
            <Zap className="h-5 w-5 text-white" />
          </span>
          <div>
            <div className="type-subhead font-bold text-text-primary">Obsidian Desk{admin ? ' · Admin' : ''}</div>
            <div className="type-caption text-text-tertiary">{admin ? 'Administrator sign-in' : 'Client sign-in'}</div>
          </div>
        </div>
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-border-default bg-bg-surface-2 px-3 py-2">
          <Lock className={`h-3.5 w-3.5 ${admin ? 'text-status-warning' : 'text-status-success'}`} />
          <span className="type-caption font-mono text-text-tertiary">
            {admin ? 'admin.obsidiandesk.com' : 'app.obsidiandesk.com/login'}
          </span>
        </div>
        <SupabaseLogin />
        {!admin && (
          <p className="mt-4 rounded-lg border border-border-default bg-bg-surface-2 px-3 py-2.5 type-caption text-text-secondary">
            You control the software as a tool: you self-assess appropriateness, set every parameter, hold the exchange keys, and can deactivate at any time. It provides <strong className="text-text-primary">no advice</strong> or recommendation.
          </p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test LoginDoor`
Expected: PASS.

- [ ] **Step 5: Write `DevDoorSwitch.tsx`**

Create `src/features/clientPortal/DevDoorSwitch.tsx`:
```tsx
import type { Door } from './routing'

export function DevDoorSwitch({ role }: { role: Door }) {
  if (!import.meta.env.DEV) return null
  const go = (r: Door) => { window.location.hash = r === 'admin' ? '#/admin' : '#/login' }
  return (
    <div className="fixed bottom-4 left-4 z-[90] flex items-center gap-2 rounded-xl border border-dashed border-border-default bg-bg-surface-1/90 px-3 py-1.5 font-mono text-[11px] shadow-lg backdrop-blur">
      <span className="uppercase tracking-wider text-text-tertiary">Dev</span>
      <div className="flex gap-1 rounded-lg bg-bg-surface-2 p-0.5">
        <button type="button" onClick={() => go('client')} className={`rounded-md px-2.5 py-1 font-semibold ${role === 'client' ? 'bg-accent-500/15 text-accent-400' : 'text-text-tertiary'}`}>Client</button>
        <button type="button" onClick={() => go('admin')} className={`rounded-md px-2.5 py-1 font-semibold ${role === 'admin' ? 'bg-status-warning/15 text-status-warning' : 'text-text-tertiary'}`}>Admin</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/features/clientPortal/LoginDoor.tsx src/features/clientPortal/DevDoorSwitch.tsx src/features/clientPortal/__tests__/LoginDoor.test.tsx
git commit -m "feat(client-portal): add branded login doors + dev door switch"
```

---

### Task 8: DashboardPage

**Files:**
- Create: `src/features/clientPortal/pages/DashboardPage.tsx`
- Test: `src/features/clientPortal/__tests__/DashboardPage.test.tsx`

**Interfaces:**
- Consumes: `portfolioSummary`, `positionSummaryRows` from `../portfolio`; `SetupStatus` from `../setupStatus`; `Position`, `MarksMap`, `fmtPremium` from `@/utils`; `PortalPage` from `../routing`.
- Produces: `DashboardPage(props: { positions: Position[]; marks?: MarksMap; setupStatus: SetupStatus; onNavigate: (page: PortalPage) => void }): JSX.Element`

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/__tests__/DashboardPage.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DashboardPage } from '../pages/DashboardPage'
import { EMPTY_SETUP_STATUS } from '../setupStatus'
import type { Position } from '@/utils'

const positions = [{
  id: 'p1', underlying: 'BTC', programName: 'Weekend Vol', exchange: 'deribit',
  expiryISO: '2025-12-14', dte: 1, status: 'open', netPremium: 0.004, realizedPnl: 0.001,
  strategy: 'Iron Condor', structureId: 's1', legs: [],
} as unknown as Position]

describe('DashboardPage', () => {
  it('shows KPIs and an outstanding setup item', () => {
    render(<DashboardPage positions={positions} setupStatus={EMPTY_SETUP_STATUS} onNavigate={() => {}} />)
    expect(screen.getByText(/equity/i)).toBeInTheDocument()
    expect(screen.getByText(/open positions/i)).toBeInTheDocument()
    expect(screen.getByText(/appropriateness/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test DashboardPage`
Expected: FAIL — cannot find module `../pages/DashboardPage`.

- [ ] **Step 3: Write the implementation**

Create `src/features/clientPortal/pages/DashboardPage.tsx`:
```tsx
import { Check, AlertCircle } from 'lucide-react'
import { fmtPremium, type Position, type MarksMap } from '@/utils'
import { portfolioSummary } from '../portfolio'
import type { SetupStatus } from '../setupStatus'
import type { PortalPage } from '../routing'

const SETUP_LABELS: { key: keyof SetupStatus; label: string }[] = [
  { key: 'appropriateness', label: 'Appropriateness signed' },
  { key: 'strategy', label: 'Strategy selected' },
  { key: 'riskLimits', label: 'Risk limits set' },
  { key: 'tradingKey', label: 'Exchange key active' },
]

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="rounded-xl border border-border-default bg-bg-surface-1 p-4">
      <div className="type-caption uppercase tracking-wide text-text-tertiary">{label}</div>
      <div className={`mt-1.5 type-title-l font-bold ${tone === 'pos' ? 'text-status-success' : tone === 'neg' ? 'text-status-danger' : 'text-text-primary'}`}>{value}</div>
    </div>
  )
}

export function DashboardPage({ positions, marks, setupStatus, onNavigate }: {
  positions: Position[]; marks?: MarksMap; setupStatus: SetupStatus; onNavigate: (page: PortalPage) => void
}) {
  const s = portfolioSummary(positions, marks)
  const pnl = s.totalPnl
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="type-title-l font-bold text-text-primary">Dashboard</h1>
        <p className="mt-1 type-subhead text-text-secondary">Your portfolio at a glance. Everything here runs on the parameters you set.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Equity" value={fmtPremium(s.totalEquity, s.asset)} />
        <Kpi label="PnL" value={pnl != null ? fmtPremium(pnl, s.asset) : '—'} tone={pnl != null ? (pnl < 0 ? 'neg' : 'pos') : undefined} />
        <Kpi label="PnL %" value={s.pnlPct != null ? `${s.pnlPct.toFixed(2)}%` : '—'} tone={s.pnlPct != null ? (s.pnlPct < 0 ? 'neg' : 'pos') : undefined} />
        <Kpi label="Open positions" value={String(positions.length)} />
      </div>
      <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-5">
        <div className="type-caption uppercase tracking-wide text-text-tertiary">Setup status</div>
        <div className="mt-3 flex flex-wrap gap-2.5">
          {SETUP_LABELS.map(({ key, label }) => {
            const done = setupStatus[key]
            return (
              <button key={key} type="button" onClick={() => onNavigate(key === 'tradingKey' ? 'keys' : key === 'riskLimits' ? 'risk' : key)} className="flex items-center gap-2 rounded-lg border border-border-default bg-bg-surface-0 px-3 py-2 type-caption text-text-secondary hover:bg-bg-surface-2">
                {done ? <Check className="h-3.5 w-3.5 text-status-success" /> : <AlertCircle className="h-3.5 w-3.5 text-status-warning" />}
                {label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test DashboardPage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/pages/DashboardPage.tsx src/features/clientPortal/__tests__/DashboardPage.test.tsx
git commit -m "feat(client-portal): add Dashboard overview page"
```

---

### Task 9: PositionsPage

**Files:**
- Create: `src/features/clientPortal/pages/PositionsPage.tsx`
- Test: `src/features/clientPortal/__tests__/PositionsPage.test.tsx`

**Interfaces:**
- Consumes: `positionSummaryRows` from `../portfolio`; `DataTable`, `type Column` from `@/components/ui`; `StatusBadge` from `@/components/StatusBadge`; `Button` from `@/components/ui/Button`; `fmtPremium`, `fmtNumber`, `type Position`, `type MarksMap` from `@/utils`.
- Produces: `PositionsPage(props: { positions: Position[]; marks?: MarksMap; onModify: (id: string) => void; onClose: (id: string) => void }): JSX.Element`
  - Phase 1 renders the Positions table with per-row **Modify** and **Close** controls wired to the callbacks. (Trades / Open-for-Confirmation tabs are added in a later phase; a single Positions view ships now.)

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/__tests__/PositionsPage.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PositionsPage } from '../pages/PositionsPage'
import type { Position } from '@/utils'

const positions = [{
  id: 'p1', underlying: 'BTC', programName: 'Weekend Vol', exchange: 'deribit',
  expiryISO: '2025-12-14', dte: 1, status: 'open', netPremium: 0.004, realizedPnl: 0.001,
  strategy: 'Iron Condor', structureId: 's1', legs: [],
} as unknown as Position]

describe('PositionsPage', () => {
  it('lists positions with override controls', async () => {
    const onClose = vi.fn()
    render(<PositionsPage positions={positions} onModify={() => {}} onClose={onClose} />)
    expect(screen.getByText('Iron Condor')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^close$/i }))
    expect(onClose).toHaveBeenCalledWith('p1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test PositionsPage`
Expected: FAIL — cannot find module `../pages/PositionsPage`.

- [ ] **Step 3: Write the implementation**

Create `src/features/clientPortal/pages/PositionsPage.tsx`:
```tsx
import React from 'react'
import { DataTable, type Column } from '@/components/ui'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/StatusBadge'
import { fmtPremium, fmtNumber, type Position, type MarksMap } from '@/utils'
import { positionSummaryRows, type PositionSummaryRow } from '../portfolio'

export function PositionsPage({ positions, marks, onModify, onClose }: {
  positions: Position[]; marks?: MarksMap; onModify: (id: string) => void; onClose: (id: string) => void
}) {
  const rows = React.useMemo(() => positionSummaryRows(positions, marks), [positions, marks])

  const columns: Column<PositionSummaryRow>[] = React.useMemo(() => [
    { key: 'strategy', header: 'Structure', render: (r) => <span className="font-medium text-text-primary">{r.strategy}</span> },
    { key: 'underlying', header: 'Underlying', render: (r) => r.underlying },
    { key: 'expiry', header: 'Expiry', render: (r) => r.expiry },
    { key: 'dte', header: 'DTE', align: 'right', render: (r) => r.dte },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'netPremium', header: 'Net Prem', align: 'right', render: (r) => fmtPremium(r.netPremium, r.asset) },
    { key: 'realizedPnl', header: 'Real. PnL', align: 'right', render: (r) => <span className={r.realizedPnl < 0 ? 'text-status-danger' : 'text-status-success'}>{fmtPremium(r.realizedPnl, r.asset)}</span> },
    { key: 'unrealizedPnl', header: 'uPnL', align: 'right', render: (r) => r.unrealizedPnl == null ? '—' : <span className={r.unrealizedPnl < 0 ? 'text-status-danger' : 'text-status-success'}>{fmtPremium(r.unrealizedPnl, r.asset)}</span> },
    { key: 'delta', header: 'Δ', align: 'right', headerAbbr: 'Delta', render: (r) => r.delta != null ? fmtNumber(r.delta) : '—' },
    {
      key: 'control', header: 'Control', align: 'right',
      render: (r) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => onModify(r.id)}>Modify</Button>
          <Button size="sm" variant="danger" onClick={() => onClose(r.id)}>Close</Button>
        </div>
      ),
    },
  ], [onModify, onClose])

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

Run: `pnpm test PositionsPage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/pages/PositionsPage.tsx src/features/clientPortal/__tests__/PositionsPage.test.tsx
git commit -m "feat(client-portal): add Positions page with override controls"
```

---

### Task 10: useClientPositions hook + ClientPortalShell

**Files:**
- Create: `src/features/clientPortal/useClientPositions.ts`
- Create: `src/features/clientPortal/ClientPortalShell.tsx`
- Test: `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`

**Interfaces:**
- Consumes: `getSupabaseClient` from `@/lib/supabase`; `fetchSavedStructures` from `@/lib/positions/fetchSavedStructures`; `Position` from `@/utils`; all client-portal components/pages above; `parsePortalPage`, `portalHash`, `type PortalPage` from `./routing`; `EMPTY_SETUP_STATUS` from `./setupStatus`.
- Produces:
  - `useClientPositions(clientName: string | null): { positions: Position[]; loading: boolean; error: string | null; reload: () => void }`
  - `ClientPortalShell(props: { clientName: string; program: string; hash: string; onSignOut: () => void }): JSX.Element` — composes sidebar + top bar (page title + `ActivationControl`) + `ResponsibilityStrip` + the routed page. Navigation sets `window.location.hash` via `portalHash`. Phase 1 uses `EMPTY_SETUP_STATUS` (setup surfaces arrive in later phases); activation state is local component state; `onModify`/`onClose` are Phase-1 no-op stubs logged to console (real override wiring is a later phase).

- [ ] **Step 1: Write the failing test (shell composition)**

Create `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../useClientPositions', () => ({ useClientPositions: () => ({ positions: [], loading: false, error: null, reload: () => {} }) }))

import { ClientPortalShell } from '../ClientPortalShell'

describe('ClientPortalShell', () => {
  it('renders the sidebar, activation control, and the routed page', () => {
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/dashboard" onSignOut={() => {}} />)
    expect(screen.getByText('TwoPrime')).toBeInTheDocument()
    expect(screen.getByText(/^software$/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument()
  })

  it('routes to Positions from the hash', () => {
    render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/positions" onSignOut={() => {}} />)
    expect(screen.getByRole('heading', { name: /positions/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test ClientPortalShell`
Expected: FAIL — cannot find module `../ClientPortalShell`.

- [ ] **Step 3: Write `useClientPositions.ts`**

Create `src/features/clientPortal/useClientPositions.ts`:
```ts
import React from 'react'
import { getSupabaseClient, hasSupabaseClient } from '@/lib/supabase'
import { fetchSavedStructures } from '@/lib/positions/fetchSavedStructures'
import type { Position } from '@/utils'

export function useClientPositions(clientName: string | null) {
  const [positions, setPositions] = React.useState<Position[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [nonce, setNonce] = React.useState(0)

  React.useEffect(() => {
    if (!hasSupabaseClient()) { setLoading(false); return }
    let ignore = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const result = await fetchSavedStructures(getSupabaseClient(), { clientName, isAdmin: false })
        if (ignore) return
        if (result.ok) setPositions(result.positions)
        else setError(result.error ?? 'Failed to load positions')
      } catch (e) {
        if (!ignore) setError(e instanceof Error ? e.message : 'Failed to load positions')
      } finally {
        if (!ignore) setLoading(false)
      }
    })()
    return () => { ignore = true }
  }, [clientName, nonce])

  const reload = React.useCallback(() => setNonce((n) => n + 1), [])
  return { positions, loading, error, reload }
}
```

> Note: `fetchSavedStructures` returns `{ ok: true; positions: Position[] } | { ok: false; error?: string }`. If the error branch field differs, use the actual property (check `FetchSavedStructuresResult` in `src/lib/positions/fetchSavedStructures.ts`).

- [ ] **Step 4: Write `ClientPortalShell.tsx`**

Create `src/features/clientPortal/ClientPortalShell.tsx`:
```tsx
import React from 'react'
import { Spinner } from '@/components/Spinner'
import { ClientSidebar } from './ClientSidebar'
import { ActivationControl } from './ActivationControl'
import { ResponsibilityStrip } from './ResponsibilityStrip'
import { DashboardPage } from './pages/DashboardPage'
import { PositionsPage } from './pages/PositionsPage'
import { useClientPositions } from './useClientPositions'
import { parsePortalPage, portalHash, type PortalPage } from './routing'
import { EMPTY_SETUP_STATUS } from './setupStatus'

const PAGE_TITLES: Record<PortalPage, string> = {
  dashboard: 'Dashboard', positions: 'Positions', appropriateness: 'Appropriateness',
  strategy: 'Strategy module', risk: 'Risk & deployment', keys: 'Exchange API keys',
  updates: 'Software updates', audit: 'Audit log',
}

export function ClientPortalShell({ clientName, program, hash, onSignOut }: {
  clientName: string; program: string; hash: string; onSignOut: () => void
}) {
  const page = parsePortalPage(hash)
  const [active, setActive] = React.useState(false)
  const { positions, loading } = useClientPositions(clientName)
  const setupStatus = EMPTY_SETUP_STATUS

  const navigate = React.useCallback((p: PortalPage) => { window.location.hash = portalHash(p) }, [])

  return (
    <div className="flex min-h-screen bg-bg-surface-0">
      <ClientSidebar
        clientName={clientName} program={program} active={page}
        setupStatus={setupStatus} onNavigate={navigate} onSignOut={onSignOut}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-border-default bg-bg-surface-0/80 px-6 py-3 backdrop-blur">
          <div className="type-subhead font-semibold text-text-primary">{PAGE_TITLES[page]}</div>
          <div className="flex-1" />
          <ActivationControl active={active} setupStatus={setupStatus} onToggle={() => setActive((v) => !v)} />
        </header>
        <ResponsibilityStrip onOpenAudit={() => navigate('audit')} />
        <main className="mx-auto w-full max-w-[1140px] flex-1 px-6 py-6">
          {loading && page === 'dashboard' ? (
            <div className="grid place-items-center py-20"><Spinner className="h-6 w-6" /></div>
          ) : page === 'positions' ? (
            <PositionsPage positions={positions} onModify={(id) => console.debug('modify', id)} onClose={(id) => console.debug('close', id)} />
          ) : page === 'dashboard' ? (
            <DashboardPage positions={positions} setupStatus={setupStatus} onNavigate={navigate} />
          ) : (
            <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-8 text-center type-subhead text-text-secondary">
              {PAGE_TITLES[page]} — coming in a later phase.
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test ClientPortalShell`
Expected: PASS — both shell tests green.

- [ ] **Step 6: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/features/clientPortal/useClientPositions.ts src/features/clientPortal/ClientPortalShell.tsx src/features/clientPortal/__tests__/ClientPortalShell.test.tsx
git commit -m "feat(client-portal): compose portal shell + client positions hook"
```

---

### Task 11: RootRouter integration

**Files:**
- Create: `src/RootRouter.tsx`
- Modify: `src/main.tsx` (render `<RootRouter />`)
- Test: `src/features/clientPortal/__tests__/RootRouter.test.tsx`

**Interfaces:**
- Consumes: `useAuth` from `@/features/auth/useAuth`; `resolveClientAccess` from `@/features/auth/access`; `App` (default) from `@/App`; `LoginDoor`, `DevDoorSwitch`, `ClientPortalShell`; `parseDoor`, `isPortalRoute` from `@/features/clientPortal/routing`.
- Produces: `RootRouter(): JSX.Element` — the new top-level component:
  - loading → full-screen spinner.
  - unauthenticated + client door → `<LoginDoor role="client" />`.
  - authenticated + not admin → `<ClientPortalShell />`.
  - everything else (admin door, or authenticated admin) → existing `<App />` (unchanged admin experience).
  - `<DevDoorSwitch />` overlaid in dev.

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/__tests__/RootRouter.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const authState = { user: null as unknown, loading: false, supabaseConfigured: true }
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => authState }))
vi.mock('@/App', () => ({ default: () => <div data-testid="admin-app" /> }))
vi.mock('../ClientPortalShell', () => ({ ClientPortalShell: () => <div data-testid="client-shell" /> }))
vi.mock('../LoginDoor', () => ({ LoginDoor: ({ role }: { role: string }) => <div data-testid={`door-${role}`} /> }))

import { RootRouter } from '@/RootRouter'

beforeEach(() => { window.location.hash = ''; authState.user = null; authState.loading = false })

describe('RootRouter', () => {
  it('shows the client login door when unauthenticated on the client door', () => {
    render(<RootRouter />)
    expect(screen.getByTestId('door-client')).toBeInTheDocument()
  })

  it('shows the client shell for an authenticated non-admin user', () => {
    authState.user = { email: 'client@x.com', app_metadata: {}, user_metadata: { client_name: 'TwoPrime' } }
    render(<RootRouter />)
    expect(screen.getByTestId('client-shell')).toBeInTheDocument()
  })

  it('renders the admin app on the admin door', () => {
    window.location.hash = '#/admin'
    render(<RootRouter />)
    expect(screen.getByTestId('admin-app')).toBeInTheDocument()
  })
})
```

> Note: admin detection depends on `resolveClientAccess`, which treats an **empty** `VITE_SUPABASE_ADMIN_EMAILS` allowlist as "everyone is admin". In the test env that variable is unset, so to exercise the non-admin path the second test relies on the door being `client` and the user having a `client_name` but... set `VITE_SUPABASE_ADMIN_EMAILS` for the test run: create `.env.test` with `VITE_SUPABASE_ADMIN_EMAILS=admin@obsidiandesk.com` and add `envDir`/mode handling, OR (simpler) in the test file set `import.meta.env.VITE_SUPABASE_ADMIN_EMAILS = 'admin@obsidiandesk.com'` inside `beforeEach`. Use the latter.

Add to `beforeEach`:
```ts
;(import.meta as unknown as { env: Record<string, string> }).env.VITE_SUPABASE_ADMIN_EMAILS = 'admin@obsidiandesk.com'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test RootRouter`
Expected: FAIL — cannot find module `@/RootRouter`.

- [ ] **Step 3: Write `RootRouter.tsx`**

Create `src/RootRouter.tsx`:
```tsx
import React from 'react'
import App from '@/App'
import { useAuth } from '@/features/auth/useAuth'
import { resolveClientAccess } from '@/features/auth/access'
import { getSupabaseClient, hasSupabaseClient } from '@/lib/supabase'
import { Spinner } from '@/components/Spinner'
import { LoginDoor } from '@/features/clientPortal/LoginDoor'
import { DevDoorSwitch } from '@/features/clientPortal/DevDoorSwitch'
import { ClientPortalShell } from '@/features/clientPortal/ClientPortalShell'
import { parseDoor } from '@/features/clientPortal/routing'

function useHash(): string {
  const [hash, setHash] = React.useState(() => (typeof window !== 'undefined' ? window.location.hash : ''))
  React.useEffect(() => {
    const handler = () => setHash(window.location.hash)
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])
  return hash
}

export function RootRouter() {
  const hash = useHash()
  const { user, loading } = useAuth()
  const { isAdmin, clientName } = resolveClientAccess(user)
  const door = parseDoor(hash)

  const signOut = React.useCallback(() => {
    if (hasSupabaseClient()) void getSupabaseClient().auth.signOut()
    window.location.hash = '#/login'
  }, [])

  let content: React.ReactNode
  if (loading) {
    content = <div className="grid min-h-screen place-items-center bg-bg-surface-0"><Spinner className="h-6 w-6" /></div>
  } else if (!user) {
    // Unauthenticated: admin door falls through to the existing admin app (which shows its own login);
    // every other entry (client door, or a #/portal/* deep link) shows the branded client login.
    content = door === 'admin' ? <App /> : <LoginDoor role="client" />
  } else if (!isAdmin) {
    content = <ClientPortalShell clientName={clientName ?? 'Client'} program="Obsidian Core" hash={hash} onSignOut={signOut} />
  } else {
    content = <App />
  }

  return <>{content}<DevDoorSwitch role={door} /></>
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test RootRouter`
Expected: PASS — all three routing branches green.

- [ ] **Step 5: Point `main.tsx` at `RootRouter`**

In `src/main.tsx`, replace the `App` import and render:
```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import { RootRouter } from './RootRouter'
import './styles/utilities.css'

const root = createRoot(document.getElementById('root')!)
root.render(<RootRouter />)
```

- [ ] **Step 6: Full typecheck, test, build**

Run: `pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: no type errors; all tests pass; build succeeds.

- [ ] **Step 7: Manual verification in the preview**

Start the dev server via the preview tool. Verify:
1. Unauthenticated default (`#/login`) → branded **client** login door; the **DEV** switch appears bottom-left.
2. Click DEV → **Admin** → hash becomes `#/admin`, the existing admin login/app renders.
3. Sign in as a non-admin user → the **client portal shell** renders; sidebar navigation between **Dashboard** and **Positions** works and updates the URL hash; the activation control shows **Inactive** with **Activate disabled** (hovering shows the outstanding items); the responsibility strip is visible; other sidebar items show the "coming in a later phase" placeholder.
4. Sign in as an admin user (email in `VITE_SUPABASE_ADMIN_EMAILS`) → the existing admin `DashboardApp` renders unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/RootRouter.tsx src/main.tsx src/features/clientPortal/__tests__/RootRouter.test.tsx
git commit -m "feat(client-portal): role-gated root router + wire client portal entry"
```

---

## Self-Review

**Spec coverage (Phase 1 scope — spec §14 phase 1):**
- Role router (admin vs client) → Task 11. ✓
- `ClientPortalShell` + sidebar + responsibility strip → Tasks 4, 6, 10. ✓
- Persistent activation/kill-switch with four-precondition gate → Tasks 2, 5 (gate logic + control); wired disabled in Phase 1 with real data deferred. ✓
- Dashboard + Positions reusing current aggregation → Tasks 3, 8, 9. ✓
- Login doors + dev switch → Task 7, 11. ✓
- Two front doors (client vs admin) → Task 1 (`parseDoor`) + Task 11. ✓
- Core principle "no advice/recommendation" → enforced in copy (Tasks 4, 7) and Global Constraints. ✓
- Test harness (user-chosen) → Task 0. ✓

**Deferred to later phases (correctly out of Phase 1 scope):** Appropriateness/Strategy/Risk/Keys/Updates/Audit pages (placeholder shown), real `SetupStatus` data + activation persistence, live marks, real Modify/Close execution, Supabase audit tables, branded admin door, mobile off-canvas sidebar. These are named in the shell placeholder and spec §14 phases 2–4.

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N" — every code step contains complete code. The two "Note" callouts (fetchSavedStructures error field; admin-allowlist env in tests) point at exact files/values, not vague deferrals.

**Type consistency:** `PortalPage`, `Door`, `SetupStatus`, `PortfolioSummary`, `PositionSummaryRow`, `canActivate`, `outstandingItems`, `portfolioSummary`, `positionSummaryRows`, `parsePortalPage`, `portalHash`, `parseDoor`, `isPortalRoute`, `useClientPositions` are defined once and consumed with matching signatures across tasks. `ClientPortalShell` and `RootRouter` props match their test usages.

**Known risk to watch:** `resolveClientAccess` treats an empty admin allowlist as "everyone is admin" (`access.ts:77-78`). In production the client portal only appears when the allowlist is configured and the user is not on it. Task 11 Step 7 verification and the RootRouter test both account for this; call it out to the implementer.
