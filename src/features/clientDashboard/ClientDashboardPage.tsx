import React from 'react'
import { TrendingUp, Play, Square } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { StatusBadge } from '../../components/StatusBadge'
import { TransactionTable } from '../../components/TransactionTable'
import { ConfirmationTable } from '../../components/ConfirmationTable'
import { Spinner } from '../../components/Spinner'
import { DataTable, type Column } from '../../components/ui'
import {
  fmtPremium, positionUnrealizedPnL, positionGreeks, fmtNumber, fmtGreek,
  type Position, type MarksMap,
} from '../../utils'

type ClientDashboardPageProps = {
  clientName: string
  positions: Position[]
  marks?: MarksMap
  markLoading?: boolean
  onRefreshMarks?: () => void
  strategyRunning: boolean
  onToggleStrategy?: () => void
  onOpenStructureDetail?: (id: string) => void
}

const TAB_ITEMS = [
  { value: 'positions', label: 'Positions' },
  { value: 'trades', label: 'Trades' },
  { value: 'confirmation', label: 'Open for Confirmation' },
]

function DetailItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="type-caption text-text-tertiary mb-0.5">{label}</div>
      <div className="type-subhead font-medium text-text-primary">{children}</div>
    </div>
  )
}

type PositionSummaryRow = {
  id: string
  strategy: string
  underlying: string
  expiry: string
  dte: number
  status: Position['status']
  netPremium: number
  realizedPnl: number
  unrealizedPnl: number | null
  delta: number | null
  gamma: number | null
  theta: number | null
  vega: number | null
  asset: string
}

