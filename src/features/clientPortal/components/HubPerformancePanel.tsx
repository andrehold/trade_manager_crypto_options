import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui'
import { Button } from '@/components/ui/Button'
import { decimalFrom } from '@/lib/portfolioDataHub/decimal'
import type { ExactDecimal, HubPerformance, HubPerformanceStatus } from '@/lib/portfolioDataHub'
import type { PortfolioHubPerformanceState } from '../usePortfolioDataHub'
import { formatPortfolioValue } from './portfolioFormatters'

const REASON_COPY: Record<string, string> = {
  policy_not_configured: 'Performance calculation is not configured for this account.',
  snapshot_time_approximate: 'The snapshot time is approximate, so these values may change.',
}

function formatTimestamp(value: string | null) {
  if (value === null) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, {
    dateStyle: 'medium', timeStyle: 'short',
  })
}

function stateBadge(status: HubPerformanceStatus) {
  if (status === 'ready') return <Badge variant="success">Ready</Badge>
  if (status === 'provisional') return <Badge variant="warning">Provisional</Badge>
  return <Badge variant="neutral">Unavailable</Badge>
}

function metricTone(value: ExactDecimal | null) {
  if (value === null || decimalFrom(value).isZero()) return undefined
  return decimalFrom(value).isNegative() ? 'text-status-danger' : 'text-status-success'
}

function PerformanceMetric({ label, value, currency, tone }: {
  label: string
  value: ExactDecimal | null
  currency: string | null
  tone?: string
}) {
  return (
    <div className="rounded-xl border border-border-default bg-bg-surface-1 p-3">
      <div className="type-caption uppercase tracking-wide text-text-tertiary">{label}</div>
      <div className={`mt-1 type-subhead font-semibold ${tone ?? 'text-text-primary'}`}>
        {formatPortfolioValue(value, currency)}
      </div>
    </div>
  )
}

function AvailabilityNotice({ kind, status }: { kind: 'Equity' | 'Performance'; status: HubPerformanceStatus }) {
  if (status === 'unavailable') {
    return <p className="type-caption text-text-secondary">{kind} unavailable. No value has been substituted.</p>
  }
  if (status === 'provisional') {
    return <p className="flex items-center gap-1.5 type-caption text-status-warning" role="status"><AlertTriangle className="h-3.5 w-3.5" />This value is provisional and may change.</p>
  }
  return null
}

function QualityProvenance({ data }: { data: HubPerformance }) {
  const { quality, lineage } = data
  const freshness = quality.freshness === 'fresh'
    ? 'Fresh'
    : quality.freshness === 'stale'
      ? 'Data may be stale'
      : 'Freshness unavailable'
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border-default bg-bg-surface-2 px-4 py-3" data-testid="hub-performance-provenance">
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 type-caption text-text-secondary">
        <span>{freshness}</span>
        {data.asOf && <span>As of {formatTimestamp(data.asOf)}</span>}
        {data.computedAt && <span>Computed {formatTimestamp(data.computedAt)}</span>}
        {data.reportingCurrency && <span>Values in {data.reportingCurrency}</span>}
      </div>
      {quality.recalculationPending && <div className="type-caption text-status-warning" role="status">Recalculation pending</div>}
      {quality.reasonCodes.length > 0 && (
        <ul className="list-disc pl-4 type-caption text-text-secondary" aria-label="Performance data notes">
          {quality.reasonCodes.map((reason, index) => <li key={`${reason}-${index}`}>{REASON_COPY[reason] ?? 'Additional performance data qualification is available.'}</li>)}
        </ul>
      )}
      {(quality.unresolvedMovementCount > 0 || lineage.policyRevision !== null || lineage.calculationVersion !== null) && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 type-caption text-text-tertiary">
          {quality.unresolvedMovementCount > 0 && <span>{quality.unresolvedMovementCount} unresolved movement{quality.unresolvedMovementCount === 1 ? '' : 's'}</span>}
          {lineage.policyRevision !== null && <span>Policy revision {lineage.policyRevision}</span>}
          {lineage.calculationVersion !== null && <span>Calculation {lineage.calculationVersion}</span>}
        </div>
      )}
    </div>
  )
}

