# Client Portal — Phase 2: Risk Engine (UI + local state)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the client's **Risk & deployment** page (`#/portal/risk`) — deployment params, the Greek exposure limits (regime-dependent Delta Cash, two-sided Gamma, Vega band, Theta floor) with live-value gauges, and the Stress & aggregate limits (5% stress matrix, 10% net delta, two-stage drawdown) — with client-editable bounds held in shell state. Applying limits flips the `riskLimits` activation precondition so the sidebar check and activation gate respond.

**Architecture:** Design is fixed by spec §8 + the approved mockup. This slice is **UI + local state only** — no Supabase. `ClientPortalShell` (already mounted across page switches) holds `riskLimits` and a now-stateful `setupStatus`. Pure geometry/status/stress helpers are extracted and unit-tested; two reusable presentational pieces (`LimitGauge`, `StressMatrix`) render from those models; `RiskPage` composes the three cards and edits a draft, committing via `onApply`. Live "now" readings are **illustrative placeholders** (a documented constant) until a greek engine + live marks exist in a later phase — the client-set *bounds* are the real deliverable here.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind v4, Vitest + Testing Library, `lucide-react`.

## Global Constraints

- **The software never advises, recommends, or renders a verdict.** No "recommended"/"suggested" markers on any limit. Copy records the client's own limits. (Spec §2.)
- **Design tokens only** — real tokens: `bg-bg-canvas`, `bg-bg-elevated`, `bg-bg-surface-1..4`, `text-text-{primary,secondary,tertiary}`, `border-border-{default,subtle}`, `text-status-{success,danger,warning,info}` (+ `/NN` opacity), `text-accent-400`/`bg-accent-500`, `type-{title-l,subhead,caption}`. **No raw zinc/slate/hex, no `bg-bg-surface-0`.**
- **All Greek/stress/delta limits are percentages of strategy TVL.** TVL = the client's capital allocation (`capitalTvlBtc`).
- **Breach behavior (display only in this slice):** Greek/stress/net-delta limits → "rebalance"; drawdown → two-stage (reduce → stop & close). No execution logic in Phase 2.
- **Package manager: pnpm.** Path alias `@/` → `src/`.
- **Do not change** `src/DashboardApp.tsx`, `src/App.tsx`, or `src/features/auth/access.ts`. Admin path stays untouched.
- Every task is TDD (test first, verified failing, then implementation). `pnpm exec tsc --noEmit` clean and full `pnpm test` green before each commit. Commit trailer ends with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- Branch: `main` (per user direction).

---

## File Structure

```
src/features/clientPortal/risk/
  riskLimits.ts        # Task 1 — RiskLimits/GreekReadings types, DEFAULT_RISK_LIMITS, ILLUSTRATIVE_READINGS, activeDeltaBand (pure)
  gauge.ts             # Task 2 — rangeGauge/paddedDomain geometry, bandStatus/capStatus, twoStageGauge (pure)
  stress.ts            # Task 3 — STRESS_SCENARIO grid, worstCell, headroomPct (pure)
  LimitGauge.tsx       # Task 4 — renders a range gauge (marker/safe-zone/ticks) + a two-stage variant
  StressMatrix.tsx     # Task 5 — 3×3 scenario grid, worst cell highlighted
  RiskPage.tsx         # Task 6 — 3 cards, editable bounds (draft), TVL note, regime chips, breach indicators, Apply
  __tests__/           # co-located specs
src/features/clientPortal/ClientPortalShell.tsx   # Task 7 — stateful setupStatus + riskLimits, render RiskPage, wire onApply
```

---

### Task 1: Risk limits data model (pure)

**Files:**
- Create: `src/features/clientPortal/risk/riskLimits.ts`
- Test: `src/features/clientPortal/risk/__tests__/riskLimits.test.ts`

**Interfaces (Produces):**
- `type Band = { min: number; max: number }`
- `type RiskLimits = { capitalTvlBtc: number; maxConcurrent: number; expiryMinDte: number; expiryMaxDte: number; autoRoll: boolean; deltaLongGamma: Band; deltaShortGamma: Band; gammaFloor: number; gammaCap: number; vega: Band; thetaFloor: number; stressLossMaxPct: number; netDeltaMaxPct: number; drawdownReducePct: number; drawdownStopPct: number }`
- `type GreekReadings = { deltaPct: number; gammaPct: number; vegaPct: number; thetaPct: number; stressWorstPct: number; netDeltaPct: number; drawdownPct: number }`
- `const DEFAULT_RISK_LIMITS: RiskLimits`
- `const ILLUSTRATIVE_READINGS: GreekReadings`
- `activeDeltaBand(limits: RiskLimits, readings: GreekReadings): { band: Band; regime: 'long' | 'short' }` — short gamma (readings.gammaPct < 0) → `deltaShortGamma`; else `deltaLongGamma`.

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/risk/__tests__/riskLimits.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_RISK_LIMITS, ILLUSTRATIVE_READINGS, activeDeltaBand } from '../riskLimits'

describe('DEFAULT_RISK_LIMITS', () => {
  it('encodes the Weekend Vol defaults', () => {
    expect(DEFAULT_RISK_LIMITS.capitalTvlBtc).toBe(0.03)
    expect(DEFAULT_RISK_LIMITS.deltaShortGamma).toEqual({ min: -10, max: 10 })
    expect(DEFAULT_RISK_LIMITS.deltaLongGamma).toEqual({ min: -60, max: 60 })
    expect(DEFAULT_RISK_LIMITS.gammaFloor).toBe(-10)
    expect(DEFAULT_RISK_LIMITS.gammaCap).toBe(0)
    expect(DEFAULT_RISK_LIMITS.vega).toEqual({ min: -0.5, max: 0.5 })
    expect(DEFAULT_RISK_LIMITS.thetaFloor).toBe(-2)
    expect(DEFAULT_RISK_LIMITS.stressLossMaxPct).toBe(5)
    expect(DEFAULT_RISK_LIMITS.netDeltaMaxPct).toBe(10)
    expect(DEFAULT_RISK_LIMITS.drawdownReducePct).toBe(20)
    expect(DEFAULT_RISK_LIMITS.drawdownStopPct).toBe(33)
  })
})

