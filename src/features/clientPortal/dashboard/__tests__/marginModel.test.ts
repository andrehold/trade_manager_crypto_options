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
