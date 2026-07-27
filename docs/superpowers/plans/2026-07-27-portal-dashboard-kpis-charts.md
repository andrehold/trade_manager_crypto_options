# Portal Dashboard — Expanded KPIs & Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand `/portal/dashboard` with a Portfolio Greeks strip, an Initial-Margin-utilization card, an equity chart, a PnL chart, and one chart per greek — denomination-aware and driven by illustrative data behind clean interfaces.

**Architecture:** Pure TS modules (series generation, denomination config, illustrative margin model, greek display mapping) carry all the logic and get the bulk of the tests. Thin React components (GreeksStrip, MarginUsageCard, chart wrappers) render them and get smoke tests. `DashboardPage` composes them in order: KPIs → Greeks → Margin → Performance charts → Greek charts → Setup status. The existing KPI tiles and Setup-status markup stay inline in `DashboardPage` unchanged.

**Tech Stack:** React 18 + TypeScript, Vite, Tailwind v4 semantic tokens, Recharts (new), Vitest + Testing Library.

## Global Constraints

- Package manager is **pnpm**. Test runner: `pnpm test` (`vitest run`).
- Path alias `@/*` maps to `src/*`. Import shared code via `@/…`.
- **Denomination rules (verbatim from spec):** Equity, Net PnL, PnL %, Delta, Gamma → **deposit asset** (from `PortfolioSummary.asset`, e.g. BTC). Vega, Theta → **USD**. Margin Balance, IM, MM, Available → **venue margin currency** (illustrative `USDC`).
- Margin usage is the headline of the Margin card; the **IM-utilization %** is a normal metric size, never larger than a KPI value. The absolute amounts are second-tier.
- **No raw hex or zinc/slate colors in components** — use semantic Tailwind token classes (`text-text-primary`, `bg-bg-surface-1`, `border-border-default`, `text-status-success`, `text-accent-400`, etc.). The single exception is `chartTheme.ts`, which holds hex values Recharts requires.
- Illustrative data must be **deterministic** (seeded), so tests and the UI are stable.
- TDD: write the failing test first. Commit after each green task.

## File Structure

```
src/features/clientPortal/
  dashboard/
    denomination.ts       — DashboardDenomination + denominationFor(summary)
    marginModel.ts        — utilizationZone(), illustrativeMargin()
    greeksDisplay.ts      — greekDisplays(summary, denom)
    series.ts             — SeriesPoint, buildSeries(), equity/pnl/greek series builders
    chartTheme.ts         — CHART_COLORS hex constants (Recharts only)
    __tests__/            — unit tests for the four logic modules
  components/
    GreeksStrip.tsx       — Δ Γ V Θ tiles
    MarginUsageCard.tsx   — IM-utilization gauge + amounts stat list
    charts/
      AreaChart.tsx       — reusable themed Recharts area chart
      EquityChart.tsx     — equity curve (deposit asset)
      PnlChart.tsx        — cumulative PnL (zero baseline)
      GreekCharts.tsx     — four small-multiple panels
    __tests__/            — smoke/render tests for the components
  pages/
    DashboardPage.tsx     — MODIFIED: compose the new sections in order
```

---

### Task 1: Add Recharts dependency

**Files:**
- Modify: `package.json` (dependencies)

- [ ] **Step 1: Add the dependency**

Run: `pnpm add recharts@^2.12.7`
Expected: `package.json` gains `"recharts": "^2.12.7"` under dependencies; `pnpm-lock.yaml` updates.

- [ ] **Step 2: Verify the build still type-checks**

Run: `pnpm build`
Expected: build completes without errors.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: add recharts for portal dashboard charts"
```

---

### Task 2: Illustrative time-series module (`series.ts`)

**Files:**
- Create: `src/features/clientPortal/dashboard/series.ts`
- Test: `src/features/clientPortal/dashboard/__tests__/series.test.ts`

**Interfaces:**
- Consumes: `PortfolioSummary` from `../portfolio`.
- Produces:
  - `type SeriesPoint = { t: string; v: number }`
  - `function buildSeries(seed: number, opts: { start: number; drift: number; vol: number; points?: number; endValue?: number }): SeriesPoint[]`
  - `function equitySeries(summary: PortfolioSummary): SeriesPoint[]`
  - `function pnlSeries(summary: PortfolioSummary): SeriesPoint[]`
  - `function greekSeries(key: 'delta' | 'gamma' | 'vega' | 'theta', endValue: number): SeriesPoint[]`

- [ ] **Step 1: Write the failing test**

```typescript
// src/features/clientPortal/dashboard/__tests__/series.test.ts
import { describe, it, expect } from 'vitest'
import { buildSeries, equitySeries } from '../series'
import type { PortfolioSummary } from '../../portfolio'

const summary = (over: Partial<PortfolioSummary> = {}): PortfolioSummary => ({
  totalEquity: 0.0262, totalPnl: 0.0081, totalRealized: 0.0063, pnlPct: 30.92,
  delta: 0.0135, gamma: 0.00021, theta: -0.000038, vega: 0.000124, hasAnyMarks: true,
  programName: 'Obsidian Core', exchange: 'deribit', asset: 'BTC', ...over,
})

describe('buildSeries', () => {
  it('is deterministic for a given seed', () => {
    const a = buildSeries(11, { start: 1, drift: 0.1, vol: 0.5 })
    const b = buildSeries(11, { start: 1, drift: 0.1, vol: 0.5 })
    expect(a).toEqual(b)
  })
  it('produces `points` points and pins the last value to endValue', () => {
    const s = buildSeries(3, { start: 0, drift: 1, vol: 2, points: 30, endValue: 42 })
    expect(s).toHaveLength(30)
    expect(s[29].v).toBe(42)
    expect(typeof s[0].t).toBe('string')
  })
})

