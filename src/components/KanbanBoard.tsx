import React from 'react'
import { type Position, positionUnrealizedPnL, fmtPremium, daysTo, getLegMarkRef } from '../utils'

type LaneId = 'new' | 'nearProfit' | 'nearLoss' | 'nearDTE'

const LANES: {
  id: LaneId
  label: string
  accent: string
  headerBg: string
  border: string
  countBg: string
}[] = [
  {
    id: 'new',
    label: 'New',
    accent: 'text-zinc-200',
    headerBg: 'bg-zinc-800/60',
    border: 'border-zinc-700',
    countBg: 'bg-zinc-700 text-zinc-300',
  },
  {
    id: 'nearProfit',
    label: 'Near Profit',
    accent: 'text-emerald-400',
    headerBg: 'bg-emerald-950/60',
    border: 'border-emerald-800/60',
    countBg: 'bg-emerald-900/80 text-emerald-300',
  },
  {
    id: 'nearLoss',
    label: 'Near Loss',
    accent: 'text-rose-400',
    headerBg: 'bg-rose-950/60',
    border: 'border-rose-800/60',
    countBg: 'bg-rose-900/80 text-rose-300',
  },
  {
    id: 'nearDTE',
    label: 'Near DTE',
    accent: 'text-amber-400',
    headerBg: 'bg-amber-950/60',
    border: 'border-amber-800/60',
    countBg: 'bg-amber-900/80 text-amber-300',
  },
]

type MarksMap = Record<string, { price: number | null; multiplier: number | null; greeks?: Record<string, number | null | undefined> }>

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
    <div className="bg-zinc-800 border border-zinc-700/80 rounded-xl p-3 flex flex-col gap-2 hover:border-zinc-600 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold text-zinc-100 truncate leading-snug">
          {p.structureId ?? p.id}
        </span>
        {p.strategy ? (
          <span className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-zinc-700 text-zinc-300 uppercase tracking-wide">
            {p.strategy}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-3 text-xs">
        {hasPnl ? (
          <span className={pnl >= 0 ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
            {pnl >= 0 ? '+' : ''}{fmtPremium(pnl)}
          </span>
        ) : (
          <span className="text-zinc-600">no marks</span>
        )}

        {minDte !== null ? (
          <span className={`font-medium tabular-nums ${minDte <= 7 ? 'text-amber-400' : 'text-zinc-500'}`}>
            {minDte}d
          </span>
        ) : null}

        <span className="text-zinc-600 ml-auto">
          {p.legs.length} leg{p.legs.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
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
      {LANES.map(({ id, label, accent, headerBg, border, countBg }) => (
        <div
          key={id}
          className={`flex flex-col rounded-xl border ${border} overflow-hidden`}
        >
          {/* Lane header */}
          <div className={`${headerBg} px-3 py-2.5 flex items-center justify-between flex-shrink-0`}>
            <span className={`text-sm font-semibold ${accent}`}>{label}</span>
            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${countBg}`}>
              {lanes[id].length}
            </span>
          </div>

          {/* Cards */}
          <div className="flex flex-col gap-2 p-2 overflow-y-auto flex-1">
            {lanes[id].length === 0 ? (
              <p className="text-xs text-zinc-700 text-center py-6">No structures</p>
            ) : (
              lanes[id].map((p) => <KanbanCard key={p.id} p={p} marks={marks} />)
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
