import {
  positionUnrealizedPnL, positionGreeks,
  getLegMarkRef, legUnrealizedPnL, legGreekExposure, daysTo,
  toDeribitInstrument, toCoincallSymbol,
  type Position, type Leg, type MarksMap,
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

/** Venue-aware instrument name for a single leg, e.g. "BTC-31JUL26-54000-P". */
function legInstrument(p: Position, leg: Leg): string {
  const expiry = leg.expiry ?? p.expiryISO
  const exchange = leg.exchange ?? p.exchange
  if (exchange === 'coincall') return toCoincallSymbol(p.underlying, expiry, leg.strike, leg.optionType)
  return toDeribitInstrument(p.underlying, expiry, leg.strike, leg.optionType)
}

/** Credit convention: short legs (sign -1) collect premium, long legs pay it — sums to position.netPremium. */
function legNetPremium(leg: Leg): number {
  return (leg.openLots ?? []).reduce((acc, lot) => acc - lot.sign * lot.qty * lot.price, 0)
}

/** One row per individual option across all positions (a "position" from the client's view). */
export function legSummaryRows(positions: Position[], marks?: MarksMap): LegSummaryRow[] {
  const rows: LegSummaryRow[] = []
  for (const p of positions) {
    for (const leg of p.legs) {
      const expiry = leg.expiry ?? p.expiryISO
      const ref = marks ? getLegMarkRef(p, leg) : null
      const info = ref ? marks?.[ref.key] : undefined
      const multiplier = ref?.exchange === 'coincall' ? info?.multiplier : ref?.defaultMultiplier
      const unrealizedPnl = info?.price != null ? legUnrealizedPnL(leg, info.price, multiplier) : null
      const delta = info?.greeks?.delta != null ? legGreekExposure(leg, info.greeks.delta, multiplier) : null
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
    }
  }
  return rows
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
