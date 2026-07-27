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
