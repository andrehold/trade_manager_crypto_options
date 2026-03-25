import React from 'react'
import { type Position, type MarksMap, daysTo } from '../utils'
import { GanttBar } from './GanttBar'
import { fmtExpiryShort, stackBars } from './ganttUtils'

export interface GanttTimelineProps {
  positions: Position[]
  marks: MarksMap
  expiries: string[]
  onCardClick?: (p: Position) => void
}

/**
 * Each expiry gets one equal-width column.
 * Bars sit on their real expiry column(s) but use negative margins to
 * visually bleed half-a-column into their neighbours — giving single-
 * expiry (vertical) structures more room without mis-aligning the grid.
 *
 * CSS trick: one column = 100% / N of the grid width.
 * Half a column expressed from the bar's own width is tricky because the
 * bar's 100% equals its *span* width.  Instead we use a CSS variable
 * `--col-w` set on the grid container that equals `100% / N`, and each
 * bar pulls `calc(var(--col-w) / 2)` negative margin on each side.
 */
export function GanttTimeline({ positions, marks, expiries, onCardClick }: GanttTimelineProps) {
  const today = React.useMemo(() => new Date().toISOString().slice(0, 10), [])

  const expiryIndexMap = React.useMemo(() => {
    const m = new Map<string, number>()
    expiries.forEach((exp, i) => m.set(exp, i))
    return m
  }, [expiries])

  const placed = React.useMemo(
    () => stackBars(positions, expiryIndexMap),
    [positions, expiryIndexMap],
  )

  const numRows = placed.length > 0 ? Math.max(...placed.map((b) => b.row)) + 1 : 0

  const todayColIndex = React.useMemo(() => {
    const idx = expiries.findIndex((e) => e >= today)
    return idx === -1 ? null : idx
  }, [expiries, today])

  const todayIsExpiry = todayColIndex !== null && expiries[todayColIndex] === today

  if (expiries.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="type-caption text-text-disabled">No expiries available</p>
      </div>
    )
  }

  const N = expiries.length

  return (
    <div className="overflow-x-auto overflow-y-visible">
      <div
        className="grid gap-y-1 relative"
        style={{
          gridTemplateColumns: `repeat(${N}, minmax(0, 1fr))`,
          gridTemplateRows: `auto${numRows > 0 ? ` repeat(${numRows}, auto)` : ''}`,
          // expose a single-column width as a CSS variable for bar bleed
          ['--col-w' as string]: `${100 / N}%`,
        }}
      >
        {/* ── Header row ──────────────────────────────────────────── */}
        {expiries.map((exp, i) => {
          const dte = daysTo(exp)
          const isToday = todayIsExpiry && i === todayColIndex
          return (
            <div
              key={exp}
              className={`
                flex flex-col items-center justify-center py-2 px-1
                border-b border-border-subtle
                ${isToday ? 'bg-accent-500/10 border-b-2 border-b-border-accent' : ''}
              `}
              style={{ gridColumn: i + 1, gridRow: 1 }}
            >
              <span className="type-caption font-medium text-text-secondary tabular-nums">
                {fmtExpiryShort(exp)}
              </span>
              <span className="type-micro text-text-disabled tabular-nums">
                {dte}d
              </span>
            </div>
          )
        })}

        {/* ── Today marker ────────────────────────────────────────── */}
        {todayColIndex !== null && !todayIsExpiry && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-border-accent opacity-60 pointer-events-none z-[1]"
            style={{
              gridColumn: todayColIndex + 1,
              gridRow: `1 / ${numRows + 2}`,
              justifySelf: 'start',
            }}
          />
        )}

        {/* ── Structure bars ──────────────────────────────────────── */}
        {/* Each bar bleeds half-a-column via negative margin.         */}
        {/* calc(var(--col-w) / 2) = half of one grid column.         */}
        {placed.map((bar) => {
          const canBleedLeft  = bar.colStart > 1
          const canBleedRight = bar.colEnd <= N  // colEnd is exclusive; max real = N+1

          return (
            <div
              key={bar.position.id}
              style={{
                gridColumn: `${bar.colStart} / ${bar.colEnd}`,
                gridRow: bar.row + 2,
                marginLeft:  canBleedLeft  ? 'calc(var(--col-w) / -2)' : undefined,
                marginRight: canBleedRight ? 'calc(var(--col-w) / -2)' : undefined,
              }}
              className="my-0.5 relative z-[2]"
            >
              <GanttBar
                position={bar.position}
                marks={marks}
                onClick={onCardClick}
              />
            </div>
          )
        })}

        {/* ── Empty state ─────────────────────────────────────────── */}
        {positions.length > 0 && placed.length === 0 && (
          <div
            className="flex items-center justify-center py-8"
            style={{ gridColumn: `1 / ${N + 1}`, gridRow: 2 }}
          >
            <p className="type-caption text-text-disabled">
              No structures match the current expiries
            </p>
          </div>
        )}
      </div>

      {positions.length === 0 && (
        <div className="flex items-center justify-center h-48">
          <p className="type-caption text-text-disabled">No structures</p>
        </div>
      )}
    </div>
  )
}
