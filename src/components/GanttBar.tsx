import React from 'react'
import { type Position, type MarksMap, positionUnrealizedPnL, calculatePnlPct, getLegMarkRef } from '../utils'
import { Surface, Badge } from './ui'
import { shortStrategy, classifyPnl, type PnlClass, pnlBgClass, pnlTextClass, pnlBorderClass } from './ganttUtils'

export interface GanttBarProps {
  position: Position
  marks: MarksMap
  onClick?: (p: Position) => void
  style?: React.CSSProperties
  className?: string
}

/** Format a single leg as "P55000" or "C100000" */
function legLabel(leg: { optionType: string; strike: number }): string {
  const t = leg.optionType === 'P' || leg.optionType === 'C' ? leg.optionType : '?'
  const s = Number.isFinite(leg.strike) ? String(leg.strike) : '?'
  return `${t}${s}`
}

export function GanttBar({ position: p, marks, onClick, style, className }: GanttBarProps) {
  const hasPnl = p.legs.some((leg) => {
    const ref = getLegMarkRef(p, leg)
    return ref && marks[ref.key]?.price != null
  })

  const unrealized = positionUnrealizedPnL(p, marks)
  const pnlPct = calculatePnlPct(unrealized, p.legs, p.netPremium)
  const cls = classifyPnl(pnlPct)

  const strategy = shortStrategy(p)
  const pnlDisplay = pnlPct != null ? `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%` : null
  const legsLine = p.legs.map((l) => legLabel(l)).join(' – ')

  return (
    <Surface
      variant="interactive"
      className={`
        rounded-xl !rounded-2xl-none
        ${pnlBgClass(cls)} ${pnlBorderClass(cls)}
        ${onClick ? 'cursor-pointer' : ''}
        ${className ?? ''}
      `}
      style={style}
      onClick={onClick ? () => onClick(p) : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') onClick(p) } : undefined}
    >
      <div className="flex flex-col gap-0.5 px-2.5 py-1.5">
        {/* Line 1: strategy short name + PnL chip */}
        <div className="flex items-center gap-2 min-h-[20px]">
          {strategy ? (
            <span className="type-caption font-semibold text-text-primary truncate">
              {strategy}
            </span>
          ) : null}

          <span className="flex-1" />

          {hasPnl && pnlDisplay ? (
            <Badge
              variant={cls === 'profit' ? 'success' : cls === 'loss' ? 'danger' : 'neutral'}
              className="flex-shrink-0 !text-micro font-semibold tabular-nums"
            >
              {pnlDisplay}
            </Badge>
          ) : (
            <span className="type-micro text-text-disabled flex-shrink-0">—</span>
          )}
        </div>

        {/* Line 2: legs breakdown */}
        {legsLine && (
          <span className="type-micro text-text-tertiary truncate" title={legsLine}>
            {legsLine}
          </span>
        )}
      </div>
    </Surface>
  )
}
