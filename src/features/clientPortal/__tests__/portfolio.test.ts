import { describe, it, expect } from 'vitest'
import { portfolioSummary, positionSummaryRows, legSummaryRows } from '../portfolio'
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
