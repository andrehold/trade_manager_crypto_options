import React from 'react'
import { Download, Link as LinkIcon, Pencil, Plus, Save } from 'lucide-react'
import { StatusBadge } from './StatusBadge'
import {
  Position,
  fmtPremium,
  fmtNumber,
  positionUnrealizedPnL,
  positionGreeks,
  fmtGreek,
  calculatePnlPct,
} from '../utils'
import { buildStructureChipSummary, buildStructureSummaryLines } from '../lib/positions/structureSummary'
import { StructureEntryOverlay } from './StructureEntryOverlay'
import { StructureDetailOverlay } from './StructureDetailOverlay'
import { TradeJsonExportOverlay } from './TradeJsonExportOverlay'

import type { MarksMap } from '../utils'

type PositionRowProps = {
  p: Position
  onUpdate: (id: string, updates: Partial<Position>) => void
  visibleCols: string[]
  marks?: MarksMap
  markLoading?: boolean
  allPositions: Position[]
  readOnly?: boolean
  disableSave?: boolean
  onSaved?: (positionId: string) => void
  onArchive?: (positionId: string) => void
  archiving?: boolean
  clientScope: { activeClient: string | null; isAdmin: boolean }
  onPlaybookOpen?: (position: Position) => void
  onViewDetails?: (position: Position) => void
}

