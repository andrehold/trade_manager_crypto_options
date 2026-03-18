import React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fmtGreek } from '../utils'

const HEADER_GREEKS = [
  { key: 'delta', symbol: 'Δ', label: 'Delta' },
  { key: 'gamma', symbol: 'Γ', label: 'Gamma' },
  { key: 'vega',  symbol: 'V', label: 'Vega'  },
  { key: 'theta', symbol: 'Θ', label: 'Theta' },
] as const

type HeaderGreekKey = typeof HEADER_GREEKS[number]['key']

type Props = {
  title: string
  clientName?: string
  portfolioGreeks: {
    totals: Record<string, number>
    hasValues: Record<string, boolean>
  }
}

export function DashboardHeader({ title, clientName, portfolioGreeks }: Props) {
  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-default bg-surface-page">
      {/* Left: nav arrows + page title */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => window.history.back()}
            className="p-1.5 rounded-lg text-muted hover:text-strong hover:bg-surface-card transition-colors"
            aria-label="Go back"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => window.history.forward()}
            className="p-1.5 rounded-lg text-muted hover:text-strong hover:bg-surface-card transition-colors"
            aria-label="Go forward"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <h1 className="type-headline font-semibold text-heading tracking-tight">{title}</h1>
      </div>

      {/* Right: client name + portfolio greeks (4 chips) */}
      <div className="flex items-center gap-1.5">
        {clientName && (
          <>
            <div className="flex items-center px-2.5 py-1.5 rounded-lg bg-surface-section border border-default">
              <span className="text-[11px] font-semibold text-strong tracking-wide">{clientName}</span>
            </div>
            <div className="w-px h-4 bg-border-default mx-1" />
          </>
        )}
        {HEADER_GREEKS.map(({ key, symbol, label }) => {
          const value = portfolioGreeks.hasValues[key]
            ? fmtGreek(portfolioGreeks.totals[key])
            : '—'
          return (
            <div
              key={key}
              title={label}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-section border border-default"
            >
              <span className="text-[11px] font-medium text-muted">{symbol}</span>
              <span className="text-[11px] font-semibold text-strong tabular-nums">{value}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