describe('activeDeltaBand', () => {
  it('selects the short-gamma band when gamma reading is negative', () => {
    const r = activeDeltaBand(DEFAULT_RISK_LIMITS, ILLUSTRATIVE_READINGS)
    expect(ILLUSTRATIVE_READINGS.gammaPct).toBeLessThan(0)
    expect(r.regime).toBe('short')
    expect(r.band).toEqual({ min: -10, max: 10 })
  })
  it('selects the long-gamma band when gamma is positive', () => {
    const r = activeDeltaBand(DEFAULT_RISK_LIMITS, { ...ILLUSTRATIVE_READINGS, gammaPct: 4 })
    expect(r.regime).toBe('long')
    expect(r.band).toEqual({ min: -60, max: 60 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test riskLimits`
Expected: FAIL — cannot find module `../riskLimits`.

- [ ] **Step 3: Write the implementation**

Create `src/features/clientPortal/risk/riskLimits.ts`:
```ts
export type Band = { min: number; max: number }

export type RiskLimits = {
  // Deployment
  capitalTvlBtc: number
  maxConcurrent: number
  expiryMinDte: number
  expiryMaxDte: number
  autoRoll: boolean
  // Greek limits (% of TVL)
  deltaLongGamma: Band   // Γ > 0
  deltaShortGamma: Band  // Γ < 0
  gammaFloor: number
  gammaCap: number
  vega: Band
  thetaFloor: number
  // Stress & aggregate (% of TVL)
  stressLossMaxPct: number
  netDeltaMaxPct: number
  drawdownReducePct: number
  drawdownStopPct: number
}

export type GreekReadings = {
  deltaPct: number
  gammaPct: number
  vegaPct: number
  thetaPct: number
  stressWorstPct: number // magnitude of the worst-case loss, % of TVL
  netDeltaPct: number    // absolute
  drawdownPct: number    // current drawdown, % of TVL
}

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  capitalTvlBtc: 0.03,
  maxConcurrent: 3,
  expiryMinDte: 1,
  expiryMaxDte: 3,
  autoRoll: false,
  deltaLongGamma: { min: -60, max: 60 },
  deltaShortGamma: { min: -10, max: 10 },
  gammaFloor: -10,
  gammaCap: 0,
  vega: { min: -0.5, max: 0.5 },
  thetaFloor: -2,
  stressLossMaxPct: 5,
  netDeltaMaxPct: 10,
  drawdownReducePct: 20,
  drawdownStopPct: 33,
}

// Placeholder live readings until a greek engine + live marks are wired (later phase).
export const ILLUSTRATIVE_READINGS: GreekReadings = {
  deltaPct: 3.2,
  gammaPct: -8.1,
  vegaPct: -0.28,
  thetaPct: 0.8,
  stressWorstPct: 3.4,
  netDeltaPct: 3.2,
  drawdownPct: 6.7,
}

export function activeDeltaBand(
  limits: RiskLimits,
  readings: GreekReadings,
): { band: Band; regime: 'long' | 'short' } {
  return readings.gammaPct < 0
    ? { band: limits.deltaShortGamma, regime: 'short' }
    : { band: limits.deltaLongGamma, regime: 'long' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test riskLimits`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/risk/riskLimits.ts src/features/clientPortal/risk/__tests__/riskLimits.test.ts
git commit -m "feat(risk): add risk-limits model, defaults, and delta-regime selection"
```

---

### Task 2: Gauge geometry & status (pure)

**Files:**
- Create: `src/features/clientPortal/risk/gauge.ts`
- Test: `src/features/clientPortal/risk/__tests__/gauge.test.ts`

**Interfaces (Produces):**
- `type LimitStatus = 'ok' | 'near' | 'breach'`
- `type GaugeModel = { markerPct: number; safeStartPct: number; safeWidthPct: number; zeroPct: number | null }`
- `paddedDomain(safeLo: number, safeHi: number, padFrac?: number): [number, number]` — default padFrac 0.3.
- `rangeGauge(value: number, domLo: number, domHi: number, safeLo: number, safeHi: number): GaugeModel` — all pcts clamped 0..100; `zeroPct` is null unless 0 ∈ [domLo, domHi].
- `bandStatus(value: number, safeLo: number, safeHi: number, nearFrac?: number): LimitStatus` — breach outside [safeLo,safeHi]; near within `nearFrac` (default 0.2) of either edge; else ok.
- `capStatus(value: number, cap: number, nearFrac?: number): LimitStatus` — uses |value|; breach if > cap; near if |value|/cap > nearFrac (default 0.6); else ok.
- `type TwoStageModel = { markerPct: number; amberStartPct: number; redStartPct: number; status: LimitStatus }`
- `twoStageGauge(value: number, reduce: number, stop: number, domHi: number): TwoStageModel` — status: breach if value≥stop, near if value≥reduce, else ok.

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/risk/__tests__/gauge.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { paddedDomain, rangeGauge, bandStatus, capStatus, twoStageGauge } from '../gauge'

describe('paddedDomain', () => {
  it('pads 30% of the safe span on each side', () => {
    expect(paddedDomain(-10, 10)).toEqual([-16, 16])
  })
})

describe('rangeGauge', () => {
  it('maps value/safe-zone/zero to clamped percentages', () => {
    const [lo, hi] = paddedDomain(-10, 10)
    const g = rangeGauge(3.2, lo, hi, -10, 10)
    expect(g.markerPct).toBeCloseTo(60, 5)
    expect(g.safeStartPct).toBeCloseTo(18.75, 5)
    expect(g.safeWidthPct).toBeCloseTo(62.5, 5)
    expect(g.zeroPct).toBeCloseTo(50, 5)
  })
  it('clamps out-of-domain markers and omits zero when 0 is outside the domain', () => {
    const g = rangeGauge(50, 0, 10, 0, 10)
    expect(g.markerPct).toBe(100)
    expect(g.zeroPct).toBeCloseTo(0, 5)
    const g2 = rangeGauge(5, 2, 10, 2, 10)
    expect(g2.zeroPct).toBeNull()
  })
})

describe('bandStatus', () => {
  it('flags near when close to a safe-zone edge, ok in the middle, breach outside', () => {
    expect(bandStatus(-8.1, -10, 0)).toBe('near')   // gamma near floor
    expect(bandStatus(3.2, -10, 10)).toBe('ok')     // delta comfortable
    expect(bandStatus(-0.28, -0.5, 0.5)).toBe('ok') // vega comfortable
    expect(bandStatus(0.8, -2, 2)).toBe('ok')       // theta comfortable
    expect(bandStatus(12, -10, 10)).toBe('breach')
  })
})

describe('capStatus', () => {
  it('uses magnitude vs the cap with a 60% near threshold', () => {
    expect(capStatus(3.4, 5)).toBe('near')   // stress worst 3.4 of 5
    expect(capStatus(3.2, 10)).toBe('ok')    // net delta 3.2 of 10
    expect(capStatus(6, 5)).toBe('breach')
  })
})

describe('twoStageGauge', () => {
  it('locates the reduce/stop thresholds and classifies the current value', () => {
    const m = twoStageGauge(6.7, 20, 33, 39.6)
    expect(m.status).toBe('ok')
    expect(m.amberStartPct).toBeCloseTo(50.505, 2)
    expect(m.redStartPct).toBeCloseTo(83.333, 2)
    expect(twoStageGauge(25, 20, 33, 39.6).status).toBe('near')
    expect(twoStageGauge(33, 20, 33, 39.6).status).toBe('breach')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test gauge`
Expected: FAIL — cannot find module `../gauge`.

- [ ] **Step 3: Write the implementation**

Create `src/features/clientPortal/risk/gauge.ts`:
```ts
export type LimitStatus = 'ok' | 'near' | 'breach'

export type GaugeModel = {
  markerPct: number
  safeStartPct: number
  safeWidthPct: number
  zeroPct: number | null
}

const clamp = (x: number) => Math.max(0, Math.min(100, x))

export function paddedDomain(safeLo: number, safeHi: number, padFrac = 0.3): [number, number] {
  const pad = (safeHi - safeLo) * padFrac
  return [safeLo - pad, safeHi + pad]
}

export function rangeGauge(
  value: number, domLo: number, domHi: number, safeLo: number, safeHi: number,
): GaugeModel {
  const span = domHi - domLo
  return {
    markerPct: clamp(((value - domLo) / span) * 100),
    safeStartPct: clamp(((safeLo - domLo) / span) * 100),
    safeWidthPct: clamp(((safeHi - safeLo) / span) * 100),
    zeroPct: domLo <= 0 && domHi >= 0 ? clamp(((0 - domLo) / span) * 100) : null,
  }
}

export function bandStatus(value: number, safeLo: number, safeHi: number, nearFrac = 0.2): LimitStatus {
  if (value < safeLo || value > safeHi) return 'breach'
  const t = (value - safeLo) / (safeHi - safeLo)
  return t < nearFrac || t > 1 - nearFrac ? 'near' : 'ok'
}

export function capStatus(value: number, cap: number, nearFrac = 0.6): LimitStatus {
  const m = Math.abs(value)
  if (m > cap) return 'breach'
  return m / cap > nearFrac ? 'near' : 'ok'
}

export type TwoStageModel = {
  markerPct: number
  amberStartPct: number
  redStartPct: number
  status: LimitStatus
}

export function twoStageGauge(value: number, reduce: number, stop: number, domHi: number): TwoStageModel {
  const pct = (x: number) => clamp((x / domHi) * 100)
  const status: LimitStatus = value >= stop ? 'breach' : value >= reduce ? 'near' : 'ok'
  return { markerPct: pct(value), amberStartPct: pct(reduce), redStartPct: pct(stop), status }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test gauge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/risk/gauge.ts src/features/clientPortal/risk/__tests__/gauge.test.ts
git commit -m "feat(risk): add gauge geometry and limit-status helpers"
```

---

### Task 3: Stress scenario matrix (pure)

**Files:**
- Create: `src/features/clientPortal/risk/stress.ts`
- Test: `src/features/clientPortal/risk/__tests__/stress.test.ts`

**Interfaces (Produces):**
- `const SPOT_SHOCKS: number[]` = `[10, 0, -10]` (rows, % spot).
- `const IV_SHOCKS: number[]` = `[-20, 0, 20]` (cols, % parallel IV).
- `const STRESS_SCENARIO: number[][]` — PnL as % of TVL, `STRESS_SCENARIO[row][col]`.
- `worstCell(grid: number[][]): { row: number; col: number; value: number }` — the most-negative cell.
- `headroomPct(worstLossPct: number, limitPct: number): number` — `limitPct - worstLossPct` (both positive magnitudes).

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/risk/__tests__/stress.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { STRESS_SCENARIO, SPOT_SHOCKS, IV_SHOCKS, worstCell, headroomPct } from '../stress'

describe('stress scenario', () => {
  it('is a 3x3 grid aligned to the shock axes', () => {
    expect(SPOT_SHOCKS).toEqual([10, 0, -10])
    expect(IV_SHOCKS).toEqual([-20, 0, 20])
    expect(STRESS_SCENARIO).toHaveLength(3)
    STRESS_SCENARIO.forEach((row) => expect(row).toHaveLength(3))
  })
  it('finds the worst (most negative) cell', () => {
    const w = worstCell(STRESS_SCENARIO)
    expect(w).toEqual({ row: 2, col: 2, value: -3.4 })
  })
  it('computes headroom against the limit', () => {
    expect(headroomPct(3.4, 5)).toBeCloseTo(1.6, 5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test stress`
Expected: FAIL — cannot find module `../stress`.

- [ ] **Step 3: Write the implementation**

Create `src/features/clientPortal/risk/stress.ts`:
```ts
// Rows = spot shock, Cols = parallel IV shock. Values are PnL as % of TVL.
export const SPOT_SHOCKS = [10, 0, -10]
export const IV_SHOCKS = [-20, 0, 20]

export const STRESS_SCENARIO: number[][] = [
  [-1.9, -2.4, -3.0],
  [1.2, 0.4, -1.1],
  [-2.2, -2.7, -3.4],
]

export function worstCell(grid: number[][]): { row: number; col: number; value: number } {
  let worst = { row: 0, col: 0, value: grid[0][0] }
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] < worst.value) worst = { row: r, col: c, value: grid[r][c] }
    }
  }
  return worst
}

export function headroomPct(worstLossPct: number, limitPct: number): number {
  return limitPct - worstLossPct
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test stress`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/risk/stress.ts src/features/clientPortal/risk/__tests__/stress.test.ts
git commit -m "feat(risk): add stress scenario grid + worst-cell/headroom helpers"
```

---

### Task 4: LimitGauge component

**Files:**
- Create: `src/features/clientPortal/risk/LimitGauge.tsx`
- Test: `src/features/clientPortal/risk/__tests__/LimitGauge.test.tsx`

**Interfaces:**
- Consumes: `GaugeModel`, `TwoStageModel`, `LimitStatus` from `./gauge`.
- Produces:
  - `LimitGauge(props: { model: GaugeModel; status: LimitStatus; leftLabel: React.ReactNode; rightLabel: React.ReactNode; floorTick?: boolean }): JSX.Element` — a horizontal track: red base, green safe zone (`safeStartPct`/`safeWidthPct`), optional floor tick + zero tick, a status-colored marker at `markerPct`, and the two labels below.
  - `TwoStageGauge(props: { model: TwoStageModel; leftLabel: React.ReactNode; midLabel: React.ReactNode; rightLabel: React.ReactNode }): JSX.Element` — green→amber(`amberStartPct`)→red(`redStartPct`) segments, a marker, three labels.

Status→color: `ok`→`bg-status-success`, `near`→`bg-status-warning`, `breach`→`bg-status-danger`.

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/risk/__tests__/LimitGauge.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { LimitGauge, TwoStageGauge } from '../LimitGauge'

describe('LimitGauge', () => {
  it('positions the marker and renders labels', () => {
    const { container, getByText } = render(
      <LimitGauge
        model={{ markerPct: 60, safeStartPct: 18.75, safeWidthPct: 62.5, zeroPct: 50 }}
        status="ok" leftLabel="−10%" rightLabel="+10%"
      />,
    )
    expect(getByText('−10%')).toBeInTheDocument()
    expect(getByText('+10%')).toBeInTheDocument()
    const marker = container.querySelector('[data-role="marker"]') as HTMLElement
    expect(marker.style.left).toBe('60%')
    expect(marker.className).toContain('bg-status-success')
  })
})

describe('TwoStageGauge', () => {
  it('renders three zones and a marker', () => {
    const { container } = render(
      <TwoStageGauge
        model={{ markerPct: 16.9, amberStartPct: 50.5, redStartPct: 83.3, status: 'ok' }}
        leftLabel="0" midLabel="reduce" rightLabel="stop"
      />,
    )
    const marker = container.querySelector('[data-role="marker"]') as HTMLElement
    expect(marker.style.left).toBe('16.9%')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test LimitGauge`
Expected: FAIL — cannot find module `../LimitGauge`.

- [ ] **Step 3: Write the implementation**

Create `src/features/clientPortal/risk/LimitGauge.tsx`:
```tsx
import type { GaugeModel, TwoStageModel, LimitStatus } from './gauge'

const MARKER_COLOR: Record<LimitStatus, string> = {
  ok: 'bg-status-success', near: 'bg-status-warning', breach: 'bg-status-danger',
}

function Marker({ pct, status }: { pct: number; status: LimitStatus }) {
  return (
    <span
      data-role="marker"
      className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg-canvas ${MARKER_COLOR[status]}`}
      style={{ left: `${pct}%` }}
    />
  )
}

export function LimitGauge({ model, status, leftLabel, rightLabel, floorTick }: {
  model: GaugeModel; status: LimitStatus; leftLabel: React.ReactNode; rightLabel: React.ReactNode; floorTick?: boolean
}) {
  return (
    <div className="mt-3">
      <div className="relative h-2 rounded-full bg-status-danger/15">
        <div className="absolute inset-y-0 rounded-full bg-status-success/20" style={{ left: `${model.safeStartPct}%`, width: `${model.safeWidthPct}%` }} />
        {floorTick && <span className="absolute -inset-y-1 w-px bg-status-danger/60" style={{ left: `${model.safeStartPct}%` }} />}
        {model.zeroPct != null && <span className="absolute -inset-y-1 w-px bg-border-default" style={{ left: `${model.zeroPct}%` }} />}
        <Marker pct={model.markerPct} status={status} />
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10.5px] text-text-tertiary">
        <span>{leftLabel}</span><span>{rightLabel}</span>
      </div>
    </div>
  )
}

export function TwoStageGauge({ model, leftLabel, midLabel, rightLabel }: {
  model: TwoStageModel; leftLabel: React.ReactNode; midLabel: React.ReactNode; rightLabel: React.ReactNode
}) {
  return (
    <div className="mt-3">
      <div className="relative h-2 rounded-full bg-status-success/20">
        <div className="absolute inset-y-0 bg-status-warning/25" style={{ left: `${model.amberStartPct}%`, width: `${model.redStartPct - model.amberStartPct}%` }} />
        <div className="absolute inset-y-0 rounded-r-full bg-status-danger/20" style={{ left: `${model.redStartPct}%`, right: 0 }} />
        <span className="absolute -inset-y-1 w-px bg-status-warning" style={{ left: `${model.amberStartPct}%` }} />
        <span className="absolute -inset-y-1 w-px bg-status-danger" style={{ left: `${model.redStartPct}%` }} />
        <Marker pct={model.markerPct} status={model.status} />
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10.5px] text-text-tertiary">
        <span>{leftLabel}</span><span className="text-status-warning">{midLabel}</span><span className="text-status-danger">{rightLabel}</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test LimitGauge`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/risk/LimitGauge.tsx src/features/clientPortal/risk/__tests__/LimitGauge.test.tsx
git commit -m "feat(risk): add LimitGauge + two-stage gauge components"
```

---

### Task 5: StressMatrix component

**Files:**
- Create: `src/features/clientPortal/risk/StressMatrix.tsx`
- Test: `src/features/clientPortal/risk/__tests__/StressMatrix.test.tsx`

**Interfaces:**
- Consumes: `STRESS_SCENARIO`, `SPOT_SHOCKS`, `IV_SHOCKS`, `worstCell` from `./stress`.
- Produces: `StressMatrix(props: { grid?: number[][] }): JSX.Element` — a 3×3 table (spot rows × IV cols) of PnL % values, the worst cell highlighted (`data-role="worst"`), positive values greened.

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/risk/__tests__/StressMatrix.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { StressMatrix } from '../StressMatrix'

describe('StressMatrix', () => {
  it('renders the grid and highlights the worst cell', () => {
    const { container, getByText } = render(<StressMatrix />)
    expect(getByText('IV −20%')).toBeInTheDocument()
    expect(getByText('spot +10%')).toBeInTheDocument()
    const worst = container.querySelector('[data-role="worst"]') as HTMLElement
    expect(worst.textContent).toContain('-3.4')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test StressMatrix`
Expected: FAIL — cannot find module `../StressMatrix`.

- [ ] **Step 3: Write the implementation**

Create `src/features/clientPortal/risk/StressMatrix.tsx`:
```tsx
import { STRESS_SCENARIO, SPOT_SHOCKS, IV_SHOCKS, worstCell } from './stress'

const fmt = (n: number) => (n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1))
const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`)

export function StressMatrix({ grid = STRESS_SCENARIO }: { grid?: number[][] }) {
  const worst = worstCell(grid)
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="border-collapse font-mono text-xs">
        <caption className="pb-2 text-left font-sans text-[11px] text-text-tertiary">
          Worst loss across ±10% spot × ±20% parallel IV shift (PnL as % of TVL)
        </caption>
        <thead>
          <tr>
            <th className="px-3.5 py-1.5 text-left text-[10px] text-text-tertiary">spot ╲ IV</th>
            {IV_SHOCKS.map((iv) => (
              <th key={iv} className="px-3.5 py-1.5 text-[10.5px] font-semibold text-text-tertiary whitespace-nowrap">IV {sign(iv)}%</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, r) => (
            <tr key={SPOT_SHOCKS[r]}>
              <th className="px-3.5 py-2 text-left text-[10.5px] font-semibold text-text-tertiary whitespace-nowrap">spot {sign(SPOT_SHOCKS[r])}%</th>
              {row.map((v, c) => {
                const isWorst = r === worst.row && c === worst.col
                return (
                  <td
                    key={c}
                    data-role={isWorst ? 'worst' : undefined}
                    className={`border border-border-default px-3.5 py-2 text-center tabular-nums ${
                      isWorst ? 'bg-status-danger/15 font-bold text-status-danger shadow-[inset_0_0_0_1px_var(--color-status-danger)]'
                      : v > 0 ? 'text-status-success' : 'text-text-secondary'
                    }`}
                  >
                    {fmt(v)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test StressMatrix`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/risk/StressMatrix.tsx src/features/clientPortal/risk/__tests__/StressMatrix.test.tsx
git commit -m "feat(risk): add stress scenario matrix component"
```

---

### Task 6: RiskPage

**Files:**
- Create: `src/features/clientPortal/risk/RiskPage.tsx`
- Test: `src/features/clientPortal/risk/__tests__/RiskPage.test.tsx`

**Interfaces:**
- Consumes: `RiskLimits`, `ILLUSTRATIVE_READINGS`, `activeDeltaBand`, `DEFAULT_RISK_LIMITS` from `./riskLimits`; `paddedDomain`, `rangeGauge`, `bandStatus`, `capStatus`, `twoStageGauge` from `./gauge`; `LimitGauge`, `TwoStageGauge` from `./LimitGauge`; `StressMatrix` from `./StressMatrix`; `Button` from `@/components/ui/Button`.
- Produces: `RiskPage(props: { limits: RiskLimits; onApply: (next: RiskLimits) => void }): JSX.Element`
  - Holds a `draft` (`useState(limits)`), re-seeded when `limits` changes.
  - Gauges/statuses render from the **applied** `limits` + `ILLUSTRATIVE_READINGS`.
  - Editable numeric bounds edit the draft; a per-card **Apply** button calls `onApply(draft)`.
  - Shows the TVL definition note and an "on breach → rebalance" chip on the Greek card; the drawdown row uses `TwoStageGauge`.

- [ ] **Step 1: Write the failing test**

Create `src/features/clientPortal/risk/__tests__/RiskPage.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RiskPage } from '../RiskPage'
import { DEFAULT_RISK_LIMITS } from '../riskLimits'

describe('RiskPage', () => {
  it('renders the limit cards, TVL note, and stress matrix', () => {
    render(<RiskPage limits={DEFAULT_RISK_LIMITS} onApply={() => {}} />)
    expect(screen.getByRole('heading', { name: /risk & deployment/i })).toBeInTheDocument()
    expect(screen.getByText(/total value locked/i)).toBeInTheDocument()
    expect(screen.getByText('Delta Cash')).toBeInTheDocument()
    expect(screen.getByText('Gamma Cash')).toBeInTheDocument()
    expect(screen.getByText(/on breach/i)).toBeInTheDocument()
    expect(screen.getByText(/spot \+10%/i)).toBeInTheDocument()
  })

  it('edits a bound and applies the updated draft', async () => {
    const onApply = vi.fn()
    render(<RiskPage limits={DEFAULT_RISK_LIMITS} onApply={onApply} />)
    const capital = screen.getByLabelText(/capital allocation/i)
    await userEvent.clear(capital)
    await userEvent.type(capital, '0.05')
    await userEvent.click(screen.getByRole('button', { name: /apply deployment/i }))
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply.mock.calls[0][0].capitalTvlBtc).toBeCloseTo(0.05)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test RiskPage`
Expected: FAIL — cannot find module `../RiskPage`.

- [ ] **Step 3: Write the implementation**

Create `src/features/clientPortal/risk/RiskPage.tsx`:
```tsx
import React from 'react'
import { Button } from '@/components/ui/Button'
import { type RiskLimits, ILLUSTRATIVE_READINGS, activeDeltaBand } from './riskLimits'
import { paddedDomain, rangeGauge, bandStatus, capStatus, twoStageGauge } from './gauge'
import { LimitGauge, TwoStageGauge } from './LimitGauge'
import { StressMatrix } from './StressMatrix'

const pctFmt = (n: number) => `${n > 0 ? '+' : ''}${n}%`

function Card({ title, sub, right, children, onApply, applyLabel }: {
  title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode; onApply: () => void; applyLabel: string
}) {
  return (
    <section className="rounded-2xl border border-border-default bg-bg-surface-1">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-5 pt-4">
        <span className="type-subhead font-semibold text-text-primary">{title}</span>
        {sub && <span className="type-caption text-text-tertiary">· {sub}</span>}
        {right && <span className="ml-auto">{right}</span>}
      </div>
      <div className="px-5 pb-2 pt-1">{children}</div>
      <div className="flex items-center gap-3 border-t border-border-default px-5 py-3">
        <span className="font-mono text-[11.5px] text-text-tertiary">client-set · not advised by the software</span>
        <div className="ml-auto"><Button size="sm" variant="primary" onClick={onApply}>{applyLabel}</Button></div>
      </div>
    </section>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="border-t border-border-default py-3.5 first:border-t-0">{children}</div>
}

function BoundInput({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (n: number) => void; step?: number }) {
  return (
    <label className="flex items-center gap-1.5 font-mono text-[11.5px] text-text-tertiary">
      {label}
      <input
        type="number" step={step} value={value} aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 rounded-md border border-border-default bg-bg-surface-2 px-2 py-1 text-right text-text-primary tabular-nums outline-none focus:border-accent-500/50"
      />
    </label>
  )
}

const STATUS_TEXT = { ok: 'text-status-success', near: 'text-status-warning', breach: 'text-status-danger' } as const

function Reading({ value, status }: { value: number; status: 'ok' | 'near' | 'breach' }) {
  return (
    <span className="ml-auto flex items-center gap-2">
      <span className="text-[10.5px] uppercase tracking-wide text-text-tertiary">now</span>
      <span className={`font-mono text-[13.5px] font-bold tabular-nums ${STATUS_TEXT[status]}`}>{pctFmt(value)}</span>
    </span>
  )
}

export function RiskPage({ limits, onApply }: { limits: RiskLimits; onApply: (next: RiskLimits) => void }) {
  const [draft, setDraft] = React.useState<RiskLimits>(limits)
  React.useEffect(() => setDraft(limits), [limits])
  const r = ILLUSTRATIVE_READINGS
  const patch = (p: Partial<RiskLimits>) => setDraft((d) => ({ ...d, ...p }))
  const apply = () => onApply(draft)

  // Applied-limit gauges
  const { band: dBand, regime } = activeDeltaBand(limits, r)
  const dDom = paddedDomain(dBand.min, dBand.max)
  const gDom = paddedDomain(limits.gammaFloor, limits.gammaCap)
  const vDom = paddedDomain(limits.vega.min, limits.vega.max)
  const tHi = Math.abs(limits.thetaFloor)
  const tDom = paddedDomain(limits.thetaFloor, tHi)
  const ndDom: [number, number] = [0, limits.netDeltaMaxPct * 1.3]

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="type-title-l font-bold text-text-primary">Risk &amp; deployment</h1>
          <span className="rounded-full bg-bg-surface-2 px-2.5 py-1 type-caption text-text-tertiary">You set every value</span>
        </div>
        <p className="mt-1 type-subhead text-text-secondary">The limits the software operates within — you define each value; nothing here is suggested by the software.</p>
      </div>

      <div className="flex flex-col gap-2.5 rounded-2xl border border-border-default bg-bg-surface-1 p-4 type-caption text-text-secondary">
        <p><strong className="text-text-primary">TVL — Total Value Locked.</strong> The capital you allocated to this strategy ({limits.capitalTvlBtc} BTC). Every Greek, stress and delta limit is a percentage of it.</p>
        <p><strong className="text-text-primary">On breach.</strong> Greek, stress &amp; net-delta limits trigger automatic <strong className="text-text-primary">rebalancing</strong> back within range; the drawdown stop is staged — <span className="text-status-warning">reduce risk</span>, then <span className="text-status-danger">stop &amp; close</span>.</p>
      </div>

      {/* Deployment */}
      <Card title="Deployment" sub="capital &amp; scheduling" onApply={apply} applyLabel="Apply deployment">
        <Row>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="type-subhead text-text-primary">Capital allocation (TVL)</span>
            <BoundInput label="Capital allocation (BTC)" value={draft.capitalTvlBtc} step={0.001} onChange={(n) => patch({ capitalTvlBtc: n })} />
          </div>
        </Row>
        <Row>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="type-subhead text-text-primary">Max concurrent structures</span>
            <BoundInput label="Max concurrent structures" value={draft.maxConcurrent} onChange={(n) => patch({ maxConcurrent: n })} />
          </div>
        </Row>
        <Row>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="type-subhead text-text-primary">Expiry window (DTE)</span>
            <div className="flex gap-2">
              <BoundInput label="Min DTE" value={draft.expiryMinDte} onChange={(n) => patch({ expiryMinDte: n })} />
              <BoundInput label="Max DTE" value={draft.expiryMaxDte} onChange={(n) => patch({ expiryMaxDte: n })} />
            </div>
          </div>
        </Row>
      </Card>

      {/* Greek limits */}
      <Card title="Greek exposure limits" sub="% of TVL · live values illustrative" onApply={apply} applyLabel="Apply greek limits"
        right={<span className="rounded-full bg-status-info/15 px-2.5 py-1 text-[10.5px] font-semibold text-status-info">on breach → rebalance</span>}>
        {/* Delta */}
        <Row>
          <div className="flex flex-wrap items-center gap-2">
            <span className="type-subhead font-semibold text-text-primary">Delta Cash</span>
            <span className="font-mono text-[11px] text-text-secondary">band depends on Γ regime</span>
            <Reading value={r.deltaPct} status={bandStatus(r.deltaPct, dBand.min, dBand.max)} />
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2 font-mono text-[11px]">
            <span className={`rounded-lg border px-2.5 py-1 ${regime === 'long' ? 'border-accent-500/40 bg-accent-500/15 text-accent-400' : 'border-border-default text-text-tertiary'}`}>Γ &gt; 0 → ±60%</span>
            <span className={`rounded-lg border px-2.5 py-1 ${regime === 'short' ? 'border-accent-500/40 bg-accent-500/15 text-accent-400' : 'border-border-default text-text-tertiary'}`}>Γ &lt; 0 → ±10% · active</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <BoundInput label="Γ<0 min" value={draft.deltaShortGamma.min} onChange={(n) => patch({ deltaShortGamma: { ...draft.deltaShortGamma, min: n } })} />
            <BoundInput label="Γ<0 max" value={draft.deltaShortGamma.max} onChange={(n) => patch({ deltaShortGamma: { ...draft.deltaShortGamma, max: n } })} />
          </div>
          <LimitGauge model={rangeGauge(r.deltaPct, dDom[0], dDom[1], dBand.min, dBand.max)} status={bandStatus(r.deltaPct, dBand.min, dBand.max)} leftLabel={`${dBand.min}%`} rightLabel={`+${dBand.max}%`} />
        </Row>
        {/* Gamma */}
        <Row>
          <div className="flex flex-wrap items-center gap-2">
            <span className="type-subhead font-semibold text-text-primary">Gamma Cash <span className="font-normal text-text-tertiary">(per 1% move)</span></span>
            <span className="font-mono text-[11px] text-text-secondary">−10% &lt; Γ% &lt; 0%</span>
            <Reading value={r.gammaPct} status={bandStatus(r.gammaPct, limits.gammaFloor, limits.gammaCap)} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <BoundInput label="Γ floor" value={draft.gammaFloor} onChange={(n) => patch({ gammaFloor: n })} />
            <BoundInput label="Γ cap" value={draft.gammaCap} onChange={(n) => patch({ gammaCap: n })} />
          </div>
          <LimitGauge floorTick model={rangeGauge(r.gammaPct, gDom[0], gDom[1], limits.gammaFloor, limits.gammaCap)} status={bandStatus(r.gammaPct, limits.gammaFloor, limits.gammaCap)} leftLabel={<span className="text-status-danger">{limits.gammaFloor}% floor</span>} rightLabel={`${limits.gammaCap}% cap`} />
        </Row>
        {/* Vega */}
        <Row>
          <div className="flex flex-wrap items-center gap-2">
            <span className="type-subhead font-semibold text-text-primary">Vega Cash <span className="font-normal text-text-tertiary">(per 1% IV)</span></span>
            <span className="font-mono text-[11px] text-text-secondary">−0.5% &lt; V% &lt; +0.5%</span>
            <Reading value={r.vegaPct} status={bandStatus(r.vegaPct, limits.vega.min, limits.vega.max)} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <BoundInput label="V min" value={draft.vega.min} step={0.1} onChange={(n) => patch({ vega: { ...draft.vega, min: n } })} />
            <BoundInput label="V max" value={draft.vega.max} step={0.1} onChange={(n) => patch({ vega: { ...draft.vega, max: n } })} />
          </div>
          <LimitGauge model={rangeGauge(r.vegaPct, vDom[0], vDom[1], limits.vega.min, limits.vega.max)} status={bandStatus(r.vegaPct, limits.vega.min, limits.vega.max)} leftLabel={`${limits.vega.min}%`} rightLabel={`+${limits.vega.max}%`} />
        </Row>
        {/* Theta */}
        <Row>
          <div className="flex flex-wrap items-center gap-2">
            <span className="type-subhead font-semibold text-text-primary">Theta Cash</span>
            <span className="font-mono text-[11px] text-text-secondary">−2% &lt; Θ%</span>
            <Reading value={r.thetaPct} status={bandStatus(r.thetaPct, limits.thetaFloor, tHi)} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <BoundInput label="Θ floor" value={draft.thetaFloor} onChange={(n) => patch({ thetaFloor: n })} />
          </div>
          <LimitGauge floorTick model={rangeGauge(r.thetaPct, tDom[0], tDom[1], limits.thetaFloor, tHi)} status={bandStatus(r.thetaPct, limits.thetaFloor, tHi)} leftLabel={<span className="text-status-danger">{limits.thetaFloor}% floor</span>} rightLabel={`+${tHi}%`} />
        </Row>
      </Card>

      {/* Stress & aggregate */}
      <Card title="Stress &amp; aggregate limits" sub="% of TVL" onApply={apply} applyLabel="Apply stress limits">
        <Row>
          <div className="flex flex-wrap items-center gap-2">
            <span className="type-subhead font-semibold text-text-primary">Stress loss</span>
            <span className="font-mono text-[11px] text-text-secondary">≤ {limits.stressLossMaxPct}% TVL</span>
            <Reading value={-r.stressWorstPct} status={capStatus(r.stressWorstPct, limits.stressLossMaxPct)} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <BoundInput label="Stress loss max" value={draft.stressLossMaxPct} onChange={(n) => patch({ stressLossMaxPct: n })} />
          </div>
          <StressMatrix />
          <p className="mt-2.5 font-sans type-caption text-text-tertiary">Worst-case loss <strong className="text-text-primary">{r.stressWorstPct}%</strong> · limit <strong className="text-text-primary">{limits.stressLossMaxPct}%</strong>.</p>
        </Row>
        <Row>
          <div className="flex flex-wrap items-center gap-2">
            <span className="type-subhead font-semibold text-text-primary">Net delta (absolute)</span>
            <span className="font-mono text-[11px] text-text-secondary">|Δ| ≤ {limits.netDeltaMaxPct}% TVL</span>
            <Reading value={r.netDeltaPct} status={capStatus(r.netDeltaPct, limits.netDeltaMaxPct)} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <BoundInput label="Net delta cap" value={draft.netDeltaMaxPct} onChange={(n) => patch({ netDeltaMaxPct: n })} />
          </div>
          <LimitGauge floorTick model={rangeGauge(r.netDeltaPct, ndDom[0], ndDom[1], 0, limits.netDeltaMaxPct)} status={capStatus(r.netDeltaPct, limits.netDeltaMaxPct)} leftLabel="0" rightLabel={<span className="text-status-danger">{limits.netDeltaMaxPct}% cap</span>} />
        </Row>
        <Row>
          <div className="flex flex-wrap items-center gap-2">
            <span className="type-subhead font-semibold text-text-primary">Drawdown stop <span className="font-normal text-text-tertiary">(two-stage)</span></span>
            <Reading value={r.drawdownPct} status={twoStageGauge(r.drawdownPct, limits.drawdownReducePct, limits.drawdownStopPct, limits.drawdownStopPct * 1.2).status} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <BoundInput label="Reduce %" value={draft.drawdownReducePct} onChange={(n) => patch({ drawdownReducePct: n })} />
            <BoundInput label="Stop %" value={draft.drawdownStopPct} onChange={(n) => patch({ drawdownStopPct: n })} />
          </div>
          <TwoStageGauge model={twoStageGauge(r.drawdownPct, limits.drawdownReducePct, limits.drawdownStopPct, limits.drawdownStopPct * 1.2)} leftLabel="0" midLabel={`reduce · ${limits.drawdownReducePct}%`} rightLabel={`stop & close · ${limits.drawdownStopPct}%`} />
        </Row>
      </Card>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test RiskPage`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/features/clientPortal/risk/RiskPage.tsx src/features/clientPortal/risk/__tests__/RiskPage.test.tsx
git commit -m "feat(risk): add Risk & deployment page with editable limits + gauges"
```

---

### Task 7: Wire RiskPage into the shell (stateful setup status)

**Files:**
- Modify: `src/features/clientPortal/ClientPortalShell.tsx`
- Modify: `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`

**Interfaces:**
- Consumes: `RiskPage` from `./risk/RiskPage`; `DEFAULT_RISK_LIMITS`, `type RiskLimits` from `./risk/riskLimits`; `type SetupStatus`, `EMPTY_SETUP_STATUS` from `./setupStatus`.
- Behavior: `setupStatus` and `riskLimits` become shell `useState`. The `risk` page renders `<RiskPage limits={riskLimits} onApply={...} />`; applying sets `riskLimits` and flips `setupStatus.riskLimits = true` (so the sidebar Risk check and the activation gate respond). Dashboard/Positions branch unchanged.

- [ ] **Step 1: Write the failing test additions**

In `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`, keep the existing tests and add (the `useClientPositions` mock is already set up in the file; reuse it):
```tsx
it('renders the Risk page and flips the risk setup status on apply', async () => {
  const { default: userEvent } = await import('@testing-library/user-event')
  render(<ClientPortalShell clientName="TwoPrime" program="Obsidian Core" hash="#/portal/risk" onSignOut={() => {}} />)
  expect(screen.getByRole('heading', { name: /risk & deployment/i })).toBeInTheDocument()
  // Risk sidebar item shows the amber "attention" dot before applying (no check)
  await userEvent.click(screen.getAllByRole('button', { name: /apply deployment/i })[0])
  // After applying, the activation control's outstanding list no longer includes "Risk limits"
  const activate = screen.getByRole('button', { name: /activate/i })
  expect(activate.getAttribute('title') ?? '').not.toMatch(/risk limits/i)
})
```
> Note: `userEvent` may already be imported at the top of the file from earlier tasks — if so, use that import instead of the dynamic import shown here, and don't duplicate it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test ClientPortalShell`
Expected: FAIL — the risk heading isn't rendered yet (still the placeholder), so the new test fails.

- [ ] **Step 3: Update the shell**

In `src/features/clientPortal/ClientPortalShell.tsx`:
1. Add imports:
```tsx
import { RiskPage } from './risk/RiskPage'
import { DEFAULT_RISK_LIMITS, type RiskLimits } from './risk/riskLimits'
import { EMPTY_SETUP_STATUS, type SetupStatus } from './setupStatus'
```
(remove the old `import { EMPTY_SETUP_STATUS } from './setupStatus'` line — it's replaced by the line above.)
2. Replace `const setupStatus = EMPTY_SETUP_STATUS` with:
```tsx
  const [setupStatus, setSetupStatus] = React.useState<SetupStatus>(EMPTY_SETUP_STATUS)
  const [riskLimits, setRiskLimits] = React.useState<RiskLimits>(DEFAULT_RISK_LIMITS)
  const applyRiskLimits = React.useCallback((next: RiskLimits) => {
    setRiskLimits(next)
    setSetupStatus((s) => ({ ...s, riskLimits: true }))
  }, [])
```
3. Change the main content branch so `risk` is a data-less page rendered directly. Replace the outer conditional's structure with:
```tsx
          {page === 'risk' ? (
            <RiskPage limits={riskLimits} onApply={applyRiskLimits} />
          ) : (page === 'dashboard' || page === 'positions') ? (
            error ? (
              <div className="rounded-2xl border border-status-danger/30 bg-status-danger/10 p-6 text-center">
                <p className="type-subhead text-status-danger">Could not load your positions.</p>
                <p className="mt-1 type-caption text-text-secondary">{error}</p>
                <div className="mt-4"><Button variant="secondary" size="sm" onClick={reload}>Retry</Button></div>
              </div>
            ) : loading ? (
              <div className="grid place-items-center py-20"><Spinner className="h-6 w-6" /></div>
            ) : page === 'positions' ? (
              <PositionsPage positions={positions} onModify={(id) => console.debug('modify', id)} onClose={(id) => console.debug('close', id)} />
            ) : (
              <DashboardPage positions={positions} setupStatus={setupStatus} onNavigate={navigate} />
            )
          ) : (
            <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-8 text-center type-subhead text-text-secondary">
              {PAGE_TITLES[page]} — coming in a later phase.
            </div>
          )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test ClientPortalShell`
Expected: PASS — the 3 prior tests plus the new risk test.

- [ ] **Step 5: Full typecheck, test, build**

Run: `pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: no type errors; all tests pass; build succeeds.

- [ ] **Step 6: Manual verification in the preview**

Start the dev server (`.claude/launch.json`), sign in as the client, open `#/portal/risk`. Confirm: three cards render; gauges show markers (gamma amber/near, stress amber/near, others green); the stress matrix highlights the −3.4 cell; editing capital + Apply works; after applying, the sidebar **Risk & deployment** item shows a green check and the activation control's tooltip no longer lists "Risk limits".

- [ ] **Step 7: Commit**

```bash
git add src/features/clientPortal/ClientPortalShell.tsx src/features/clientPortal/__tests__/ClientPortalShell.test.tsx
git commit -m "feat(risk): wire Risk page into shell with stateful setup status"
```

---

## Self-Review

**Spec coverage (spec §8):**
- TVL definition note → Task 6. ✓
- Deployment params (capital/concurrent/expiry) → Task 6 Deployment card. ✓
- Delta Cash regime-dependent band (±60 Γ>0 / ±10 Γ<0), active regime highlighted → Tasks 1 (`activeDeltaBand`) + 6. ✓
- Gamma two-sided floor + default-0 cap → Tasks 1 + 6. ✓
- Vega band, Theta floor → Tasks 1 + 6. ✓
- Live value gauges with status color (near/ok/breach) → Tasks 2 (`bandStatus`/`capStatus`) + 4 + 6. ✓
- Stress 5% + ±10% spot × ±20% IV matrix, worst cell → Tasks 3 + 5 + 6. ✓
- Net delta 10% absolute → Tasks 2 (`capStatus`) + 6. ✓
- Two-stage drawdown (reduce → stop & close) → Tasks 2 (`twoStageGauge`) + 4 + 6. ✓
- Breach-behavior indicators (rebalance vs staged) → Task 6 note + chip. ✓
- Editable, client-set bounds + Apply → Task 6. ✓
- Apply flips `riskLimits` precondition → activation gate/sidebar respond → Task 7. ✓

**Deferred (correctly out of this slice):** Supabase persistence of limits, real greek-engine live readings (placeholders used), per-strategy defaults selection beyond the single Weekend Vol template, audit entries on save. Tracked for Phase 3.

**Placeholder scan:** No "TBD"/vague steps — every code step is complete. The `ILLUSTRATIVE_READINGS` constant is a deliberate, documented placeholder (Global Constraints + Task 1 comment), not a plan gap.

**Type consistency:** `RiskLimits`, `Band`, `GreekReadings`, `GaugeModel`, `TwoStageModel`, `LimitStatus`, `activeDeltaBand`, `paddedDomain`, `rangeGauge`, `bandStatus`, `capStatus`, `twoStageGauge`, `worstCell`, `headroomPct`, `LimitGauge`, `TwoStageGauge`, `StressMatrix`, `RiskPage` are defined once and consumed with matching signatures across tasks. Task 7 consumes `RiskPage`/`DEFAULT_RISK_LIMITS`/`SetupStatus` exactly as Tasks 1/6 define them.

**Design-token check:** all component classes use real tokens (status-*, accent-*, text-text-*, border-border-*, bg-bg-surface-1/2, bg-bg-canvas); no `bg-bg-surface-0`. The one raw-value use is `shadow-[inset_0_0_0_1px_var(--color-status-danger)]` in StressMatrix, which references the real token CSS var (matches the mockup's worst-cell outline) — acceptable.
