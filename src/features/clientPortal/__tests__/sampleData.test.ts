import { describe, it, expect } from 'vitest'
import { SAMPLE_POSITIONS, SAMPLE_MARKS } from '../sampleData'
import { portfolioSummary, positionSummaryRows } from '../portfolio'

describe('sample data', () => {
  it('provides several live (non-expired) open positions', () => {
    expect(SAMPLE_POSITIONS.length).toBeGreaterThanOrEqual(3)
    for (const p of SAMPLE_POSITIONS) {
      expect(p.dte).toBeGreaterThan(0) // future expiry so marks apply
      expect(p.underlying).toBe('BTC')
    }
  })

  it('has marks keyed so portfolioSummary reports live PnL and greeks', () => {
    const s = portfolioSummary(SAMPLE_POSITIONS, SAMPLE_MARKS)
    expect(s.hasAnyMarks).toBe(true)
    expect(s.totalPnl).not.toBeNull()
    expect(s.pnlPct).not.toBeNull()
    expect(s.totalEquity).toBeGreaterThan(0)
    // Premium-selling condor profile: short gamma, positive theta.
    expect(s.gamma).toBeLessThan(0)
    expect(s.theta).toBeGreaterThan(0)
  })

  it('populates per-position rows with unrealized PnL and delta', () => {
    const rows = positionSummaryRows(SAMPLE_POSITIONS, SAMPLE_MARKS)
    expect(rows).toHaveLength(SAMPLE_POSITIONS.length)
    expect(rows[0].unrealizedPnl).not.toBeNull()
    expect(rows[0].delta).not.toBeNull()
  })
})
