import React from 'react'
import { Link as LinkIcon, Pencil, Save } from 'lucide-react'
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
import { buildStructureChipSummary } from '../lib/positions/structureSummary'
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
  onArchive?: (positionId: string) => void
  archiving?: boolean
  clientScope: { activeClient: string | null; isAdmin: boolean }
  onPlaybookOpen?: (position: Position) => void
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
  onArchive,
  archiving = false,
  clientScope,
  onPlaybookOpen,
}) => {
  const fmtFiveDecimals = React.useCallback(
    (value: number) =>
      value.toLocaleString(undefined, {
        minimumFractionDigits: 5,
        maximumFractionDigits: 5,
      }),
    [],
  )

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
  const hasMultipleExpiries = (p.expiries?.length ?? 0) > 1
  const expirySummary = React.useMemo(() => {
    if (!p.expiries || p.expiries.length <= 1) return p.expiryISO
    return `${p.expiries[0]} (+${p.expiries.length - 1} more)`
  }, [p.expiries, p.expiryISO])

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

  const { netPremiumForPct, pnlPctSignedBasis } = React.useMemo(() => {
    if (!Number.isFinite(p.netPremium)) {
      return { netPremiumForPct: 0, pnlPctSignedBasis: posTotalPnl }
    }

    const premiumAbs = Math.abs(p.netPremium)
    const isNetCredit = p.netPremium > 0

    return {
      netPremiumForPct: premiumAbs,
      pnlPctSignedBasis: isNetCredit ? -posTotalPnl : posTotalPnl,
    }
  }, [p.netPremium, posTotalPnl])

  const markAwarePnlPct = React.useMemo(() => {
    if (netPremiumForPct <= 0) return null
    return (pnlPctSignedBasis / netPremiumForPct) * 100
  }, [netPremiumForPct, pnlPctSignedBasis])

  const structureGreeks = React.useMemo(
    () => (marks ? positionGreeks(p, marks) : { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 }),
    [marks, p]
  )

  const programLabel = React.useMemo(() => {
    if (p.source !== 'supabase') return ''
    return (p.programName ?? '').trim()
  }, [p.programName, p.source])

  const isClosed = p.status === 'CLOSED'

  const strategyLabel = React.useMemo(() => {
    return (p.strategy ?? '').trim()
  }, [p.strategy])

  const hasPlaybookValue = React.useMemo(() => {
    if (!onPlaybookOpen) return false
    if (typeof p.playbook === 'string' && p.playbook.trim().length > 0) return true
    return Boolean(p.programId)
  }, [onPlaybookOpen, p.playbook, p.programId])

  const structureChipSummary = React.useMemo(() => buildStructureChipSummary(p), [p])
  const showStructureChip = Boolean(structureChipSummary)

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
        {visibleCols.includes('structure') && <td className="p-3 align-top">{p.structureId}</td>}
        {visibleCols.includes('dte') && (
          <td className="p-3 align-top">
            <div className="flex flex-col leading-tight">
              <span>{p.dte}</span>
              <span className="text-xs text-slate-500">
                ({p.openSinceDays != null ? p.openSinceDays : '—'})
              </span>
            </div>
          </td>
        )}
        {visibleCols.includes('legs') && <td className="p-3 align-top">{p.legsCount}</td>}
        {visibleCols.includes('strategy') && (
          <td className="p-3 align-top">
            {programLabel || strategyLabel || showStructureChip ? (
              <div className="flex flex-col gap-1">
                {programLabel && (
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-sm">
                    {programLabel}
                  </span>
                )}
                {showStructureChip && structureChipSummary && (
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm">
                    {structureChipSummary}
                  </span>
                )}
                {strategyLabel && (
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-sm">
                    {strategyLabel}
                  </span>
                )}
              </div>
            ) : (
              <span className="inline-flex min-h-[2.25rem] items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-400">
                —
              </span>
            )}
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
          <td className={`p-3 align-top ${markAwarePnlPct && markAwarePnlPct < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
            {markAwarePnlPct == null ? '—' : `${markAwarePnlPct.toFixed(2)}%`}
          </td>
        )}
        {visibleCols.includes('delta') && <td className="p-3 align-top">{fmtNumber(structureGreeks.delta)}</td>}
        {visibleCols.includes('gamma') && <td className="p-3 align-top">{fmtGreek(structureGreeks.gamma, 6)}</td>}
        {visibleCols.includes('theta') && <td className="p-3 align-top">{fmtNumber(structureGreeks.theta)}</td>}
        {visibleCols.includes('vega') && <td className="p-3 align-top">{fmtNumber(structureGreeks.vega)}</td>}
        {visibleCols.includes('rho') && <td className="p-3 align-top">{fmtNumber(structureGreeks.rho)}</td>}
        {visibleCols.includes('playbook') && (
          <td className="p-3 align-top">
            <button
              type="button"
              className={`inline-flex items-center justify-center rounded-md border px-2 py-1 text-slate-600 shadow-sm ${
                hasPlaybookValue ? 'border-slate-200 bg-white hover:bg-slate-100' : 'border-slate-200 bg-slate-50 opacity-60'
              }`}
              disabled={!hasPlaybookValue}
              onClick={() => (hasPlaybookValue && onPlaybookOpen ? onPlaybookOpen(p) : null)}
            >
              <LinkIcon className="h-4 w-4" />
              <span className="sr-only">Open playbook link</span>
            </button>
          </td>
        )}
        <td className="p-3 align-top text-right">
          {isUpdateMode ? (
            <div className="inline-flex flex-wrap items-center gap-2 justify-end">
              <span className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
                Saved
              </span>
              {onArchive ? (
                <button
                  type="button"
                  onClick={() => onArchive(p.id)}
                  className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  title="Archive this saved structure"
                  disabled={archiving}
                >
                  {archiving ? (
                    <>
                      <CellSpinner />
                      <span className="ml-1">Archiving…</span>
                    </>
                  ) : (
                    <>Archive</>
                  )}
                </button>
              ) : null}
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
                <div className="text-sm font-medium">{expirySummary} ({p.dte} DTE)</div>
                <div className="mt-2 text-xs text-slate-500">Exchange</div>
                <div className="text-sm font-medium capitalize">{p.exchange ?? '—'}</div>
                <div className="mt-2 text-xs text-slate-500">Net Premium</div>
                <div className="text-sm font-medium flex items-center gap-2">
                  <span>{fmtPremium(p.netPremium, p.underlying)}</span>
                  {isClosed ? (
                    <span className={p.realizedPnl < 0 ? 'text-rose-600' : 'text-emerald-600'}>
                      / {fmtPremium(p.realizedPnl, p.underlying)}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="bg-white border rounded-xl p-3 md:col-span-2">
                <div className="text-xs text-slate-500 mb-2">Legs</div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="text-left p-2">Leg</th>
                        <th className="text-right p-2">Net Qty</th>
                        <th className="text-right p-2">Realized PnL</th>
                        <th className="text-right p-2">Net Premium</th>
                        <th className="text-right p-2">Mark</th>
                        <th className="text-right p-2">uPnL</th>
                        <th className="text-right p-2">Fee</th>
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
                          : fmtFiveDecimals(markPrice)

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
                              {fmtPremium(u, p.underlying, 5)}
                            </span>
                          )
                        }

                        return (
                          <React.Fragment key={l.key}>
                            <tr className="border-t">
                              <td className="p-2">
                                {hasMultipleExpiries && l.expiry ? (
                                  <div>
                                    <div>{l.strike} {l.optionType}</div>
                                    <div className="text-[11px] text-slate-500">{l.expiry}</div>
                                  </div>
                                ) : (
                                  <>{l.strike} {l.optionType}</>
                                )}
                              </td>
                              <td className="p-2 text-right font-mono tabular-nums">{fmtFiveDecimals(l.qtyNet)}</td>
                              <td className={`p-2 text-right font-mono tabular-nums ${l.realizedPnl < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                {fmtPremium(l.realizedPnl, p.underlying, 5)}
                              </td>
                              <td className="p-2 text-right font-mono tabular-nums">{fmtPremium(l.netPremium, p.underlying, 5)}</td>
                              <td className="p-2 text-right font-mono tabular-nums">{markCell}</td>
                              <td className="p-2 text-right font-mono tabular-nums">{unrealizedCell}</td>
                              <td className="p-2 text-right font-mono tabular-nums">
                                {l.fees != null ? fmtPremium(l.fees, p.underlying, 5) : '—'}
                              </td>
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
          clientScope={clientScope}
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
    prev.onSaved === next.onSaved &&
    prev.onArchive === next.onArchive &&
    prev.archiving === next.archiving &&
    prev.clientScope === next.clientScope &&
    prev.onPlaybookOpen === next.onPlaybookOpen
)

PositionRow.displayName = 'PositionRow'
