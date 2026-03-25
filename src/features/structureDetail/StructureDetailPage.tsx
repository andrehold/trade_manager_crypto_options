import React from 'react'
import { ArrowLeft, Archive, TrendingUp } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { StatusBadge } from '../../components/StatusBadge'
import { LegPositionsTable } from '../../components/LegPositionsTable'
import { TransactionTable } from '../../components/TransactionTable'
import { Spinner } from '../../components/Spinner'
import { fmtPremium, positionUnrealizedPnL, positionGreeks, fmtNumber, fmtGreek } from '../../utils'
import type { Position, MarksMap } from '../../utils'

type StructureDetailPageProps = {
  embedded?: boolean
  position: Position
  marks?: MarksMap
  markLoading?: boolean
  onBack: () => void
  onArchive?: (id: string) => void
  archiving?: boolean
  onRefreshMarks?: () => void
}

const TAB_ITEMS = [
  { value: 'positions', label: 'Positions' },
  { value: 'trades', label: 'Trades' },
]

function formatStructureTitle(p: Position): string {
  const parts: string[] = []
  if (p.strategy) parts.push(p.strategy)
  else if (p.structureId) parts.push(p.structureId)
  else parts.push(p.underlying)

  const expiry = p.expiryISO
  if (expiry) {
    const d = new Date(expiry)
    if (!Number.isNaN(d.getTime())) {
      parts.push(d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' }))
    } else {
      parts.push(expiry)
    }
  }
  return parts.join(' — ')
}

function DetailItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="type-caption text-text-tertiary mb-0.5">{label}</div>
      <div className="type-subhead font-medium text-text-primary">{children}</div>
    </div>
  )
}

export function StructureDetailPage({
  position: p,
  marks,
  markLoading,
  onBack,
  onArchive,
  archiving,
  onRefreshMarks,
}: StructureDetailPageProps) {
  const [activeTab, setActiveTab] = React.useState('positions')

  const posUnrealized = React.useMemo(
    () => (marks ? positionUnrealizedPnL(p, marks) : null),
    [marks, p],
  )
  const hasMarks = posUnrealized != null
  const posTotalPnl = hasMarks ? p.realizedPnl + posUnrealized : null

  const greeks = React.useMemo(
    () => (marks ? positionGreeks(p, marks) : null),
    [marks, p],
  )

  const expirySummary = React.useMemo(() => {
    if (!p.expiries || p.expiries.length <= 1) return p.expiryISO
    return `${p.expiries[0]} (+${p.expiries.length - 1} more)`
  }, [p.expiries, p.expiryISO])

  return (
    <div className="flex-1 overflow-auto px-6 py-5">
      {/* Breadcrumb header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-xl p-2 text-text-secondary hover:bg-bg-surface-2 transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2 type-subhead text-text-secondary">
            <button type="button" onClick={onBack} className="hover:text-text-primary transition-colors">
              Structures
            </button>
            <span className="text-text-tertiary">/</span>
            <span className="text-text-primary font-medium">{formatStructureTitle(p)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onRefreshMarks && (
            <button
              type="button"
              onClick={onRefreshMarks}
              disabled={markLoading}
              title="Refresh live marks for this structure"
              className="rounded-xl p-2 bg-bg-surface-3 border border-border-default text-text-primary hover:bg-bg-surface-4 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {markLoading
                ? <Spinner className="h-4 w-4" />
                : <TrendingUp className="h-4 w-4" />}
            </button>
          )}
          {onArchive && (
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Archive className="h-3.5 w-3.5" />}
              onClick={() => onArchive(p.id)}
              disabled={archiving}
              loading={archiving}
            >
              Archive
            </Button>
          )}
        </div>
      </div>

      {/* Main content card */}
      <div className="bg-bg-surface-1 rounded-2xl border border-border-default overflow-hidden">
        {/* Title row */}
        <div className="px-6 pt-6 pb-4 flex items-start justify-between">
          <div>
            <h1 className="type-title-l font-bold text-text-primary">
              {formatStructureTitle(p)}
            </h1>
            <div className="mt-1 type-subhead text-text-secondary">
              {p.underlying} · {expirySummary} · {p.dte} DTE
            </div>
          </div>
          <StatusBadge status={p.status} />
        </div>

        {/* Structure Details sub-card */}
        <div className="mx-6 mb-5">
          <div className="bg-bg-surface-2 rounded-xl border border-border-subtle p-5">
            <div className="type-caption font-semibold text-text-secondary uppercase tracking-wider mb-4">
              Structure Details
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-4">
              <DetailItem label="Underlying">{p.underlying}</DetailItem>
              <DetailItem label="Expiry">{expirySummary} ({p.dte} DTE)</DetailItem>
              <DetailItem label="Exchange">
                <span className="capitalize">{p.exchange ?? '—'}</span>
              </DetailItem>
              <DetailItem label="Strategy">{p.strategy ?? '—'}</DetailItem>
              <DetailItem label="Program">{p.programName ?? '—'}</DetailItem>
              <DetailItem label="Net Premium">{fmtPremium(p.netPremium, p.underlying)}</DetailItem>
              <DetailItem label="Realized PnL">
                <span className={p.realizedPnl < 0 ? 'text-status-danger' : 'text-status-success'}>
                  {fmtPremium(p.realizedPnl, p.underlying)}
                </span>
              </DetailItem>
              <DetailItem label="Total PnL">
                {posTotalPnl != null ? (
                  <span className={posTotalPnl < 0 ? 'text-status-danger' : 'text-status-success'}>
                    {fmtPremium(posTotalPnl, p.underlying)}
                  </span>
                ) : '—'}
              </DetailItem>
              <DetailItem label="Delta (Δ)">{greeks ? fmtNumber(greeks.delta) : '—'}</DetailItem>
              <DetailItem label="Gamma (Γ)">{greeks ? fmtGreek(greeks.gamma, 6) : '—'}</DetailItem>
              <DetailItem label="Theta (Θ)">{greeks ? fmtNumber(greeks.theta) : '—'}</DetailItem>
              <DetailItem label="Vega (V)">{greeks ? fmtNumber(greeks.vega) : '—'}</DetailItem>
            </div>
          </div>
        </div>

        {/* Tab band */}
        <div className="px-6 pb-3 border-b border-border-subtle">
          <SegmentedControl
            items={TAB_ITEMS}
            value={activeTab}
            onChange={setActiveTab}
            size="sm"
          />
        </div>

        {/* Tab content */}
        <div className="p-6">
          {activeTab === 'positions' && (
            <LegPositionsTable position={p} marks={marks} markLoading={markLoading} />
          )}
          {activeTab === 'trades' && (
            <TransactionTable position={p} />
          )}
        </div>
      </div>
    </div>
  )
}
