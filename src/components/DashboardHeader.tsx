import React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fmtGreek } from '../utils'
import { IconButton, Chip } from './ui'

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
    <div className="flex items-center justify-between px-6 py-[18px] border-b border-border-default bg-bg-canvas">
      {/* Left: nav arrows + page title */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-0.5">
          <IconButton
            variant="ghost"
            size={32}
            icon={<ChevronLeft className="w-4 h-4" />}
            aria-label="Go back"
            onClick={() => window.history.back()}
          />
          <IconButton
            variant="ghost"
            size={32}
            icon={<ChevronRight className="w-4 h-4" />}
            aria-label="Go forward"
            onClick={() => window.history.forward()}
          />
        </div>
        <h1 className="type-headline font-semibold text-text-primary tracking-tight">{title}</h1>
      </div>

      {/* Right: client name + portfolio greeks (4 chips) */}
      <div className="flex items-center gap-1.5">
        {clientName && (
          <>
            <Chip variant="tag" className="text-[11px] font-semibold">{clientName}</Chip>
            <div className="w-px h-4 bg-border-default mx-1" />
          </>
        )}
        {HEADER_GREEKS.map(({ key, symbol, label }) => {
          const value = portfolioGreeks.hasValues[key]
            ? fmtGreek(portfolioGreeks.totals[key])
            : '—'
          return (
            <Chip key={key} variant="tag" className="gap-1.5">
              <span className="text-[11px] font-medium text-text-tertiary">{symbol}</span>
              <span className="text-[11px] font-semibold text-text-primary tabular-nums">{value}</span>
            </Chip>
          )
        })}
      </div>
    </div>
  )
}