function CellSpinner() {
  return (
    <svg className="animate-spin h-4 w-4 inline-block text-faint" viewBox="0 0 24 24">
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
  onViewDetails,
}) => {
  const [showSaveOverlay, setShowSaveOverlay] = React.useState(false)
  const [showDetailOverlay, setShowDetailOverlay] = React.useState(false)
  const [showExportOverlay, setShowExportOverlay] = React.useState(false)
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

  const posUnrealized = React.useMemo(
    () => (marks ? positionUnrealizedPnL(p, marks) : 0),
    [marks, p]
  )

  const posTotalPnl = p.realizedPnl + posUnrealized

  const { pnlPctBaseFallback, pnlPctSignedBasis } = React.useMemo(() => {
    const legsPremium = p.legs?.reduce((sum, leg) => sum + (Number.isFinite(leg.netPremium) ? leg.netPremium : 0), 0) ?? 0

    const premiumAbs = (() => {
      if (Number.isFinite(p.netPremium) && Math.abs(p.netPremium as number) > 0) return Math.abs(p.netPremium as number)
      if (Math.abs(legsPremium) > 0) return Math.abs(legsPremium)
      return 0
    })()

    return { pnlPctBaseFallback: premiumAbs, pnlPctSignedBasis: posTotalPnl }
  }, [p.legs, p.netPremium, posTotalPnl])

  const markAwarePnlPct = React.useMemo(() => {
    return calculatePnlPct(pnlPctSignedBasis, p.legs ?? [], pnlPctBaseFallback)
  }, [p.legs, pnlPctBaseFallback, pnlPctSignedBasis])

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
  const structureSummaryLines = React.useMemo(() => buildStructureSummaryLines(p), [p])
  const showStructureChip = Boolean(structureChipSummary)

  return (
    <>
      <tr className="tbl-row">
        <td className="tbl-td" />
        {visibleCols.includes('status') && (
          <td className="tbl-td">
            <StatusBadge status={p.status} />
          </td>
        )}
        {visibleCols.includes('dte') && (
          <td className="tbl-td">
            <div className="flex flex-col leading-tight">
              <span>{p.dte}</span>
              <span className="type-caption text-muted">
                ({p.openSinceDays != null ? p.openSinceDays : '—'})
              </span>
            </div>
          </td>
        )}
        {visibleCols.includes('strategy') && (
          <td className="tbl-td">
            {readOnly ? (
              structureSummaryLines ? (
                <div className="flex flex-col gap-1">
                  <span className="type-subhead font-medium text-strong">{structureSummaryLines.header}</span>
                  {structureSummaryLines.legs ? (
                    <span className="type-caption text-muted">{structureSummaryLines.legs}</span>
                  ) : null}
                </div>
              ) : (
                <span className="inline-flex min-h-[2.25rem] items-center rounded-lg border border-border-default bg-surface-page px-3 type-subhead text-faint">
                  —
                </span>
              )
            ) : programLabel || strategyLabel || showStructureChip ? (
              <div className="flex flex-col gap-1">
                {programLabel && (
                  <span className="inline-flex items-center rounded-full border border-border-default bg-surface-card px-2 py-1 type-caption font-medium text-body shadow-sm">
                    {programLabel}
                  </span>
                )}
                {showStructureChip && structureChipSummary && (
                  <span className="inline-flex items-center rounded-full border border-border-default bg-surface-card px-3 py-1 type-caption font-medium text-body shadow-sm">
                    {structureChipSummary}
                  </span>
                )}
                {strategyLabel && (
                  <span className="inline-flex items-center rounded-full border border-border-default bg-surface-card px-2 py-1 type-caption font-medium text-body shadow-sm">
                    {strategyLabel}
                  </span>
                )}
              </div>
            ) : (
              <span className="inline-flex min-h-[2.25rem] items-center rounded-lg border border-border-default bg-surface-page px-3 type-subhead text-faint">
                —
              </span>
            )}
          </td>
        )}
        {visibleCols.includes('pnl') && (
          <td className={`tbl-td ${posTotalPnl < 0 ? 'text-status-danger' : 'text-status-success'}`}>
            {fmtPremium(posTotalPnl, p.underlying)}
            <div className="type-caption text-muted">
              <span title="Realized">{fmtPremium(p.realizedPnl, p.underlying)}</span>
              {' + '}
              <span title="Unrealized (from Marks)">{fmtPremium(posUnrealized, p.underlying)}</span>
            </div>
          </td>
        )}
        {visibleCols.includes('pnlpct') && (
          <td className={`tbl-td ${markAwarePnlPct && markAwarePnlPct < 0 ? 'text-status-danger' : 'text-status-success'}`}>
            {markAwarePnlPct == null ? '—' : `${markAwarePnlPct.toFixed(2)}%`}
          </td>
        )}
        {visibleCols.includes('delta') && <td className="tbl-td">{fmtNumber(structureGreeks.delta)}</td>}
        {visibleCols.includes('gamma') && <td className="tbl-td">{fmtGreek(structureGreeks.gamma, 6)}</td>}
        {visibleCols.includes('theta') && <td className="tbl-td">{fmtNumber(structureGreeks.theta)}</td>}
        {visibleCols.includes('vega') && <td className="tbl-td">{fmtNumber(structureGreeks.vega)}</td>}
        {visibleCols.includes('rho') && <td className="tbl-td">{fmtNumber(structureGreeks.rho)}</td>}
        {visibleCols.includes('playbook') && (
          <td className="tbl-td">
            <button
              type="button"
              className={`tbl-action-btn ${
                hasPlaybookValue ? '' : 'opacity-60'
              }`}
              disabled={!hasPlaybookValue}
              onClick={() => (hasPlaybookValue && onPlaybookOpen ? onPlaybookOpen(p) : null)}
            >
              <LinkIcon className="h-3.5 w-3.5" />
              <span className="sr-only">Open playbook link</span>
            </button>
          </td>
        )}
        <td className="tbl-td text-right">
          {isUpdateMode ? (
            <div className="inline-flex flex-wrap items-center gap-1.5 justify-end">
              <span className="tbl-badge tbl-badge-neutral">
                Saved
              </span>
              {onArchive ? (
                <button
                  type="button"
                  onClick={() => onArchive(p.id)}
                  className="tbl-action-btn px-2.5 type-caption font-medium disabled:cursor-not-allowed disabled:opacity-60"
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
                <div className="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onViewDetails ? onViewDetails(p) : setShowDetailOverlay(true)}
                    className="tbl-action-btn"
                    title="View transaction details"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span className="sr-only">View structure details</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSaveOverlay(true)}
                    className="tbl-action-btn"
                    title="Update saved structure"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    <span className="sr-only">Open update overlay</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowExportOverlay(true)}
                    className="tbl-action-btn"
                    title="Export trade JSON"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span className="sr-only">Open trade export overlay</span>
                  </button>
                </div>
              ) : null}
            </div>
          ) : canOpenOverlay ? (
            <button
              type="button"
              onClick={() => setShowSaveOverlay(true)}
              className="tbl-action-btn"
              title="Open save overlay"
            >
              <Save className="h-3.5 w-3.5" />
              <span className="sr-only">Open save overlay</span>
            </button>
          ) : (
            <span className="tbl-badge tbl-badge-neutral">
              Save disabled
            </span>
          )}
        </td>
      </tr>
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
      {showDetailOverlay ? (
        <StructureDetailOverlay
          open={showDetailOverlay}
          onClose={() => setShowDetailOverlay(false)}
          position={p}
        />
      ) : null}
      {showExportOverlay ? (
        <TradeJsonExportOverlay
          open={showExportOverlay}
          onClose={() => setShowExportOverlay(false)}
          position={p}
          marks={marks}
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
