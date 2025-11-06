import React from 'react'
import { Pencil, Save } from 'lucide-react'
import {
  Position,
  fmtPremium,
  fmtNumber,
  positionUnrealizedPnL,
  legUnrealizedPnL,
  positionGreeks,
  fmtGreek,
  getLegMarkRef,
  type LegMarkRef,
} from '../utils'
import { StructureEntryOverlay } from './StructureEntryOverlay'

type MarkInfo = { price: number | null; multiplier: number | null; greeks?: any }
type MarkMap = Record<string, MarkInfo>

type PositionRowProps = {
  p: Position
  onUpdate: (id: string, updates: Partial<Position>) => void
  visibleCols: string[]
  marks?: MarkMap
  markLoading?: boolean
  allPositions: Position[]
  readOnly?: boolean
  disableSave?: boolean
  onSaved?: (positionId: string) => void
}

function CellSpinner() {
  return (
    <svg className="animate-spin h-4 w-4 inline-block text-slate-400" viewBox="0 0 24 24">
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

const PositionRowComponent: React.FC<PositionRowProps> = ({
  p,
  onUpdate,
  visibleCols,
  marks,
  markLoading,
  allPositions,
  readOnly = false,
  disableSave = false,
  onSaved,
}) => {
  const [open, setOpen] = React.useState(false)
  const [showSaveOverlay, setShowSaveOverlay] = React.useState(false)
  const statusTone =
    p.status === 'OPEN'
      ? 'success'
      : p.status === 'ATTENTION'
      ? 'warning'
      : p.status === 'ALERT'
      ? 'destructive'
      : 'muted'
  const isUpdateMode = p.source === 'supabase'
  const isReadOnly = readOnly || isUpdateMode
  const canOpenOverlay = (!disableSave || isUpdateMode) && (!readOnly || isUpdateMode)

  const legMarkData = React.useMemo(() => {
    const map = new Map<string, { ref: LegMarkRef | null; mark: MarkInfo | undefined }>()
    for (const leg of p.legs) {
      const ref = getLegMarkRef(p, leg)
      const mark = ref ? marks?.[ref.key] : undefined
      map.set(leg.key, { ref, mark })
    }
    return map
  }, [p, marks])

  const posUnrealized = React.useMemo(
    () => (marks ? positionUnrealizedPnL(p, marks) : 0),
    [marks, p]
  )

  const posTotalPnl = p.realizedPnl + posUnrealized

  const structureGreeks = React.useMemo(
    () => (marks ? positionGreeks(p, marks) : { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 }),
    [marks, p]
  )

  return (
    <>
      <tr className="border-b last:border-0 hover:bg-slate-50">
        <td className="p-3 align-top">
          <button onClick={() => setOpen((v) => !v)} className="text-slate-500">
            {open ? '▾' : '▸'}
          </button>
        </td>
        {visibleCols.includes('status') && (
          <td className="p-3 align-top">
            <div className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  statusTone === 'success'
                    ? 'bg-emerald-500'
                    : statusTone === 'warning'
                    ? 'bg-amber-500'
                    : statusTone === 'destructive'
                    ? 'bg-rose-500'
                    : 'bg-slate-400'
                }`}
              />
              <span className="text-slate-700 text-sm">{p.status}</span>
            </div>
          </td>
        )}
        {visibleCols.includes('symbol') && (
          <td className="p-3 align-top font-medium text-slate-800">{p.underlying}</td>
        )}
        {visibleCols.includes('structure') && <td className="p-3 align-top">{p.structureId}</td>}
        {visibleCols.includes('dte') && <td className="p-3 align-top">{p.dte}</td>}
        {visibleCols.includes('type') && <td className="p-3 align-top">{p.type}</td>}
        {visibleCols.includes('legs') && <td className="p-3 align-top">{p.legsCount}</td>}
        {visibleCols.includes('strategy') && (
          <td className="p-3 align-top">
            <input
              value={p.strategy || ''}
              onChange={(e) => {
                if (isReadOnly) return
                onUpdate(p.id, { strategy: e.target.value })
              }}
              placeholder="e.g., Iron Condor"
              className="border rounded-lg px-2 py-1 text-sm w-40"
              disabled={isReadOnly}
              readOnly={isReadOnly}
            />
          </td>
        )}
        {visibleCols.includes('pnl') && (
          <td className={`p-3 align-top ${posTotalPnl < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
            {fmtPremium(posTotalPnl, p.underlying)}
            <div className="text-xs text-slate-500">
              <span title="Realized">{fmtPremium(p.realizedPnl, p.underlying)}</span>
              {' + '}
              <span title="Unrealized (from Marks)">{fmtPremium(posUnrealized, p.underlying)}</span>
            </div>
          </td>
        )}
        {visibleCols.includes('pnlpct') && (
          <td className={`p-3 align-top ${p.pnlPct && p.pnlPct < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
            {p.pnlPct == null ? '—' : `${p.pnlPct.toFixed(2)}%`}
          </td>
        )}
        {visibleCols.includes('delta') && <td className="p-3 align-top">{fmtNumber(structureGreeks.delta)}</td>}
        {visibleCols.includes('gamma') && <td className="p-3 align-top">{fmtGreek(structureGreeks.gamma, 6)}</td>}
        {visibleCols.includes('theta') && <td className="p-3 align-top">{fmtNumber(structureGreeks.theta)}</td>}
        {visibleCols.includes('vega') && <td className="p-3 align-top">{fmtNumber(structureGreeks.vega)}</td>}
        {visibleCols.includes('rho') && <td className="p-3 align-top">{fmtNumber(structureGreeks.rho)}</td>}
        {visibleCols.includes('playbook') && (
          <td className="p-3 align-top">
            <input
              value={p.playbook || ''}
              onChange={(e) => {
                if (isReadOnly) return
                onUpdate(p.id, { playbook: e.target.value })
              }}
              placeholder="https://…"
              className="border rounded-lg px-2 py-1 text-sm w-44"
              disabled={isReadOnly}
              readOnly={isReadOnly}
            />
          </td>
        )}
        <td className="p-3 align-top text-right">
          <button
            onClick={() => {
              if (isReadOnly) return
              onUpdate(p.id, {
                status:
                  p.status === 'OPEN'
                    ? ('ATTENTION' as Position['status'])
                    : p.status === 'ATTENTION'
                    ? ('ALERT' as Position['status'])
                    : p.status === 'ALERT'
                    ? ('OPEN' as Position['status'])
                    : p.status,
              })
            }}
            className={`text-slate-500 ${isReadOnly ? 'cursor-not-allowed opacity-50' : ''}`}
            disabled={isReadOnly}
          >
            ⋯
          </button>
        </td>
        <td className="p-3 align-top text-right">
          {isUpdateMode ? (
            <div className="inline-flex items-center gap-2">
              <span className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
                Saved
              </span>
              {canOpenOverlay ? (
                <button
                  type="button"
                  onClick={() => setShowSaveOverlay(true)}
                  className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white p-2 text-slate-600 shadow-sm hover:bg-slate-100"
                  title="Update saved structure"
                >
                  <Pencil className="h-4 w-4" />
                  <span className="sr-only">Open update overlay</span>
                </button>
              ) : null}
            </div>
          ) : canOpenOverlay ? (
            <button
              type="button"
              onClick={() => setShowSaveOverlay(true)}
              className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white p-2 text-slate-600 shadow-sm hover:bg-slate-100"
              title="Open save overlay"
            >
              <Save className="h-4 w-4" />
              <span className="sr-only">Open save overlay</span>
            </button>
          ) : (
            <span className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
              Save disabled
            </span>
          )}
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-50/60">
          <td />
          <td colSpan={20} className="p-3">
            <div className="grid md:grid-cols-3 gap-3">
              <div className="bg-white border rounded-xl p-3">
                <div className="text-xs text-slate-500">Underlying</div>
                <div className="text-sm font-medium">{p.underlying}</div>
                <div className="mt-2 text-xs text-slate-500">Expiry</div>
                <div className="text-sm font-medium">{p.expiryISO} ({p.dte} DTE)</div>
                <div className="mt-2 text-xs text-slate-500">Exchange</div>
                <div className="text-sm font-medium capitalize">{p.exchange ?? '—'}</div>
                <div className="mt-2 text-xs text-slate-500">Net Premium</div>
                <div className="text-sm font-medium">{fmtPremium(p.netPremium, p.underlying)}</div>
              </div>
              <div className="bg-white border rounded-xl p-3 md:col-span-2">
                <div className="text-xs text-slate-500 mb-2">Legs</div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="text-left p-2">Leg</th>
                        <th className="text-left p-2">Net Qty</th>
                        <th className="text-left p-2">Realized PnL</th>
                        <th className="text-left p-2">Net Premium</th>
                        <th className="text-left p-2">Mark</th>
                        <th className="text-left p-2">uPnL</th>
                        <th className="text-left p-2">Open Lots</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.legs.map((l) => {
                        const entry = legMarkData.get(l.key)
                        const ref = entry?.ref ?? null
                        const markInfo = entry?.mark
                        const markPrice = markInfo?.price ?? null

                        const markCell: React.ReactNode = !ref
                          ? '—'
                          : markPrice == null
                          ? markLoading
                            ? <CellSpinner />
                            : '—'
                          : markPrice.toLocaleString(undefined, { maximumFractionDigits: 8 })

                        let unrealizedCell: React.ReactNode = '—'
                        if (!ref) {
                          unrealizedCell = '—'
                        } else if (markPrice == null) {
                          unrealizedCell = markLoading ? <CellSpinner /> : '—'
                        } else {
                          const multiplier = ref.exchange === 'coincall' ? markInfo?.multiplier : ref.defaultMultiplier
                          const u = legUnrealizedPnL(l, markPrice, multiplier)
                          unrealizedCell = (
                            <span className={u < 0 ? 'text-rose-600' : 'text-emerald-600'}>
                              {fmtPremium(u, p.underlying)}
                            </span>
                          )
                        }

                        return (
                          <React.Fragment key={l.key}>
                            <tr className="border-t">
                              <td className="p-2">
                                {l.strike} {l.optionType}
                              </td>
                              <td className="p-2">{l.qtyNet}</td>
                              <td className={`p-2 ${l.realizedPnl < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                {fmtPremium(l.realizedPnl, p.underlying)}
                              </td>
                              <td className="p-2">{fmtPremium(l.netPremium, p.underlying)}</td>
                              <td className="p-2">{markCell}</td>
                              <td className="p-2 text-right">{unrealizedCell}</td>
                              <td className="p-2">
                                {l.openLots.length
                                  ? l.openLots.map((o, i) => (
                                      <span key={i} className="inline-block mr-2">
                                        {o.sign === 1 ? 'Long' : 'Short'} {o.qty}@{fmtNumber(o.price)}
                                      </span>
                                    ))
                                  : '—'}
                              </td>
                            </tr>
                            <tr className="border-t-0">
                              <td colSpan={7} className="p-2 text-left">
                                <div className="flex flex-wrap gap-2">
                                  {l.trades?.map((t, i) => {
                                    const exchangeLabel = (t.exchange ?? p.exchange ?? '').toUpperCase()
                                    return (
                                      <span
                                        key={i}
                                        className="inline-flex items-center gap-2 rounded-full border px-2 py-1 bg-slate-50"
                                        title={t.timestamp || ''}
                                      >
                                        <span className="text-[10px] rounded-full px-2 py-[2px] border bg-white text-slate-700">
                                          Structure #{t.structureId ?? '—'}{' '}
                                          {exchangeLabel || '—'}
                                        </span>
                                        <span className="text-[11px] text-slate-500">
                                          {(t.timestamp || '').slice(11, 19) || '—'}
                                        </span>
                                        <span className="text-xs text-slate-800">
                                          {(t.action ? `${t.action} ` : '') + t.side} {t.amount}@{fmtNumber(t.price)}
                                        </span>
                                      </span>
                                    )
                                  })}
                                </div>
                              </td>
                            </tr>
                          </React.Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
      {canOpenOverlay && showSaveOverlay ? (
        <StructureEntryOverlay
          open={showSaveOverlay}
          onClose={() => setShowSaveOverlay(false)}
          position={p}
          allPositions={allPositions}
          onSaved={onSaved}
          mode={isUpdateMode ? 'update' : 'create'}
          existingPositionId={isUpdateMode ? p.id : undefined}
        />
      ) : null}
    </>
  )
}

export const PositionRow = React.memo(
  PositionRowComponent,
  (prev, next) =>
    prev.p === next.p &&
    prev.onUpdate === next.onUpdate &&
    prev.visibleCols === next.visibleCols &&
    prev.marks === next.marks &&
    prev.markLoading === next.markLoading &&
    prev.allPositions === next.allPositions &&
    prev.readOnly === next.readOnly &&
    prev.disableSave === next.disableSave &&
    prev.onSaved === next.onSaved
)

PositionRow.displayName = 'PositionRow'