describe('equitySeries', () => {
  it('ends at the summary equity', () => {
    const s = equitySeries(summary())
    expect(s[s.length - 1].v).toBe(0.0262)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/clientPortal/dashboard/__tests__/series.test.ts`
Expected: FAIL — cannot find module `../series`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/features/clientPortal/dashboard/series.ts
import type { PortfolioSummary } from '../portfolio'

export type SeriesPoint = { t: string; v: number }

const DAYS = 30

function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}

function isoDaysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

export function buildSeries(
  seed: number,
  opts: { start: number; drift: number; vol: number; points?: number; endValue?: number },
): SeriesPoint[] {
  const points = opts.points ?? DAYS
  const rand = seeded(seed)
  const out: SeriesPoint[] = []
  let v = opts.start
  for (let i = 0; i < points; i++) {
    v += opts.drift + (rand() - 0.5) * opts.vol
    out.push({ t: isoDaysAgo(points - 1 - i), v })
  }
  if (opts.endValue != null && out.length > 0) out[out.length - 1].v = opts.endValue
  return out
}

export function equitySeries(summary: PortfolioSummary): SeriesPoint[] {
  const end = summary.totalEquity
  return buildSeries(11, { start: end * 0.77, drift: end * 0.008, vol: Math.abs(end) * 0.06 + 1e-9, endValue: end })
}

export function pnlSeries(summary: PortfolioSummary): SeriesPoint[] {
  const end = summary.totalPnl ?? 0
  return buildSeries(31, { start: end * 0.13, drift: end * 0.03, vol: Math.abs(end) * 0.28 + 1e-9, endValue: end })
}

export function greekSeries(
  key: 'delta' | 'gamma' | 'vega' | 'theta',
  endValue: number,
): SeriesPoint[] {
  const seeds = { delta: 41, gamma: 47, vega: 53, theta: 59 } as const
  const mag = Math.abs(endValue) || 1
  return buildSeries(seeds[key], { start: endValue * 0.6, drift: 0, vol: mag * 0.5, endValue })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/clientPortal/dashboard/__tests__/series.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/dashboard/series.ts src/features/clientPortal/dashboard/__tests__/series.test.ts
git commit -m "feat(portal): deterministic illustrative time-series for dashboard charts"
```

---

### Task 3: Denomination config + illustrative margin model

**Files:**
- Create: `src/features/clientPortal/dashboard/denomination.ts`
- Create: `src/features/clientPortal/dashboard/marginModel.ts`
- Test: `src/features/clientPortal/dashboard/__tests__/marginModel.test.ts`

**Interfaces:**
- Consumes: `PortfolioSummary` from `../portfolio`.
- Produces:
  - `type DashboardDenomination = { depositAsset: string; marginCcy: string; spotUsd: number }`
  - `function denominationFor(summary: PortfolioSummary): DashboardDenomination`
  - `type UtilizationZone = 'ok' | 'warn' | 'high'`
  - `function utilizationZone(u: number): UtilizationZone`
  - `type MarginUsage = { imUtilization: number; initialMargin: number; maintenanceMargin: number; marginBalance: number; available: number; ccy: string; zone: UtilizationZone }`
  - `function illustrativeMargin(summary: PortfolioSummary, denom: DashboardDenomination): MarginUsage`

- [ ] **Step 1: Write the failing test**

```typescript
// src/features/clientPortal/dashboard/__tests__/marginModel.test.ts
import { describe, it, expect } from 'vitest'
import { denominationFor } from '../denomination'
import { utilizationZone, illustrativeMargin } from '../marginModel'
import type { PortfolioSummary } from '../../portfolio'

const summary = (over: Partial<PortfolioSummary> = {}): PortfolioSummary => ({
  totalEquity: 0.0262, totalPnl: 0.0081, totalRealized: 0.0063, pnlPct: 30.92,
  delta: 0.0135, gamma: 0.00021, theta: -0.000038, vega: 0.000124, hasAnyMarks: true,
  programName: 'Obsidian Core', exchange: 'deribit', asset: 'BTC', ...over,
})

describe('denominationFor', () => {
  it('uses the summary asset as deposit asset and USDC margin currency', () => {
    const d = denominationFor(summary())
    expect(d.depositAsset).toBe('BTC')
    expect(d.marginCcy).toBe('USDC')
    expect(d.spotUsd).toBeGreaterThan(0)
  })
})

describe('utilizationZone', () => {
  it('bands utilization into ok / warn / high', () => {
    expect(utilizationZone(0.31)).toBe('ok')
    expect(utilizationZone(0.5)).toBe('ok')
    expect(utilizationZone(0.65)).toBe('warn')
    expect(utilizationZone(0.8)).toBe('warn')
    expect(utilizationZone(0.88)).toBe('high')
  })
})

describe('illustrativeMargin', () => {
  it('derives deterministic margin figures in the margin currency', () => {
    const d = denominationFor(summary())
    const m = illustrativeMargin(summary(), d)
    expect(m.ccy).toBe('USDC')
    expect(m.marginBalance).toBe(Math.round(0.0262 * d.spotUsd))
    expect(m.initialMargin).toBe(Math.round(m.marginBalance * m.imUtilization))
    expect(m.available).toBe(m.marginBalance - m.initialMargin)
    expect(m.maintenanceMargin).toBeLessThan(m.initialMargin)
    expect(m.zone).toBe('ok')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/clientPortal/dashboard/__tests__/marginModel.test.ts`
Expected: FAIL — cannot find module `../denomination`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/features/clientPortal/dashboard/denomination.ts
import type { PortfolioSummary } from '../portfolio'

export type DashboardDenomination = {
  depositAsset: string
  marginCcy: string
  spotUsd: number
}

// Illustrative constants for this phase. A later phase sources these from the
// account/venue feed. spotUsd converts deposit-asset amounts to cash figures.
const ILLUSTRATIVE_SPOT_USD = 100_000
const ILLUSTRATIVE_MARGIN_CCY = 'USDC'

export function denominationFor(summary: PortfolioSummary): DashboardDenomination {
  return {
    depositAsset: summary.asset || 'BTC',
    marginCcy: ILLUSTRATIVE_MARGIN_CCY,
    spotUsd: ILLUSTRATIVE_SPOT_USD,
  }
}
```

```typescript
// src/features/clientPortal/dashboard/marginModel.ts
import type { PortfolioSummary } from '../portfolio'
import type { DashboardDenomination } from './denomination'

export type UtilizationZone = 'ok' | 'warn' | 'high'

export function utilizationZone(u: number): UtilizationZone {
  if (u <= 0.5) return 'ok'
  if (u <= 0.8) return 'warn'
  return 'high'
}

export type MarginUsage = {
  imUtilization: number
  initialMargin: number
  maintenanceMargin: number
  marginBalance: number
  available: number
  ccy: string
  zone: UtilizationZone
}

// Illustrative IM utilization for this phase. Real feed replaces this.
const ILLUSTRATIVE_IM_UTILIZATION = 0.31
const MM_TO_IM_RATIO = 0.5

export function illustrativeMargin(
  summary: PortfolioSummary,
  denom: DashboardDenomination,
): MarginUsage {
  const marginBalance = Math.round(summary.totalEquity * denom.spotUsd)
  const imUtilization = ILLUSTRATIVE_IM_UTILIZATION
  const initialMargin = Math.round(marginBalance * imUtilization)
  const maintenanceMargin = Math.round(initialMargin * MM_TO_IM_RATIO)
  const available = marginBalance - initialMargin
  return {
    imUtilization,
    initialMargin,
    maintenanceMargin,
    marginBalance,
    available,
    ccy: denom.marginCcy,
    zone: utilizationZone(imUtilization),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/clientPortal/dashboard/__tests__/marginModel.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/dashboard/denomination.ts src/features/clientPortal/dashboard/marginModel.ts src/features/clientPortal/dashboard/__tests__/marginModel.test.ts
git commit -m "feat(portal): denomination config + illustrative margin model"
```

---

### Task 4: Greek display mapping (`greeksDisplay.ts`)

**Files:**
- Create: `src/features/clientPortal/dashboard/greeksDisplay.ts`
- Test: `src/features/clientPortal/dashboard/__tests__/greeksDisplay.test.ts`

**Interfaces:**
- Consumes: `PortfolioSummary`, `DashboardDenomination`.
- Produces:
  - `type GreekTone = 'accent' | 'sky' | 'amber' | 'rose'`
  - `type GreekKey = 'delta' | 'gamma' | 'vega' | 'theta'`
  - `type GreekDisplay = { key: GreekKey; label: string; symbol: string; value: number; unit: string; tone: GreekTone; digits: number }`
  - `function greekDisplays(summary: PortfolioSummary, denom: DashboardDenomination): GreekDisplay[]`

- [ ] **Step 1: Write the failing test**

```typescript
// src/features/clientPortal/dashboard/__tests__/greeksDisplay.test.ts
import { describe, it, expect } from 'vitest'
import { greekDisplays } from '../greeksDisplay'
import { denominationFor } from '../denomination'
import type { PortfolioSummary } from '../../portfolio'

const summary: PortfolioSummary = {
  totalEquity: 0.0262, totalPnl: 0.0081, totalRealized: 0.0063, pnlPct: 30.92,
  delta: 0.0135, gamma: 0.00021, theta: -0.000038, vega: 0.000124, hasAnyMarks: true,
  programName: 'Obsidian Core', exchange: 'deribit', asset: 'BTC',
}

describe('greekDisplays', () => {
  it('returns Δ Γ V Θ in order with correct denomination units', () => {
    const rows = greekDisplays(summary, denominationFor(summary))
    expect(rows.map(r => r.key)).toEqual(['delta', 'gamma', 'vega', 'theta'])
    const byKey = Object.fromEntries(rows.map(r => [r.key, r]))
    expect(byKey.delta.unit).toContain('BTC')
    expect(byKey.gamma.unit).toContain('BTC')
    expect(byKey.vega.unit).toContain('USD')
    expect(byKey.theta.unit).toContain('USD')
  })
  it('keeps delta/gamma in deposit asset and converts vega/theta to USD via spot', () => {
    const denom = denominationFor(summary)
    const byKey = Object.fromEntries(greekDisplays(summary, denom).map(r => [r.key, r]))
    expect(byKey.delta.value).toBe(0.0135)
    expect(byKey.vega.value).toBeCloseTo(0.000124 * denom.spotUsd, 6)
    expect(byKey.theta.value).toBeCloseTo(-0.000038 * denom.spotUsd, 6)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/clientPortal/dashboard/__tests__/greeksDisplay.test.ts`
Expected: FAIL — cannot find module `../greeksDisplay`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/features/clientPortal/dashboard/greeksDisplay.ts
import type { PortfolioSummary } from '../portfolio'
import type { DashboardDenomination } from './denomination'

export type GreekTone = 'accent' | 'sky' | 'amber' | 'rose'
export type GreekKey = 'delta' | 'gamma' | 'vega' | 'theta'
export type GreekDisplay = {
  key: GreekKey
  label: string
  symbol: string
  value: number
  unit: string
  tone: GreekTone
  digits: number
}

// Delta/Gamma report in the deposit asset; Vega/Theta report in USD (spot-converted).
export function greekDisplays(
  summary: PortfolioSummary,
  denom: DashboardDenomination,
): GreekDisplay[] {
  const asset = denom.depositAsset
  return [
    { key: 'delta', label: 'Delta', symbol: 'Δ', value: summary.delta, unit: `${asset} equivalent`, tone: 'accent', digits: 4 },
    { key: 'gamma', label: 'Gamma', symbol: 'Γ', value: summary.gamma, unit: `${asset} per 1% move`, tone: 'sky', digits: 5 },
    { key: 'vega', label: 'Vega', symbol: 'V', value: summary.vega * denom.spotUsd, unit: 'USD per vol pt', tone: 'amber', digits: 1 },
    { key: 'theta', label: 'Theta', symbol: 'Θ', value: summary.theta * denom.spotUsd, unit: 'USD per day', tone: 'rose', digits: 1 },
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/clientPortal/dashboard/__tests__/greeksDisplay.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/dashboard/greeksDisplay.ts src/features/clientPortal/dashboard/__tests__/greeksDisplay.test.ts
git commit -m "feat(portal): greek display mapping with per-greek denomination"
```

---

### Task 5: Chart theme constants + reusable `AreaChart`

**Files:**
- Create: `src/features/clientPortal/dashboard/chartTheme.ts`
- Create: `src/features/clientPortal/components/charts/AreaChart.tsx`
- Test: `src/features/clientPortal/components/__tests__/AreaChart.test.tsx`

**Interfaces:**
- Consumes: `SeriesPoint` from `../../dashboard/series`.
- Produces:
  - `const CHART_COLORS: { accent: string; good: string; danger: string; sky: string; amber: string; rose: string; grid: string; zero: string }`
  - `AreaChart` React component with props `{ data: SeriesPoint[]; color: string; height?: number; zeroBaseline?: boolean; formatValue: (v: number) => string; testId?: string }`

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/clientPortal/components/__tests__/AreaChart.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AreaChart } from '../charts/AreaChart'

// Recharts' ResponsiveContainer measures 0×0 in jsdom; give it a fixed size.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 200 }}>{children}</div>
    ),
  }
})

describe('AreaChart', () => {
  it('renders a container for the given series without throwing', () => {
    render(
      <AreaChart
        data={[{ t: '2026-07-01', v: 1 }, { t: '2026-07-02', v: 2 }]}
        color="#A16EFF"
        formatValue={(v) => String(v)}
        testId="area-chart"
      />,
    )
    expect(screen.getByTestId('area-chart')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/clientPortal/components/__tests__/AreaChart.test.tsx`
Expected: FAIL — cannot find module `../charts/AreaChart`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/features/clientPortal/dashboard/chartTheme.ts
// Hex constants live here (not in components) because Recharts needs literal colors.
// They mirror the portal semantic tokens.
export const CHART_COLORS = {
  accent: '#A16EFF',
  good: '#22C55E',
  danger: '#EF4444',
  sky: '#38BDF8',
  amber: '#FBBF24',
  rose: '#FB7185',
  grid: 'rgba(255,255,255,0.05)',
  zero: 'rgba(255,255,255,0.16)',
} as const
```

```tsx
// src/features/clientPortal/components/charts/AreaChart.tsx
import { useId } from 'react'
import {
  Area, AreaChart as RAreaChart, ResponsiveContainer,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'
import type { SeriesPoint } from '../../dashboard/series'
import { CHART_COLORS } from '../../dashboard/chartTheme'

type Props = {
  data: SeriesPoint[]
  color: string
  height?: number
  zeroBaseline?: boolean
  formatValue: (v: number) => string
  testId?: string
}

export function AreaChart({ data, color, height = 176, zeroBaseline, formatValue, testId }: Props) {
  const gid = useId().replace(/:/g, '')
  const crossesZero = zeroBaseline && data.some((d) => d.v < 0) && data.some((d) => d.v > 0)
  return (
    <div data-testid={testId} style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RAreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.32} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis dataKey="t" hide />
          <YAxis hide domain={zeroBaseline ? ['auto', 'auto'] : ['dataMin', 'dataMax']} />
          {crossesZero && <ReferenceLine y={0} stroke={CHART_COLORS.zero} strokeDasharray="3 3" />}
          <Tooltip
            cursor={{ stroke: 'rgba(255,255,255,0.28)' }}
            contentStyle={{ background: '#202029', border: '1px solid #1F2A3A', borderRadius: 9, fontSize: 12 }}
            labelStyle={{ color: '#8A8A98' }}
            formatter={(v: number) => [formatValue(v), '']}
          />
          <Area
            type="monotone" dataKey="v" stroke={color} strokeWidth={2}
            fill={`url(#${gid})`} dot={false}
            activeDot={{ r: 3.5, fill: color, stroke: '#101013', strokeWidth: 1.5 }}
          />
        </RAreaChart>
      </ResponsiveContainer>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/clientPortal/components/__tests__/AreaChart.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/dashboard/chartTheme.ts src/features/clientPortal/components/charts/AreaChart.tsx src/features/clientPortal/components/__tests__/AreaChart.test.tsx
git commit -m "feat(portal): themed reusable AreaChart wrapper for Recharts"
```

---

### Task 6: Equity, PnL, and per-greek chart components

**Files:**
- Create: `src/features/clientPortal/components/charts/EquityChart.tsx`
- Create: `src/features/clientPortal/components/charts/PnlChart.tsx`
- Create: `src/features/clientPortal/components/charts/GreekCharts.tsx`
- Test: `src/features/clientPortal/components/__tests__/dashboardCharts.test.tsx`

**Interfaces:**
- Consumes: `PortfolioSummary`, `DashboardDenomination`, `AreaChart`, `CHART_COLORS`, `equitySeries`/`pnlSeries`/`greekSeries`, `greekDisplays`, `fmtPremium`/`fmtNumber` from `@/utils`.
- Produces:
  - `EquityChart` props `{ summary: PortfolioSummary; denom: DashboardDenomination }`
  - `PnlChart` props `{ summary: PortfolioSummary; denom: DashboardDenomination }`
  - `GreekCharts` props `{ summary: PortfolioSummary; denom: DashboardDenomination }`

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/clientPortal/components/__tests__/dashboardCharts.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EquityChart } from '../charts/EquityChart'
import { PnlChart } from '../charts/PnlChart'
import { GreekCharts } from '../charts/GreekCharts'
import { denominationFor } from '../../dashboard/denomination'
import type { PortfolioSummary } from '../../portfolio'

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 200 }}>{children}</div>
    ),
  }
})

const summary: PortfolioSummary = {
  totalEquity: 0.0262, totalPnl: 0.0081, totalRealized: 0.0063, pnlPct: 30.92,
  delta: 0.0135, gamma: 0.00021, theta: -0.000038, vega: 0.000124, hasAnyMarks: true,
  programName: 'Obsidian Core', exchange: 'deribit', asset: 'BTC',
}

describe('dashboard charts', () => {
  const denom = denominationFor(summary)
  it('EquityChart renders titled equity panel', () => {
    render(<EquityChart summary={summary} denom={denom} />)
    expect(screen.getByText(/equity curve/i)).toBeInTheDocument()
    expect(screen.getByTestId('equity-chart')).toBeInTheDocument()
  })
  it('PnlChart renders titled PnL panel', () => {
    render(<PnlChart summary={summary} denom={denom} />)
    expect(screen.getByText(/cumulative pnl/i)).toBeInTheDocument()
    expect(screen.getByTestId('pnl-chart')).toBeInTheDocument()
  })
  it('GreekCharts renders one panel per greek', () => {
    render(<GreekCharts summary={summary} denom={denom} />)
    for (const name of ['Delta', 'Gamma', 'Vega', 'Theta']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    expect(screen.getByTestId('greek-chart-delta')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/clientPortal/components/__tests__/dashboardCharts.test.tsx`
Expected: FAIL — cannot find module `../charts/EquityChart`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/features/clientPortal/components/charts/EquityChart.tsx
import { fmtPremium } from '@/utils'
import type { PortfolioSummary } from '../../portfolio'
import type { DashboardDenomination } from '../../dashboard/denomination'
import { equitySeries } from '../../dashboard/series'
import { CHART_COLORS } from '../../dashboard/chartTheme'
import { AreaChart } from './AreaChart'

export function EquityChart({ summary, denom }: { summary: PortfolioSummary; denom: DashboardDenomination }) {
  return (
    <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-4">
      <div className="type-caption font-semibold text-text-secondary">Equity Curve</div>
      <div className="mt-1 type-title-l font-bold text-text-primary">{fmtPremium(summary.totalEquity, denom.depositAsset)}</div>
      <div className="mt-0.5 type-caption text-text-tertiary">Account equity in deposit asset, marked to live prices</div>
      <AreaChart
        data={equitySeries(summary)} color={CHART_COLORS.accent}
        formatValue={(v) => fmtPremium(v, denom.depositAsset)} testId="equity-chart"
      />
    </div>
  )
}
```

```tsx
// src/features/clientPortal/components/charts/PnlChart.tsx
import { fmtPremium } from '@/utils'
import type { PortfolioSummary } from '../../portfolio'
import type { DashboardDenomination } from '../../dashboard/denomination'
import { pnlSeries } from '../../dashboard/series'
import { CHART_COLORS } from '../../dashboard/chartTheme'
import { AreaChart } from './AreaChart'

export function PnlChart({ summary, denom }: { summary: PortfolioSummary; denom: DashboardDenomination }) {
  const pnl = summary.totalPnl ?? 0
  const color = pnl < 0 ? CHART_COLORS.danger : CHART_COLORS.good
  return (
    <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-4">
      <div className="type-caption font-semibold text-text-secondary">Cumulative PnL</div>
      <div className={`mt-1 type-title-l font-bold ${pnl < 0 ? 'text-status-danger' : 'text-status-success'}`}>
        {fmtPremium(pnl, denom.depositAsset)}
      </div>
      <div className="mt-0.5 type-caption text-text-tertiary">Realized + unrealized, from inception baseline</div>
      <AreaChart
        data={pnlSeries(summary)} color={color} zeroBaseline
        formatValue={(v) => fmtPremium(v, denom.depositAsset)} testId="pnl-chart"
      />
    </div>
  )
}
```

```tsx
// src/features/clientPortal/components/charts/GreekCharts.tsx
import { fmtGreek, fmtNumber } from '@/utils'
import type { PortfolioSummary } from '../../portfolio'
import type { DashboardDenomination } from '../../dashboard/denomination'
import { greekDisplays, type GreekTone } from '../../dashboard/greeksDisplay'
import { greekSeries } from '../../dashboard/series'
import { CHART_COLORS } from '../../dashboard/chartTheme'
import { AreaChart } from './AreaChart'

const TONE_HEX: Record<GreekTone, string> = {
  accent: CHART_COLORS.accent, sky: CHART_COLORS.sky, amber: CHART_COLORS.amber, rose: CHART_COLORS.rose,
}
const SWATCH: Record<GreekTone, string> = {
  accent: 'bg-accent-400', sky: 'bg-sky-400', amber: 'bg-amber-400', rose: 'bg-rose-400',
}

function fmtGreekValue(value: number, digits: number): string {
  const sign = value < 0 ? '−' : '+'
  return `${sign}${fmtNumber(Math.abs(value))}` && (digits >= 4
    ? fmtGreek(value, digits)
    : `${value < 0 ? '−' : '+'}${fmtNumber(Math.abs(value))}`)
}

export function GreekCharts({ summary, denom }: { summary: PortfolioSummary; denom: DashboardDenomination }) {
  const rows = greekDisplays(summary, denom)
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {rows.map((g) => (
        <div key={g.key} className="rounded-2xl border border-border-default bg-bg-surface-1 p-3.5">
          <div className="flex items-center gap-2 type-caption font-semibold text-text-secondary">
            <span className={`inline-block h-2 w-2 rounded-sm ${SWATCH[g.tone]}`} />
            {g.label}
          </div>
          <div className={`mt-1.5 type-subhead font-bold ${g.value < 0 ? 'text-status-danger' : 'text-status-success'}`}>
            {fmtGreekValue(g.value, g.digits)} <span className="type-caption font-medium text-text-tertiary">{g.unit}</span>
          </div>
          <AreaChart
            data={greekSeries(g.key, g.value)} color={TONE_HEX[g.tone]} height={82}
            zeroBaseline={g.key === 'delta' || g.key === 'theta'}
            formatValue={(v) => fmtGreekValue(v, g.digits)} testId={`greek-chart-${g.key}`}
          />
        </div>
      ))}
    </div>
  )
}
```

> Note: replace the placeholder `fmtGreekValue` body above with the clean version in Step 3a below before running tests.

- [ ] **Step 3a: Simplify the value formatter**

Replace the `fmtGreekValue` function in `GreekCharts.tsx` with:

```tsx
function fmtGreekValue(value: number, digits: number): string {
  const sign = value < 0 ? '−' : '+'
  const abs = Math.abs(value)
  const body = digits >= 4 ? fmtGreek(abs, digits) : fmtNumber(abs)
  return `${sign}${body}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/clientPortal/components/__tests__/dashboardCharts.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/components/charts/EquityChart.tsx src/features/clientPortal/components/charts/PnlChart.tsx src/features/clientPortal/components/charts/GreekCharts.tsx src/features/clientPortal/components/__tests__/dashboardCharts.test.tsx
git commit -m "feat(portal): equity, PnL, and per-greek chart panels"
```

---

### Task 7: `GreeksStrip` component

**Files:**
- Create: `src/features/clientPortal/components/GreeksStrip.tsx`
- Test: `src/features/clientPortal/components/__tests__/GreeksStrip.test.tsx`

**Interfaces:**
- Consumes: `PortfolioSummary`, `DashboardDenomination`, `greekDisplays`, `fmtGreek`/`fmtNumber`.
- Produces: `GreeksStrip` props `{ summary: PortfolioSummary; denom: DashboardDenomination }`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/clientPortal/components/__tests__/GreeksStrip.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GreeksStrip } from '../GreeksStrip'
import { denominationFor } from '../../dashboard/denomination'
import type { PortfolioSummary } from '../../portfolio'

const summary: PortfolioSummary = {
  totalEquity: 0.0262, totalPnl: 0.0081, totalRealized: 0.0063, pnlPct: 30.92,
  delta: 0.0135, gamma: 0.00021, theta: -0.000038, vega: 0.000124, hasAnyMarks: true,
  programName: 'Obsidian Core', exchange: 'deribit', asset: 'BTC',
}

describe('GreeksStrip', () => {
  it('shows all four greeks with their denomination units', () => {
    render(<GreeksStrip summary={summary} denom={denominationFor(summary)} />)
    expect(screen.getByText('Delta')).toBeInTheDocument()
    expect(screen.getByText('Gamma')).toBeInTheDocument()
    expect(screen.getByText('Vega')).toBeInTheDocument()
    expect(screen.getByText('Theta')).toBeInTheDocument()
    expect(screen.getByText(/BTC equivalent/)).toBeInTheDocument()
    expect(screen.getAllByText(/USD per/).length).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/clientPortal/components/__tests__/GreeksStrip.test.tsx`
Expected: FAIL — cannot find module `../GreeksStrip`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/features/clientPortal/components/GreeksStrip.tsx
import { fmtGreek, fmtNumber } from '@/utils'
import type { PortfolioSummary } from '../portfolio'
import type { DashboardDenomination } from '../dashboard/denomination'
import { greekDisplays, type GreekTone } from '../dashboard/greeksDisplay'

const BADGE: Record<GreekTone, string> = {
  accent: 'bg-accent-400/15 text-accent-400',
  sky: 'bg-sky-400/15 text-sky-400',
  amber: 'bg-amber-400/15 text-amber-400',
  rose: 'bg-rose-400/15 text-rose-400',
}

function fmtValue(value: number, digits: number): string {
  const sign = value < 0 ? '−' : '+'
  const abs = Math.abs(value)
  return `${sign}${digits >= 4 ? fmtGreek(abs, digits) : fmtNumber(abs)}`
}

export function GreeksStrip({ summary, denom }: { summary: PortfolioSummary; denom: DashboardDenomination }) {
  const rows = greekDisplays(summary, denom)
  return (
    <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {rows.map((g) => (
          <div key={g.key} className="flex items-center gap-3">
            <div className={`grid h-9 w-9 flex-none place-items-center rounded-lg text-base font-bold ${BADGE[g.tone]}`}>
              {g.symbol}
            </div>
            <div className="min-w-0">
              <div className="type-caption uppercase tracking-wide text-text-tertiary">{g.label}</div>
              <div className={`type-subhead font-bold ${g.value < 0 ? 'text-status-danger' : 'text-status-success'}`}>
                {fmtValue(g.value, g.digits)}
              </div>
              <div className="type-caption text-text-tertiary">{g.unit}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/clientPortal/components/__tests__/GreeksStrip.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/components/GreeksStrip.tsx src/features/clientPortal/components/__tests__/GreeksStrip.test.tsx
git commit -m "feat(portal): portfolio greeks strip"
```

---

### Task 8: `MarginUsageCard` component

**Files:**
- Create: `src/features/clientPortal/components/MarginUsageCard.tsx`
- Test: `src/features/clientPortal/components/__tests__/MarginUsageCard.test.tsx`

**Interfaces:**
- Consumes: `MarginUsage`, `UtilizationZone` from `../dashboard/marginModel`.
- Produces: `MarginUsageCard` props `{ margin: MarginUsage }`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/clientPortal/components/__tests__/MarginUsageCard.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MarginUsageCard } from '../MarginUsageCard'
import type { MarginUsage } from '../../dashboard/marginModel'

const margin: MarginUsage = {
  imUtilization: 0.31, initialMargin: 818, maintenanceMargin: 406,
  marginBalance: 2620, available: 1802, ccy: 'USDC', zone: 'ok',
}

describe('MarginUsageCard', () => {
  it('leads with the IM utilization percent and lists the amounts in the margin currency', () => {
    render(<MarginUsageCard margin={margin} />)
    expect(screen.getByText('31%')).toBeInTheDocument()
    expect(screen.getByText(/Initial Margin/)).toBeInTheDocument()
    expect(screen.getByText(/2,620 USDC/)).toBeInTheDocument()
    expect(screen.getByText(/1,802 USDC/)).toBeInTheDocument()
  })
  it('reflects the utilization zone as a data attribute for styling', () => {
    render(<MarginUsageCard margin={{ ...margin, imUtilization: 0.88, zone: 'high' }} />)
    expect(screen.getByTestId('im-gauge')).toHaveAttribute('data-zone', 'high')
    expect(screen.getByText('88%')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/clientPortal/components/__tests__/MarginUsageCard.test.tsx`
Expected: FAIL — cannot find module `../MarginUsageCard`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/features/clientPortal/components/MarginUsageCard.tsx
import type { MarginUsage, UtilizationZone } from '../dashboard/marginModel'

const FILL: Record<UtilizationZone, string> = {
  ok: 'bg-status-success', warn: 'bg-amber-400', high: 'bg-status-danger',
}

function fmtCcy(n: number, ccy: string): string {
  return `${Math.round(n).toLocaleString('en-US')} ${ccy}`
}

export function MarginUsageCard({ margin }: { margin: MarginUsage }) {
  const pct = Math.round(margin.imUtilization * 100)
  const rows: { label: React.ReactNode; amount: number }[] = [
    { label: <>Initial Margin <span className="text-text-tertiary">(IM)</span></>, amount: margin.initialMargin },
    { label: <>Maintenance Margin <span className="text-text-tertiary">(MM)</span></>, amount: margin.maintenanceMargin },
    { label: 'Margin Balance', amount: margin.marginBalance },
    { label: 'Available', amount: margin.available },
  ]
  return (
    <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-5">
      <div className="grid gap-6 md:grid-cols-[1.4fr_1fr] md:items-center">
        <div>
          <div className="type-caption uppercase tracking-wide text-text-tertiary">Initial Margin Utilization</div>
          <div className={`mt-1.5 type-title-m font-bold ${margin.zone === 'high' ? 'text-status-danger' : 'text-text-primary'}`}>{pct}%</div>
          <div
            data-testid="im-gauge" data-zone={margin.zone}
            className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-bg-surface-3"
          >
            <div className={`h-full rounded-full ${FILL[margin.zone]}`} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <div className="mt-1.5 type-caption text-text-tertiary">
            {fmtCcy(margin.initialMargin, margin.ccy)} of {fmtCcy(margin.marginBalance, margin.ccy)} committed to initial margin
          </div>
        </div>
        <div className="flex flex-col">
          {rows.map((r, i) => (
            <div key={i} className="flex items-baseline justify-between border-b border-border-subtle py-2 last:border-0">
              <span className="type-caption text-text-secondary">{r.label}</span>
              <span className="type-caption font-semibold text-text-primary tabular-nums">{fmtCcy(r.amount, margin.ccy)}</span>
            </div>
          ))}
          <div className="mt-2 type-caption text-text-tertiary">Amounts in venue margin currency · second-tier to utilization</div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/clientPortal/components/__tests__/MarginUsageCard.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/clientPortal/components/MarginUsageCard.tsx src/features/clientPortal/components/__tests__/MarginUsageCard.test.tsx
git commit -m "feat(portal): IM-utilization margin usage card"
```

---

### Task 9: Compose the new sections into `DashboardPage`

**Files:**
- Modify: `src/features/clientPortal/pages/DashboardPage.tsx`
- Test: `src/features/clientPortal/pages/__tests__/DashboardPage.test.tsx`

**Interfaces:**
- Consumes: `portfolioSummary` (existing), `denominationFor`, `illustrativeMargin`, `GreeksStrip`, `MarginUsageCard`, `EquityChart`, `PnlChart`, `GreekCharts`.
- Produces: unchanged `DashboardPage` props — `{ positions, marks, setupStatus, onNavigate }`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/clientPortal/pages/__tests__/DashboardPage.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DashboardPage } from '../DashboardPage'
import { SAMPLE_POSITIONS, SAMPLE_MARKS } from '../../sampleData'
import { EMPTY_SETUP_STATUS } from '../../setupStatus'

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 200 }}>{children}</div>
    ),
  }
})

describe('DashboardPage', () => {
  it('renders the new sections in order: greeks before margin, then charts', () => {
    render(
      <DashboardPage
        positions={SAMPLE_POSITIONS} marks={SAMPLE_MARKS}
        setupStatus={EMPTY_SETUP_STATUS} onNavigate={() => {}}
      />,
    )
    expect(screen.getByText('Portfolio Greeks')).toBeInTheDocument()
    expect(screen.getByText('Margin Usage')).toBeInTheDocument()
    expect(screen.getByText('Performance')).toBeInTheDocument()
    expect(screen.getByTestId('equity-chart')).toBeInTheDocument()
    expect(screen.getByTestId('greek-chart-vega')).toBeInTheDocument()

    // Greeks section appears before Margin section in the DOM.
    const greeks = screen.getByText('Portfolio Greeks')
    const margin = screen.getByText('Margin Usage')
    expect(greeks.compareDocumentPosition(margin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the existing KPI tiles and setup status', () => {
    render(
      <DashboardPage
        positions={SAMPLE_POSITIONS} marks={SAMPLE_MARKS}
        setupStatus={EMPTY_SETUP_STATUS} onNavigate={() => {}}
      />,
    )
    expect(screen.getByText('Equity')).toBeInTheDocument()
    expect(screen.getByText('Open positions')).toBeInTheDocument()
    expect(screen.getByText('Setup status')).toBeInTheDocument()
    // No Margin Balance KPI tile — margin balance only appears inside the margin card.
    expect(screen.queryByText('Margin Balance')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/clientPortal/pages/__tests__/DashboardPage.test.tsx`
Expected: FAIL — new sections ("Portfolio Greeks", "Margin Usage", chart testids) not found.

- [ ] **Step 3: Write the implementation**

Replace the body of `DashboardPage.tsx` with the version below. The `Kpi` helper and `SETUP_LABELS` stay as they are today; only the returned JSX gains the new sections, and the imports grow.

```tsx
// src/features/clientPortal/pages/DashboardPage.tsx
import { Check, AlertCircle } from 'lucide-react'
import { fmtPremium, type Position, type MarksMap } from '@/utils'
import { portfolioSummary } from '../portfolio'
import { denominationFor } from '../dashboard/denomination'
import { illustrativeMargin } from '../dashboard/marginModel'
import { GreeksStrip } from '../components/GreeksStrip'
import { MarginUsageCard } from '../components/MarginUsageCard'
import { EquityChart } from '../components/charts/EquityChart'
import { PnlChart } from '../components/charts/PnlChart'
import { GreekCharts } from '../components/charts/GreekCharts'
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

function SectionHead({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="type-subhead font-semibold text-text-primary">{title}</h2>
      {meta && <span className="type-caption uppercase tracking-wide text-text-tertiary">{meta}</span>}
    </div>
  )
}

export function DashboardPage({ positions, marks, setupStatus, onNavigate }: {
  positions: Position[]; marks?: MarksMap; setupStatus: SetupStatus; onNavigate: (page: PortalPage) => void
}) {
  const s = portfolioSummary(positions, marks)
  const denom = denominationFor(s)
  const margin = illustrativeMargin(s, denom)
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

      <div className="flex flex-col gap-3">
        <SectionHead title="Portfolio Greeks" meta="live · net exposure" />
        <GreeksStrip summary={s} denom={denom} />
      </div>

      <div className="flex flex-col gap-3">
        <SectionHead title="Margin Usage" meta="initial margin utilization" />
        <MarginUsageCard margin={margin} />
      </div>

      <div className="flex flex-col gap-3">
        <SectionHead title="Performance" meta="last 30 days" />
        <div className="grid gap-3 md:grid-cols-2">
          <EquityChart summary={s} denom={denom} />
          <PnlChart summary={s} denom={denom} />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <SectionHead title="Greek Exposure Over Time" meta="one panel per greek · last 30 days" />
        <GreekCharts summary={s} denom={denom} />
      </div>

      <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-5">
        <div className="type-caption uppercase tracking-wide text-text-tertiary">Setup status</div>
        <div className="mt-3 flex flex-wrap gap-2.5">
          {SETUP_LABELS.map(({ key, label }) => {
            const done = setupStatus[key]
            return (
              <button key={key} type="button" onClick={() => onNavigate(key === 'tradingKey' ? 'keys' : key === 'riskLimits' ? 'risk' : key)} className="flex items-center gap-2 rounded-lg border border-border-default bg-bg-canvas px-3 py-2 type-caption text-text-secondary hover:bg-bg-surface-2">
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

Run: `pnpm test src/features/clientPortal/pages/__tests__/DashboardPage.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite and type-check**

Run: `pnpm test && pnpm build`
Expected: all tests pass; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/features/clientPortal/pages/DashboardPage.tsx src/features/clientPortal/pages/__tests__/DashboardPage.test.tsx
git commit -m "feat(portal): compose greeks, margin usage, and charts into dashboard"
```

---

### Task 10: Visual verification in the running app

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Use the Browser preview tooling (`preview_start` with the `.claude/launch.json` dev config), then open `#/portal/dashboard`.

- [ ] **Step 2: Confirm against the mockup**

Check: KPI row shows Equity / PnL / PnL % / Open positions (no Margin Balance tile); Portfolio Greeks appears above Margin Usage; the IM-utilization % is no larger than the KPI values; equity + PnL charts render side by side; four greek panels render; Setup status is last. Compare with the approved mockup: https://claude.ai/code/artifact/850bb3ea-9393-40a5-b2b9-d26b23397409

- [ ] **Step 3: Check the console**

Use `read_console_messages` — expect no errors (a Recharts width warning in dev is acceptable). Fix any real errors by returning to the relevant task.

---

## Self-Review

**Spec coverage:**
- Margin Balance amount → present in `MarginUsageCard` stat list (Task 8); no standalone KPI (Task 9 test asserts its absence). ✓
- Margin Usage (IM utilization headline + IM/MM) → Tasks 3, 8. ✓
- Portfolio Greeks (Δ/Γ deposit asset, V/Θ USD) → Tasks 4, 7. ✓
- Equity chart → Task 6. ✓
- PnL chart (zero baseline) → Task 6. ✓
- One chart per greek → Task 6 (`GreekCharts`). ✓
- Denomination-aware, illustrative, deterministic → Tasks 2–4. ✓
- Recharts, themed → Tasks 1, 5. ✓
- Section order (KPIs → Greeks → Margin → Performance → Greek charts → Setup) → Task 9. ✓
- Preserve Sample-data banner / title / Setup status → banner lives in `ClientPortalShell` (untouched); title + setup preserved in Task 9. ✓
- Empty/loading states → `ClientPortalShell` already gates loading/error and supplies sample data; `portfolioSummary` null-safety for marks is exercised by existing behavior. ✓

**Placeholder scan:** The only interim placeholder is the deliberately-flagged `fmtGreekValue` in Task 6 Step 3, immediately replaced in Step 3a. No `TBD`/`TODO`/"handle edge cases" remain.

**Type consistency:** `SeriesPoint`, `DashboardDenomination`, `MarginUsage`, `UtilizationZone`, `GreekDisplay`/`GreekTone` are defined once (Tasks 2–4) and imported unchanged by consumers (Tasks 5–9). `PortfolioSummary` shape used in test fixtures matches `src/features/clientPortal/portfolio.ts`. `denom`/`summary` prop names are consistent across all chart components and `DashboardPage`.
