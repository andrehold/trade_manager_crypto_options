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
