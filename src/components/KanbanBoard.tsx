import React from 'react'
import { type Position, type MarksMap, positionUnrealizedPnL, fmtPremium, daysTo, getLegMarkRef } from '../utils'
import { Card, Badge } from './ui'

type LaneId = 'new' | 'nearProfit' | 'nearLoss' | 'nearDTE'

const LANES: {
  id: LaneId
  label: string
  accent: string
  headerBg: string
  border: string
  countVariant: 'neutral' | 'success' | 'danger' | 'warning'
}[] = [
  {
    id: 'new',
    label: 'New',
    accent: 'text-text-primary',
    headerBg: 'bg-bg-surface-2',
    border: 'border-border-strong',
    countVariant: 'neutral',
  },
  {
    id: 'nearProfit',
    label: 'Near Profit',
    accent: 'text-status-success',
    headerBg: 'bg-status-success-bg',
    border: 'border-status-success-border',
    countVariant: 'success',
  },
  {
    id: 'nearLoss',
    label: 'Near Loss',
    accent: 'text-status-danger',
    headerBg: 'bg-status-danger-bg',
    border: 'border-status-danger-border',
    countVariant: 'danger',
  },
  {
    id: 'nearDTE',
    label: 'Near DTE',
    accent: 'text-status-warning',
    headerBg: 'bg-status-warning-bg',
    border: 'border-status-warning-border',
    countVariant: 'warning',
  },
]


function classifyPosition(p: Position, marks: MarksMap): LaneId {
  // Near DTE takes priority
  const hasNearDTE = p.legs.some((leg) => {
    if (!leg.expiry) return false
    const dte = daysTo(leg.expiry)
    return dte <= 7
  })
  if (hasNearDTE) return 'nearDTE'

  const pnl = positionUnrealizedPnL(p, marks)
  if (pnl > 0) return 'nearProfit'
  if (pnl < 0) return 'nearLoss'
  return 'new'
}

function KanbanCard({ p, marks }: { p: Position; marks: MarksMap }) {
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

  return (
    <Card variant="kanban" className="flex flex-col gap-2 hover:border-border-accent transition-colors">
      <div className="flex items-start justify-between gap-2">
        <span className="type-subhead font-semibold text-text-primary truncate leading-snug">
          {p.structureId ?? p.id}
        </span>
        {p.strategy ? (
          <Badge variant="neutral" className="flex-shrink-0 text-[10px] uppercase tracking-wide">
            {p.strategy}
          </Badge>
        ) : null}
      </div>

      <div className="flex items-center gap-3 type-caption">
        {hasPnl ? (
          <span className={pnl >= 0 ? 'text-status-success font-semibold' : 'text-status-danger font-semibold'}>
            {pnl >= 0 ? '+' : ''}{fmtPremium(pnl)}
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
    </Card>
  )
}

type Props = {
  positions: Position[]
  marks: MarksMap
}

export function KanbanBoard({ positions, marks }: Props) {
  const lanes = React.useMemo(() => {
    const buckets: Record<LaneId, Position[]> = {
      new: [],
      nearProfit: [],
      nearLoss: [],
      nearDTE: [],
    }
    for (const p of positions) {
      const lane = classifyPosition(p, marks)
      buckets[lane].push(p)
    }
    return buckets
  }, [positions, marks])

  return (
    <div className="grid grid-cols-4 gap-3 p-4 min-h-[400px]">
      {LANES.map(({ id, label, accent, headerBg, border, countVariant }) => (
        <div
          key={id}
          className={`flex flex-col rounded-xl border ${border} overflow-hidden`}
        >
          {/* Lane header */}
          <div className={`${headerBg} px-3 py-2.5 flex items-center justify-between flex-shrink-0`}>
            <span className={`type-subhead font-semibold ${accent}`}>{label}</span>
            <Badge variant={countVariant}>{lanes[id].length}</Badge>
          </div>

          {/* Cards */}
          <div className="flex flex-col gap-2 p-2 overflow-y-auto flex-1">
            {lanes[id].length === 0 ? (
              <p className="type-caption text-text-disabled text-center py-6">No structures</p>
            ) : (
              lanes[id].map((p) => <KanbanCard key={p.id} p={p} marks={marks} />)
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
