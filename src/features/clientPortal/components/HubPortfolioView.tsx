import React from 'react'
import { AlertTriangle, Database, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge, DataTable, type Column } from '@/components/ui'
import { decimalFrom } from '@/lib/portfolioDataHub/decimal'
import type { HubLedgerEvent, HubPosition, HubSummary, HubSummaryComponent } from '@/lib/portfolioDataHub'
import type { PortfolioHubOverview } from '@/lib/portfolioDataHub/client'
import { usePortfolioHubLedger, usePortfolioHubPositions } from '../usePortfolioDataHub'
import { formatPortfolioValue } from './portfolioFormatters'
import { HubPerformanceTrends } from './charts/HubPerformanceTrends'
import { ReportingCurrencySelector } from './ReportingCurrencySelector'
import {
  resolveAccountCurrency,
  resolveCurrencyMetric,
  type AccountCurrencyMetricKey,
} from '../dashboard/accountCurrency'

function formatTimestamp(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, {
    dateStyle: 'medium', timeStyle: 'short',
  })
}

function Metric({ label, value, detail, tone, className = '' }: {
  label: string
  value: string
  detail?: string
  tone?: 'pos' | 'neg'
  className?: string
}) {
  return (
    <div className={`rounded-xl border border-border-default bg-bg-surface-1 p-4 ${className}`}>
      <div className="type-caption uppercase tracking-wide text-text-tertiary">{label}</div>
      <div className={`mt-1.5 type-title-l font-bold ${tone === 'neg' ? 'text-status-danger' : tone === 'pos' ? 'text-status-success' : 'text-text-primary'}`}>{value}</div>
      {detail && <div className="mt-1 type-caption text-text-tertiary">{detail}</div>}
    </div>
  )
}

function metricTone(value: HubSummaryComponent['realizedPnl']) {
  if (value == null || decimalFrom(value).isZero()) return undefined
  return decimalFrom(value).isNegative() ? 'neg' as const : 'pos' as const
}

function SectionHead({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <h2 className="type-subhead font-semibold text-text-primary">{title}</h2>
      {meta && <span className="type-caption uppercase tracking-wide text-text-tertiary">{meta}</span>}
    </div>
  )
}

