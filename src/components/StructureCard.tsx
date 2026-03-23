import React from 'react'
import { type Position, type MarksMap, positionUnrealizedPnL, fmtPremium, daysTo, getLegMarkRef } from '../utils'
import { Card, Badge } from './ui'

/* ── helpers ─────────────────────────────────────────────────────────── */

/** Format an ISO date string (e.g. "2026-03-27") as "27/03" */
function fmtExpiry(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}`
}

/** Build a short leg descriptor: "P55", "C78" */
function legLabel(leg: { optionType: string; strike: number }): string {
  const t = leg.optionType === 'P' || leg.optionType === 'C' ? leg.optionType : '?'
  // Drop trailing zeroes from strike (58000 → 58000, 55.5 → 55.5)
  const s = Number.isFinite(leg.strike) ? String(leg.strike) : '?'
  return `${t}${s}`
}

/**
 * Build the structure title shown on cards.
 *
 * Single expiry:    "27/03 — P58-P55"
 * Multiple expiries: "27/03–24/04 — P58-P55-C75-C78"
 */
export function structureTitle(p: Position): string {
  // Collect unique sorted expiries
  const expiries = Array.from(
    new Set(p.legs.map((l) => l.expiry).filter(Boolean) as string[]),
  ).sort()

  const expiryPart =
    expiries.length === 0
      ? ''
      : expiries.length === 1
        ? fmtExpiry(expiries[0])
        : `${fmtExpiry(expiries[0])}-${fmtExpiry(expiries[expiries.length - 1])}`

  const legsPart = p.legs
    .map((l) => legLabel(l))
    .join('-')

  if (!expiryPart) return legsPart || p.structureId || p.id
  if (!legsPart) return expiryPart
  return `${expiryPart} \u2014 ${legsPart}` // em-dash
}

/* ── component ───────────────────────────────────────────────────────── */

export interface StructureCardProps {
  position: Position
  marks: MarksMap
  onClick?: (p: Position) => void
  className?: string
}

export function StructureCard({ position: p, marks, onClick, className }: StructureCardProps) {
  const pnl = positionUnrealizedPnL(p, marks)
  const hasPnl = p.legs.some((leg) => {
    const ref = getLegMarkRef(p, leg)
    return ref && marks[ref.key]?.price != null
  })

  const minDte = p.legs.reduce<number | null>((min, leg) => {
    if (!leg.expiry) return min
    const d = daysTo(leg.expiry)
    return min === null ? d : Math.min(min, d)
  }, null)

  const title = structureTitle(p)

  return (
    <Card
      variant="kanban"
      className={`flex flex-col gap-2 hover:border-border-accent transition-colors ${onClick ? 'cursor-pointer' : ''} ${className ?? ''}`}
    >
      <div
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={onClick ? () => onClick(p) : undefined}
        onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(p) } : undefined}
        className="flex flex-col gap-2"
      >
        {/* Row 1: title + strategy badge */}
        <div className="flex items-start justify-between gap-2">
          <span className="type-subhead font-semibold text-text-primary truncate leading-snug" title={title}>
            {title}
          </span>
          {p.strategy ? (
            <Badge variant="neutral" className="flex-shrink-0 type-micro-sm uppercase tracking-wide whitespace-nowrap">
              {p.strategy}
            </Badge>
          ) : null}
        </div>

        {/* Row 2: PnL · DTE · leg count */}
        <div className="flex items-center gap-3 type-caption">
          {hasPnl ? (
            <span className={pnl >= 0 ? 'text-status-success font-semibold' : 'text-status-danger font-semibold'}>
              {pnl >= 0 ? '+' : ''}{fmtPremium(pnl, undefined, 4)}
            </span>
          ) : (
            <span className="text-text-disabled">no marks</span>
          )}

          {minDte !== null ? (
            <span className={`font-medium tabular-nums ${minDte <= 7 ? 'text-status-warning' : 'text-text-tertiary'}`}>
              {minDte}d
            </span>
          ) : null}

          <span className="text-text-disabled ml-auto">
            {p.legs.length} leg{p.legs.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </Card>
  )
}
