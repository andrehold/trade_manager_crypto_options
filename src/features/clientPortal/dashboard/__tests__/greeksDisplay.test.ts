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
