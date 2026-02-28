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
  portfolioGreeks: {
    totals: Record<string, number>
    hasValues: Record<string, boolean>
  }
}

export function DashboardHeader({ title, portfolioGreeks }: Props) {
  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800 bg-zinc-950">
      {/* Left: nav arrows + page title */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => window.history.back()}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
            aria-label="Go back"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => window.history.forward()}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
            aria-label="Go forward"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <h1 className="text-base font-semibold text-zinc-100 tracking-tight">{title}</h1>
      </div>

      {/* Right: portfolio greeks (4 chips) */}
      <div className="flex items-center gap-1.5">
        {HEADER_GREEKS.map(({ key, symbol, label }) => {
          const value = portfolioGreeks.hasValues[key]
            ? fmtGreek(portfolioGreeks.totals[key])
            : '—'
          return (
            <div
              key={key}
              title={label}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800"
            >
              <span className="text-[11px] font-medium text-zinc-500">{symbol}</span>
              <span className="text-[11px] font-semibold text-zinc-200 tabular-nums">{value}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