function RefreshButton({ state, onRefresh }: { state: PortfolioHubPerformanceState; onRefresh: () => void }) {
  const rateLimited = state.retryAt !== null && state.retryAt > Date.now()
  const disabled = state.refreshing || !state.canRefresh
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" onClick={onRefresh} disabled={disabled} leftIcon={<RefreshCw className={`h-3.5 w-3.5 ${state.refreshing ? 'animate-spin' : ''}`} />}>
        {state.refreshing ? 'Refreshing…' : 'Refresh performance'}
      </Button>
      {rateLimited && <span className="type-caption text-text-tertiary">Refresh available {formatTimestamp(new Date(state.retryAt!).toISOString())}</span>}
    </div>
  )
}

/** A pure presentation boundary for normalized, account-scoped Hub performance data. */
export function HubPerformancePanel({ state, onRefresh }: {
  state: PortfolioHubPerformanceState
  onRefresh: () => void
}) {
  if (state.status === 'loading' && state.data === null) {
    return <section className="rounded-2xl border border-border-default bg-bg-surface-1 p-5" aria-labelledby="hub-performance-heading"><h2 id="hub-performance-heading" className="type-subhead font-semibold text-text-primary">Performance</h2><p className="mt-2 type-caption text-text-secondary" role="status">Loading performance data…</p></section>
  }

  if (state.data === null) {
    const message = state.status === 'not-configured'
      ? 'Performance data is not configured in this portal.'
      : 'Performance unavailable. No values have been substituted.'
    return (
      <section className="rounded-2xl border border-border-default bg-bg-surface-1 p-5" aria-labelledby="hub-performance-heading">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="hub-performance-heading" className="type-subhead font-semibold text-text-primary">Performance</h2><p className="mt-1 type-caption text-text-secondary" role="status">{message}</p></div><RefreshButton state={state} onRefresh={onRefresh} /></div>
        {state.refreshError && <p className="mt-3 type-caption text-status-danger" role="alert">Could not refresh performance data. Please try again manually.</p>}
      </section>
    )
  }

  const { data } = state
  const performance = data.performance
  return (
    <section className="rounded-2xl border border-border-default bg-bg-surface-1 p-5" aria-labelledby="hub-performance-heading" data-testid="hub-performance-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="hub-performance-heading" className="type-subhead font-semibold text-text-primary">Performance</h2><p className="mt-0.5 type-caption text-text-tertiary">Authoritative performance data from Portfolio Data Hub.</p></div>
        <RefreshButton state={state} onRefresh={onRefresh} />
      </div>
      {state.refreshError && <p className="mt-3 type-caption text-status-warning" role="alert">The last valid performance result is shown; the most recent refresh failed. Please try again manually.</p>}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border-default bg-bg-surface-2 p-4" aria-labelledby="hub-equity-heading">
          <div className="flex items-center justify-between gap-2"><h3 id="hub-equity-heading" className="type-subhead font-semibold text-text-primary">Equity</h3>{stateBadge(data.quality.equityStatus)}</div>
          <div className="mt-3"><AvailabilityNotice kind="Equity" status={data.quality.equityStatus} />{data.quality.equityStatus !== 'unavailable' && <PerformanceMetric label="Equity" value={data.equity} currency={data.reportingCurrency} />}</div>
        </section>
        <section className="rounded-xl border border-border-default bg-bg-surface-2 p-4" aria-labelledby="hub-performance-totals-heading">
          <div className="flex items-center justify-between gap-2"><h3 id="hub-performance-totals-heading" className="type-subhead font-semibold text-text-primary">Performance totals</h3>{stateBadge(data.quality.performanceStatus)}</div>
          <div className="mt-3"><AvailabilityNotice kind="Performance" status={data.quality.performanceStatus} />{data.quality.performanceStatus !== 'unavailable' && <div className="grid grid-cols-2 gap-3"><PerformanceMetric label="Opening equity" value={data.openingEquity} currency={data.reportingCurrency} /><PerformanceMetric label="P&L" value={performance?.pnl ?? null} currency={data.reportingCurrency} tone={metricTone(performance?.pnl ?? null)} /><PerformanceMetric label="Contributions" value={performance?.contributions ?? null} currency={data.reportingCurrency} /><PerformanceMetric label="Distributions" value={performance?.distributions ?? null} currency={data.reportingCurrency} /><PerformanceMetric label="Transfers in" value={performance?.transfersIn ?? null} currency={data.reportingCurrency} /><PerformanceMetric label="Transfers out" value={performance?.transfersOut ?? null} currency={data.reportingCurrency} /><PerformanceMetric label="Net capital flow" value={performance?.netCapitalFlow ?? null} currency={data.reportingCurrency} /></div>}</div>
        </section>
      </div>
      <div className="mt-4"><QualityProvenance data={data} /></div>
    </section>
  )
}