export function HubProvenance({ overview }: { overview: PortfolioHubOverview }) {
  const { summary, positions, alignment } = overview
  return (
    <div className="rounded-xl border border-border-default bg-bg-surface-2 px-4 py-3" data-testid="hub-provenance">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
        <div>
          <div className="type-caption text-text-tertiary">Summary as of</div>
          <div className="type-caption font-medium text-text-primary">{formatTimestamp(summary.fetchedAt)} · {summary.quality}</div>
        </div>
        <div>
          <div className="type-caption text-text-tertiary">Positions as of</div>
          <div className="type-caption font-medium text-text-primary">{formatTimestamp(positions.snapshot.fetchedAt)} · {positions.snapshot.quality}</div>
        </div>
        {alignment.mixedAge && (
          <div className="flex max-w-xl items-center gap-1.5 text-status-warning" role="status">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="type-caption">Mixed-age data: summary and positions came from different collection runs. Values are shown independently.</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function HubNativePositionsTable({ positions, quality, onLoadMore, loadingMore, error, expectedCount, fullyLoaded }: {
  positions: HubPosition[]; quality: 'complete' | 'partial'; onLoadMore?: () => void; loadingMore?: boolean; error?: string | null; expectedCount?: number; fullyLoaded?: boolean
}) {
  const columns = React.useMemo<Column<HubPosition>[]>(() => [
    { key: 'instrument', header: 'Instrument', render: (row) => <span className="font-medium text-text-primary">{row.nativeInstrumentId}</span> },
    { key: 'type', header: 'Type', render: (row) => row.instrumentType ?? '—' },
    { key: 'direction', header: 'Direction', render: (row) => row.direction ?? '—' },
    { key: 'quantity', header: 'Quantity', align: 'right', tabular: true, render: (row) => formatPortfolioValue(row.quantity, row.quantityUnit, 'quantity') },
    { key: 'averagePrice', header: 'Avg. price', align: 'right', tabular: true, render: (row) => formatPortfolioValue(row.averagePrice, row.quoteCurrency, 'price') },
    { key: 'markPrice', header: 'Mark', align: 'right', tabular: true, render: (row) => formatPortfolioValue(row.markPrice, row.quoteCurrency, 'price') },
    {
      key: 'unrealizedPnl', header: 'uPnL', align: 'right', tabular: true,
      render: (row) => {
        // quoteCurrency is the average/mark price unit. Canonical v1 does not
        // guarantee that it is also the PnL unit, so leave the value unlabelled
        // when the Hub cannot provide a reliable settlement currency.
        const value = formatPortfolioValue(row.unrealizedPnl, row.settlementCurrency)
        const tone = row.unrealizedPnl && decimalFrom(row.unrealizedPnl).isNegative() ? 'text-status-danger' : 'text-status-success'
        return row.unrealizedPnl === null ? value : <span className={tone}>{value}</span>
      },
    },
    { key: 'initialMargin', header: 'Initial margin', align: 'right', tabular: true, render: (row) => formatPortfolioValue(row.initialMargin, row.settlementCurrency) },
  ], [])

  const emptyMessage = quality === 'partial'
    ? 'This partial position collection reported no rows. It is not an authoritative zero-position result.'
    : 'No open positions in this complete Hub snapshot.'
  return <>
    {quality === 'partial' && <div className="mb-3 flex items-center gap-1.5 rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 type-caption text-status-warning" role="status"><AlertTriangle className="h-3.5 w-3.5" />Partial position collection — rows may be incomplete.</div>}
    {fullyLoaded && expectedCount != null && positions.length !== expectedCount && <div className="mb-3 flex items-center gap-1.5 rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 type-caption text-status-warning" role="status"><AlertTriangle className="h-3.5 w-3.5" />Loaded {positions.length} unique rows, but this {quality} snapshot reports {expectedCount}. Do not treat this view as complete.</div>}
    {error && <p className="mb-3 type-caption text-status-danger">{error}</p>}
    <DataTable columns={columns} data={positions} rowKey={(row) => row.id} emptyMessage={emptyMessage} />
    {onLoadMore && <div className="mt-4 text-center"><Button size="sm" variant="secondary" disabled={loadingMore} onClick={onLoadMore} leftIcon={loadingMore ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : undefined}>{loadingMore ? 'Loading…' : 'Load more positions'}</Button></div>}
  </>
}

export function HubDashboard({
  overview,
  history = [],
  historyError,
  onOpenPositions,
  onOpenLedger,
  onRefresh,
  refreshing,
  onSaveAccountCurrency,
  accountCurrencySaving,
  accountCurrencyError,
}: {
  overview: PortfolioHubOverview
  history?: HubSummary[]
  historyError?: string | null
  onOpenPositions: () => void
  onOpenLedger: () => void
  onRefresh: () => void
  refreshing?: boolean
  onSaveAccountCurrency: (currency: string | null) => void
  accountCurrencySaving?: boolean
  accountCurrencyError?: string | null
}) {
  const resolution = resolveAccountCurrency(
    overview.summary.components,
    overview.reportingCurrency,
    overview.reportingCurrencySource,
  )
  const partial = overview.positions.snapshot.quality === 'partial'
  const currency = resolution.status === 'resolved' ? resolution.currency : null
  const value = (key: AccountCurrencyMetricKey) => currency === null
    ? null
    : resolveCurrencyMetric(overview.summary.components, currency, key)
  const selector = (presentation: 'compact' | 'configuration') => (
    <ReportingCurrencySelector
      resolution={resolution}
      reportingCurrency={overview.reportingCurrency}
      reportingCurrencySource={overview.reportingCurrencySource}
      saving={accountCurrencySaving}
      error={accountCurrencyError}
      presentation={presentation}
      onSave={onSaveAccountCurrency}
    />
  )
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="type-title-l font-bold text-text-primary">Performance & risk</h1>
            <Badge variant="info"><Database className="mr-1 h-3 w-3" />Live portfolio data</Badge>
          </div>
          <p className="mt-1 type-subhead text-text-secondary">Your account performance and current risk exposure.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {resolution.status === 'resolved' && selector('compact')}
          {overview.summary.venue && <Badge variant="neutral">Venue {overview.summary.venue}</Badge>}
          <Button size="sm" variant="secondary" onClick={onRefresh} disabled={refreshing} leftIcon={<RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />}>{refreshing ? 'Refreshing…' : 'Refresh'}</Button>
        </div>
      </div>

      <HubProvenance overview={overview} />

      {resolution.status === 'selection-required' ? selector('configuration') : (
        <>
          <section className="flex flex-col gap-3">
            <SectionHead title="Performance" meta={`values in ${resolution.currency}`} />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="hub-kpi-row">
              <Metric label="Equity" value={formatPortfolioValue(value('equity'), resolution.currency)} detail="Balance including reported P&L" />
              <Metric label="Realized P&L" value={formatPortfolioValue(value('realizedPnl'), resolution.currency)} tone={metricTone(value('realizedPnl'))} detail="Reported by the venue" />
              <Metric label="Unrealized P&L" value={formatPortfolioValue(value('unrealizedPnl'), resolution.currency)} tone={metricTone(value('unrealizedPnl'))} detail="Reported by the venue" />
              <Metric label="Open positions" value={partial ? 'Partial collection' : String(overview.positions.snapshot.positionCount)} detail="Current venue snapshot" />
              <Metric label="Balance" value={formatPortfolioValue(value('balance'), resolution.currency)} detail="Includes received premium" className="md:col-span-2" />
              <Metric label="Available funds" value={formatPortfolioValue(value('availableFunds'), resolution.currency)} detail="Available under venue margin rules" className="md:col-span-2" />
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <SectionHead title="Performance trend" meta={`last 30 days · ${resolution.currency}`} />
            <HubPerformanceTrends history={history} current={overview.summary} currency={resolution.currency} />
            {historyError && <p className="type-caption text-text-tertiary">Historical trends could not be loaded. Current values are still up to date.</p>}
          </section>

          <section className="flex flex-col gap-3">
            <SectionHead title="Risk" meta={`current exposure · values in ${resolution.currency}`} />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="hub-risk-row">
              <Metric label="Initial margin" value={formatPortfolioValue(value('initialMargin'), resolution.currency)} detail="Venue reported" />
              <Metric label="Maintenance margin" value={formatPortfolioValue(value('maintenanceMargin'), resolution.currency)} detail="Venue reported" />
              <Metric label="Collateral" value={formatPortfolioValue(value('collateral'), resolution.currency)} detail="Venue reported" />
              <Metric label="Available to withdraw" value={formatPortfolioValue(value('availableWithdrawalFunds'), resolution.currency)} detail="Venue reported" />
            </div>
          </section>
        </>
      )}

      <section className="rounded-2xl border border-border-default bg-bg-surface-1 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="type-subhead font-semibold text-text-primary">Native positions</h2>
            <p className="mt-0.5 type-caption text-text-tertiary">Read-only venue positions; portfolio structures are not inferred in v1.</p>
          </div>
          <Button size="sm" variant="secondary" onClick={onOpenPositions}>View all positions</Button>
        </div>
        <HubNativePositionsTable positions={overview.positions.items.slice(0, 5)} quality={overview.positions.snapshot.quality} />
      </section>

      <HubSummaryDetails components={overview.summary.components} />
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-default bg-bg-surface-1 p-5">
        <div>
          <h2 className="type-subhead font-semibold text-text-primary">Ledger history</h2>
          <p className="mt-0.5 type-caption text-text-tertiary">Browse account activity with cursor-based pagination and basic filters.</p>
        </div>
        <Button size="sm" variant="secondary" onClick={onOpenLedger}>View ledger history</Button>
      </section>
    </div>
  )
}

export function HubPositionsPage({ overview, onRefresh, refreshing }: { overview: PortfolioHubOverview; onRefresh: () => void; refreshing?: boolean }) {
  const { items, nextCursor, loadingMore, error, loadMore } = usePortfolioHubPositions(overview)
  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="type-title-l font-bold text-text-primary">Positions</h1>
          <Badge variant="info"><Database className="mr-1 h-3 w-3" />Portfolio Data Hub</Badge>
        </div>
        <p className="mt-1 type-subhead text-text-secondary">Native venue positions from the latest completed or partial collection.</p>
        <div className="mt-3"><Button size="sm" variant="secondary" onClick={onRefresh} disabled={refreshing} leftIcon={<RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />}>{refreshing ? 'Refreshing…' : 'Refresh portfolio'}</Button></div>
      </div>
      <HubProvenance overview={overview} />
      <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-5">
        <HubNativePositionsTable positions={items} quality={overview.positions.snapshot.quality} onLoadMore={nextCursor ? () => void loadMore() : undefined} loadingMore={loadingMore} error={error} expectedCount={overview.positions.snapshot.positionCount} fullyLoaded={nextCursor === null} />
      </div>
    </div>
  )
}

export function HubLedgerPage({ onRefresh, refreshing }: { onRefresh: () => void; refreshing?: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="type-title-l font-bold text-text-primary">Ledger history</h1>
          <Badge variant="info"><Database className="mr-1 h-3 w-3" />Portfolio Data Hub</Badge>
        </div>
        <p className="mt-1 type-subhead text-text-secondary">Account-level deposits, withdrawals, trades, fees, and other venue events.</p>
        <div className="mt-3"><Button size="sm" variant="secondary" onClick={onRefresh} disabled={refreshing} leftIcon={<RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />}>{refreshing ? 'Refreshing…' : 'Refresh portfolio'}</Button></div>
      </div>
      <HubLedgerHistory />
    </div>
  )
}

export function nonZeroSummaryComponents(components: HubSummaryComponent[]) {
  return components.filter((component) => component.balance === null || !decimalFrom(component.balance).isZero())
}

function HubSummaryDetails({ components }: { components: HubSummaryComponent[] }) {
  const visibleComponents = React.useMemo(() => nonZeroSummaryComponents(components), [components])
  const columns = React.useMemo<Column<HubSummaryComponent>[]>(() => [
    { key: 'scope', header: 'Scope', render: (row) => row.componentScope.replace(/_/g, ' ') },
    { key: 'currency', header: 'Currency', render: (row) => row.currency },
    { key: 'equity', header: 'Equity', align: 'right', tabular: true, render: (row) => formatPortfolioValue(row.equity, row.currency) },
    { key: 'balance', header: 'Balance', align: 'right', tabular: true, render: (row) => formatPortfolioValue(row.balance, row.currency) },
    { key: 'available', header: 'Available funds', align: 'right', tabular: true, render: (row) => formatPortfolioValue(row.availableFunds, row.currency) },
    { key: 'margin', header: 'Initial margin', align: 'right', tabular: true, render: (row) => formatPortfolioValue(row.initialMargin, row.currency) },
  ], [])
  return (
    <section className="rounded-2xl border border-border-default bg-bg-surface-1 p-5">
      <div className="mb-3">
        <h2 className="type-subhead font-semibold text-text-primary">Account summary</h2>
        <p className="mt-0.5 type-caption text-text-tertiary">Values remain in the currencies supplied by the Hub.</p>
      </div>
      <DataTable columns={columns} data={visibleComponents} rowKey={(_, index) => String(index)} emptyMessage="No non-zero account balances were reported." />
    </section>
  )
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function HubLedgerHistory() {
  const [eventType, setEventType] = React.useState('')
  const [currency, setCurrency] = React.useState('')
  const { events, nextCursor, loading, loadingMore, error, loadMore } = usePortfolioHubLedger(true, {
    eventType: eventType || undefined,
    currency: currency.trim() || undefined,
  })
  const columns = React.useMemo<Column<HubLedgerEvent>[]>(() => [
    { key: 'time', header: 'Time', render: (row) => formatTimestamp(row.eventTime) },
    { key: 'type', header: 'Event', render: (row) => titleCase(row.eventType) },
    { key: 'instrument', header: 'Instrument', render: (row) => row.nativeInstrumentId ?? '—' },
    { key: 'amount', header: 'Amount', align: 'right', tabular: true, render: (row) => formatPortfolioValue(row.amount, row.currency) },
    { key: 'quantity', header: 'Quantity', align: 'right', tabular: true, render: (row) => formatPortfolioValue(row.quantity, row.quantityUnit, 'quantity') },
    { key: 'price', header: 'Price', align: 'right', tabular: true, render: (row) => formatPortfolioValue(row.price, row.priceCurrency, 'price') },
  ], [])
  return (
    <section className="rounded-2xl border border-border-default bg-bg-surface-1 p-5" aria-label="Ledger history">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="type-subhead font-semibold text-text-primary">Ledger history</h2>
          <p className="mt-0.5 type-caption text-text-tertiary">The latest 50 events are loaded first. Load more continues from the Hub cursor.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="hub-ledger-event-type">Event type</label>
          <select id="hub-ledger-event-type" value={eventType} onChange={(event) => setEventType(event.target.value)} className="rounded-lg border border-border-default bg-bg-canvas px-2.5 py-1.5 type-caption text-text-primary">
            <option value="">All events</option>
            {['trade', 'fee', 'rebate', 'funding', 'deposit', 'withdrawal', 'transfer', 'settlement', 'liquidation', 'interest', 'adjustment', 'other'].map((type) => <option key={type} value={type}>{titleCase(type)}</option>)}
          </select>
          <label className="sr-only" htmlFor="hub-ledger-currency">Currency</label>
          <input id="hub-ledger-currency" value={currency} onChange={(event) => setCurrency(event.target.value)} placeholder="Currency" className="w-24 rounded-lg border border-border-default bg-bg-canvas px-2.5 py-1.5 type-caption text-text-primary placeholder:text-text-tertiary" />
        </div>
      </div>
      {error && <p className="mb-3 type-caption text-status-danger">{error}</p>}
      {loading ? <div className="py-5 text-center type-caption text-text-secondary">Loading ledger history…</div> : <DataTable columns={columns} data={events} rowKey={(row) => row.id} emptyMessage="No ledger events match these filters." />}
      {nextCursor && (
        <div className="mt-4 text-center">
          <Button size="sm" variant="secondary" disabled={loadingMore} onClick={() => void loadMore()} leftIcon={loadingMore ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : undefined}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </section>
  )
}