export function ClientDashboardPage({
  clientName,
  positions,
  marks,
  markLoading,
  onRefreshMarks,
  strategyRunning,
  onToggleStrategy,
  onOpenStructureDetail,
}: ClientDashboardPageProps) {
  const [activeTab, setActiveTab] = React.useState('positions')

  // Aggregate portfolio KPIs
  const portfolio = React.useMemo(() => {
    let totalEquity = 0
    let totalRealized = 0
    let totalUnrealized = 0
    let hasAnyMarks = false
    let delta = 0, gamma = 0, theta = 0, vega = 0

    for (const p of positions) {
      totalEquity += p.netPremium
      totalRealized += p.realizedPnl
      if (marks) {
        const uPnl = positionUnrealizedPnL(p, marks)
        if (uPnl != null) {
          totalUnrealized += uPnl
          hasAnyMarks = true
        }
        const g = positionGreeks(p, marks)
        if (g) {
          delta += g.delta
          gamma += g.gamma
          theta += g.theta
          vega += g.vega
        }
      }
    }

    const totalPnl = hasAnyMarks ? totalRealized + totalUnrealized : null
    const pnlPct = totalPnl != null && Math.abs(totalEquity) > 0
      ? (totalPnl / Math.abs(totalEquity)) * 100
      : null

    // Use first position's program/exchange as representative
    const programName = positions.find(p => p.programName)?.programName ?? '—'
    const exchange = positions.find(p => p.exchange)?.exchange ?? '—'
    const asset = positions[0]?.underlying ?? 'BTC'

    return { totalEquity, totalPnl, totalRealized, pnlPct, programName, exchange, asset, delta, gamma, theta, vega, hasAnyMarks }
  }, [positions, marks])

  // Build position summary rows
  const positionRows = React.useMemo<PositionSummaryRow[]>(() => {
    return positions.map(p => {
      const uPnl = marks ? positionUnrealizedPnL(p, marks) : null
      const g = marks ? positionGreeks(p, marks) : null
      return {
        id: p.id,
        strategy: p.strategy ?? p.structureId ?? p.underlying,
        underlying: p.underlying,
        expiry: p.expiryISO,
        dte: p.dte,
        status: p.status,
        netPremium: p.netPremium,
        realizedPnl: p.realizedPnl,
        unrealizedPnl: uPnl,
        delta: g?.delta ?? null,
        gamma: g?.gamma ?? null,
        theta: g?.theta ?? null,
        vega: g?.vega ?? null,
        asset: p.underlying,
      }
    })
  }, [positions, marks])

  const positionColumns = React.useMemo<Column<PositionSummaryRow>[]>(() => [
    {
      key: 'strategy',
      header: 'Structure',
      render: (r) => (
        <button
          type="button"
          className="text-accent-400 hover:underline text-left"
          onClick={() => onOpenStructureDetail?.(r.id)}
        >
          {r.strategy}
        </button>
      ),
    },
    { key: 'underlying', header: 'Underlying', render: (r) => r.underlying },
    { key: 'expiry', header: 'Expiry', render: (r) => r.expiry },
    { key: 'dte', header: 'DTE', align: 'right', render: (r) => r.dte },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: 'netPremium',
      header: 'Net Prem',
      align: 'right',
      render: (r) => fmtPremium(r.netPremium, r.asset),
    },
    {
      key: 'realizedPnl',
      header: 'Real. PnL',
      align: 'right',
      render: (r) => (
        <span className={r.realizedPnl < 0 ? 'text-status-danger' : 'text-status-success'}>
          {fmtPremium(r.realizedPnl, r.asset)}
        </span>
      ),
    },
    {
      key: 'unrealizedPnl',
      header: 'uPnL',
      align: 'right',
      render: (r) => {
        if (r.unrealizedPnl == null) return markLoading ? <Spinner className="h-3 w-3 inline" /> : '—'
        return (
          <span className={r.unrealizedPnl < 0 ? 'text-status-danger' : 'text-status-success'}>
            {fmtPremium(r.unrealizedPnl, r.asset)}
          </span>
        )
      },
    },
    { key: 'delta', header: 'Delta', align: 'right', render: (r) => r.delta != null ? fmtNumber(r.delta) : '—' },
    { key: 'gamma', header: 'Gamma', align: 'right', render: (r) => r.gamma != null ? fmtGreek(r.gamma, 6) : '—' },
    { key: 'theta', header: 'Theta', align: 'right', render: (r) => r.theta != null ? fmtNumber(r.theta) : '—' },
    { key: 'vega', header: 'Vega', align: 'right', render: (r) => r.vega != null ? fmtNumber(r.vega) : '—' },
  ], [markLoading, onOpenStructureDetail])

  return (
    <div className="flex-1 overflow-auto px-6 py-5">
      {/* Header row */}
      <div className="flex items-center justify-between mb-5">
        <div />
        <div className="flex items-center gap-2">
          {onRefreshMarks && (
            <button
              type="button"
              onClick={onRefreshMarks}
              disabled={markLoading}
              title="Refresh live marks"
              className="rounded-xl p-2 bg-bg-surface-3 border border-border-default text-text-primary hover:bg-bg-surface-4 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {markLoading
                ? <Spinner className="h-4 w-4" />
                : <TrendingUp className="h-4 w-4" />}
            </button>
          )}
          {onToggleStrategy && (
            <Button
              variant={strategyRunning ? 'secondary' : 'primary'}
              size="sm"
              leftIcon={strategyRunning
                ? <Square className="h-3.5 w-3.5" />
                : <Play className="h-3.5 w-3.5" />}
              onClick={onToggleStrategy}
            >
              {strategyRunning ? 'Stop Strategy' : 'Start Strategy'}
            </Button>
          )}
        </div>
      </div>

      {/* Main content card */}
      <div className="bg-bg-surface-1 rounded-2xl border border-border-default overflow-hidden">
        {/* Title row */}
        <div className="px-6 pt-6 pb-4">
          <h1 className="type-title-l font-bold text-text-primary">{clientName}</h1>
          <div className="mt-1 type-subhead text-text-secondary">Obsidian Core</div>
        </div>

        {/* Portfolio Details sub-card */}
        <div className="mx-6 mb-5">
          <div className="bg-bg-surface-2 rounded-xl border border-border-subtle p-5">
            <div className="type-caption font-semibold text-text-secondary uppercase tracking-wider mb-4">
              Portfolio Details
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-4">
              <DetailItem label="Equity">
                {fmtPremium(portfolio.totalEquity, portfolio.asset)}
              </DetailItem>
              <DetailItem label="PnL">
                {portfolio.totalPnl != null ? (
                  <span className={portfolio.totalPnl < 0 ? 'text-status-danger' : 'text-status-success'}>
                    {fmtPremium(portfolio.totalPnl, portfolio.asset)}
                  </span>
                ) : '—'}
              </DetailItem>
              <DetailItem label="PnL %">
                {portfolio.pnlPct != null ? (
                  <span className={portfolio.pnlPct < 0 ? 'text-status-danger' : 'text-status-success'}>
                    {portfolio.pnlPct.toFixed(2)}%
                  </span>
                ) : '—'}
              </DetailItem>
              <DetailItem label="Program">
                {portfolio.programName}
              </DetailItem>
              <DetailItem label="Exchange">
                <span className="capitalize">{portfolio.exchange}</span>
              </DetailItem>
              <DetailItem label="Positions">{positions.length}</DetailItem>
              <DetailItem label="Delta">{portfolio.hasAnyMarks ? fmtNumber(portfolio.delta) : '—'}</DetailItem>
              <DetailItem label="Gamma">{portfolio.hasAnyMarks ? fmtGreek(portfolio.gamma, 6) : '—'}</DetailItem>
              <DetailItem label="Theta">{portfolio.hasAnyMarks ? fmtNumber(portfolio.theta) : '—'}</DetailItem>
              <DetailItem label="Vega">{portfolio.hasAnyMarks ? fmtNumber(portfolio.vega) : '—'}</DetailItem>
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
            positions.length === 0
              ? <p className="text-text-secondary type-subhead">No open positions.</p>
              : <DataTable
                  columns={positionColumns}
                  data={positionRows}
                  rowKey={(r) => r.id}
                  emptyMessage="No open positions."
                />
          )}
          {activeTab === 'trades' && (
            positions.length === 0
              ? <p className="text-text-secondary type-subhead">No trades.</p>
              : <div className="space-y-6">
                  {positions.map(p => (
                    <div key={p.id}>
                      <h3 className="type-subhead font-semibold text-text-primary mb-2">
                        {p.strategy ?? p.structureId ?? p.underlying}
                      </h3>
                      <TransactionTable position={p} />
                    </div>
                  ))}
                </div>
          )}
          {activeTab === 'confirmation' && (
            positions.length === 0
              ? <p className="text-text-secondary type-subhead">No trades open for confirmation.</p>
              : <div className="space-y-6">
                  {positions.map(p => (
                    <div key={p.id}>
                      <h3 className="type-subhead font-semibold text-text-primary mb-2">
                        {p.strategy ?? p.structureId ?? p.underlying}
                      </h3>
                      <ConfirmationTable position={p} />
                    </div>
                  ))}
                </div>
          )}
        </div>
      </div>
    </div>
  )
}
