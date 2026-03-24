import React from 'react'
import type { Position, MarksMap, Leg, LegMarkRef } from '../utils'
import {
  getLegMarkRef,
  legUnrealizedPnL,
  legGreekExposure,
  fmtPremium,
  fmtGreek,
  fmtNumber,
  formatInstrumentLabel,
} from '../utils'
import { DataTable, type Column } from './ui'

type LegPositionsTableProps = {
  position: Position
  marks?: MarksMap
  markLoading?: boolean
}

function CellSpinner() {
  return (
    <svg className="animate-spin h-4 w-4 inline-block text-faint" viewBox="0 0 24 24">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  )
}

const fmtFourDecimals = (value: number) =>
  value.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })

type LegRow = {
  leg: Leg
  ref: LegMarkRef | null
  markInfo: MarksMap[string] | undefined
  instrument: string
  hasGreeks: boolean
  delta: number
  gamma: number
  theta: number
  vega: number
  unrealized: React.ReactNode
  netPremiumPerLot: number | null
  underlying: string
}

export function LegPositionsTable({ position: p, marks, markLoading }: LegPositionsTableProps) {
  const rows = React.useMemo<LegRow[]>(() => {
    return p.legs.map((leg) => {
      const ref = getLegMarkRef(p, leg)
      const markInfo = ref ? marks?.[ref.key] : undefined
      const markPrice = markInfo?.price ?? null
      const greeks = markInfo?.greeks
      const multiplier = ref?.exchange === 'coincall' ? markInfo?.multiplier : ref?.defaultMultiplier

      const totalAbsQty = leg.trades.reduce((sum, t) => sum + Math.abs(t.amount ?? 0), 0)
      const premiumBasisQty = leg.netPremiumBasisQty ?? totalAbsQty
      const netPremiumPerLot = premiumBasisQty > 0 ? leg.netPremium / premiumBasisQty : null

      const hasGreeks = Boolean(greeks && ref)

      let unrealized: React.ReactNode = '—'
      if (!ref) {
        unrealized = '—'
      } else if (markPrice == null) {
        unrealized = markLoading ? <CellSpinner /> : '—'
      } else {
        const u = legUnrealizedPnL(leg, markPrice, multiplier)
        unrealized = (
          <span className={u < 0 ? 'text-status-danger' : 'text-status-success'}>
            {fmtPremium(u, p.underlying, 4)}
          </span>
        )
      }

      const instrument = ref?.symbol
        ? ref.symbol
        : formatInstrumentLabel(p.underlying, leg.expiry ?? p.expiryISO, leg.strike, leg.optionType)

      return {
        leg,
        ref,
        markInfo,
        instrument,
        hasGreeks,
        delta: legGreekExposure(leg, greeks?.delta ?? undefined, multiplier),
        gamma: legGreekExposure(leg, greeks?.gamma ?? undefined, multiplier),
        theta: legGreekExposure(leg, greeks?.theta ?? undefined, multiplier),
        vega: legGreekExposure(leg, greeks?.vega ?? undefined, multiplier),
        unrealized,
        netPremiumPerLot,
        underlying: p.underlying,
      }
    })
  }, [p, marks, markLoading])

  const columns = React.useMemo<Column<LegRow>[]>(() => [
    { key: 'leg', header: 'Leg', render: (r) => r.instrument },
    { key: 'qty', header: 'Net Qty', align: 'right', render: (r) => fmtFourDecimals(r.leg.qtyNet) },
    { key: 'delta', header: 'Δ', headerAbbr: 'Delta', align: 'right', render: (r) => r.hasGreeks ? fmtNumber(r.delta) : '—' },
    { key: 'gamma', header: 'Γ', headerAbbr: 'Gamma', align: 'right', render: (r) => r.hasGreeks ? fmtGreek(r.gamma, 6) : '—' },
    { key: 'theta', header: 'Θ', headerAbbr: 'Theta', align: 'right', render: (r) => r.hasGreeks ? fmtNumber(r.theta) : '—' },
    { key: 'vega', header: 'V', headerAbbr: 'Vega', align: 'right', render: (r) => r.hasGreeks ? fmtNumber(r.vega) : '—' },
    {
      key: 'realizedPnl', header: 'Realized PnL', align: 'right',
      render: (r) => (
        <span className={r.leg.realizedPnl < 0 ? 'text-status-danger' : 'text-status-success'}>
          {fmtPremium(r.leg.realizedPnl, r.underlying, 4)}
        </span>
      ),
    },
    { key: 'upnl', header: 'uPnL', align: 'right', render: (r) => r.unrealized },
    {
      key: 'premium', header: 'Net Prem / Lot', align: 'right',
      render: (r) => r.netPremiumPerLot != null ? fmtPremium(r.netPremiumPerLot, r.underlying, 4) : '—',
    },
    {
      key: 'fee', header: 'Fee', align: 'right',
      render: (r) => r.leg.fees != null ? fmtPremium(r.leg.fees, r.underlying, 4) : '—',
    },
  ], [])

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(r) => r.leg.key}
        emptyMessage="No positions."
      />
      <div className="mt-2 type-micro text-text-disabled leading-snug">
        uPnL sums each open lot as (mark − entry price) × signed qty × multiplier. Fully offset legs report 0 to avoid
        mark noise when net size is flat.
      </div>
    </>
  )
}
