import React from 'react'
import type { HubAnalyticsGroup } from '@/lib/portfolioDataHub'
import type { AnalyticsPair } from '@/lib/portfolioDataHub/analyticsClient'
import type { usePortfolioHubAnalytics } from '../../usePortfolioHubAnalytics'
import { useDashboardAnalytics } from '../../PortfolioHubAnalyticsProvider'
import { Button } from '@/components/ui/Button'
import { AnalyticsPeriodControl } from './AnalyticsPeriodControl'
import { AnalyticsCoverage } from './AnalyticsCoverage'
import { AnalyticsMetricValue } from './AnalyticsMetricValue'
import { FundingCard } from './FundingCard'
import { TradingCostsCard } from './TradingCostsCard'
import { TradingActivityCard } from './TradingActivityCard'
import { RealizedProfitChart } from './RealizedProfitChart'
import { AnalyticsTransactionDrawer } from './AnalyticsTransactionDrawer'
import { analyticsQueryKey } from '@/lib/portfolioDataHub/analyticsClient'
import { cardClass, currencyKey, dimensionLabel, partitionKey, partitionLabel, profitTone, utcLabel, type AnalyticsResultSelection, type InspectMetric } from './analyticsPresentation'

export function TradingAnalyticsSection({ accountCurrency }: { accountCurrency?: string | null }) {
  const analytics = useDashboardAnalytics()
  return <TradingAnalyticsView analytics={analytics} accountCurrency={accountCurrency} />
}

/** Pure view keeps fixture/demo evidence out of live loading and failure paths. */
export function TradingAnalyticsView({ analytics, accountCurrency }: { analytics: ReturnType<typeof usePortfolioHubAnalytics>; accountCurrency?: string | null }) {
  const { state, period, window, refresh, retry, setPeriod } = analytics
  const data = state.data
  const [choice, setChoice] = React.useState<{ accountId: string; key: string } | null>(null)
  const [selected, setSelected] = React.useState<{ pair: AnalyticsPair; result: AnalyticsResultSelection } | null>(null)
  const selectionTrigger = React.useRef<HTMLElement | SVGElement | null>(null)
  const currencyMap = new Map<string, string | null>()
  for (const group of [...(data?.totals.groups ?? []), ...(data?.daily.groups ?? [])]) currencyMap.set(currencyKey(group.dimensions.currency), group.dimensions.currency)
  const currencies = [...currencyMap].sort(([a], [b]) => a.localeCompare(b))
  const preferred = accountCurrency != null && currencyMap.has(currencyKey(accountCurrency)) ? currencyKey(accountCurrency) : currencies.length === 1 ? currencies[0][0] : null
  const selectedCurrency = choice?.accountId === data?.accountId && choice !== null && currencyMap.has(choice.key) ? choice.key : preferred
  const groups = data?.totals.groups.filter((group) => currencyKey(group.dimensions.currency) === selectedCurrency) ?? []
  const daily = data?.daily.groups.filter((group) => currencyKey(group.dimensions.currency) === selectedCurrency) ?? []
  const partitions = new Map<string, { dimensions: HubAnalyticsGroup['dimensions']; totals: HubAnalyticsGroup[]; days: HubAnalyticsGroup[] }>()
  for (const [kind, items] of [['totals', groups], ['days', daily]] as const) for (const group of items) {
    const key = partitionKey(group.dimensions)
    const partition = partitions.get(key) ?? { dimensions: group.dimensions, totals: [], days: [] }
    partition[kind].push(group); partitions.set(key, partition)
  }
  const inspect: InspectMetric = (metric, group) => {
    const trigger = document.activeElement
    selectionTrigger.current = trigger instanceof HTMLElement || trigger instanceof SVGElement ? trigger : null
    if (data) setSelected({ pair: data, result: { metric, group, window: { ...data.window }, filters: { ...data.filters } } })
  }
  const active = selected && data && selected.pair.accountId === data.accountId
    && analyticsQueryKey(selected.pair.window, selected.pair.filters) === analyticsQueryKey(data.window, data.filters)
    && currencyKey(selected.result.group.dimensions.currency) === selectedCurrency ? selected : null
  React.useEffect(() => { if (selected && !active) setSelected(null) }, [selected, active])
  const id = React.useId()
  return <section className="flex min-w-0 flex-col gap-4" aria-labelledby={`${id}-heading`} data-testid="trading-analytics-section">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id={`${id}-heading`} className="type-subhead font-semibold text-text-primary">Trading results</h2><p className="mt-1 type-caption text-text-secondary">Transaction-based profit, costs, funding and execution activity.</p></div>
      <Button size="sm" variant="secondary" disabled={!state.canRetry || state.refreshing} onClick={refresh}>{state.refreshing ? 'Refreshing trading results…' : 'Refresh trading results'}</Button>
    </div>
    <AnalyticsPeriodControl period={period} window={window} onChange={setPeriod} />
    {state.status === 'loading' && !data && <p role="status" className="type-caption text-text-secondary">Loading trading results…</p>}
    {state.status === 'not-configured' && <p role="status" className="type-caption text-text-secondary">Trading analytics is not configured in this portal.</p>}
    {state.error && <div role="alert" className="rounded-xl border border-status-danger/30 bg-status-danger/10 p-4 type-caption text-status-danger">{state.error}{state.canRetry && <div className="mt-2"><Button size="sm" onClick={retry}>Retry trading results</Button></div>}</div>}
    {state.retryAt !== null && <p role="status" className="type-caption text-text-tertiary">Manual retry available after {utcLabel(new Date(state.retryAt).toISOString())}.</p>}
    {state.refreshError && <p role="alert" className="rounded-xl border border-status-warning/30 bg-status-warning/10 p-3 type-caption text-status-warning">Previous completed results shown. Refresh failed: {state.refreshError}{state.canRetry && <Button size="sm" variant="ghost" onClick={retry}>Retry trading results</Button>}</p>}
    {data && <>
      <AnalyticsCoverage coverage={data.totals.coverage} limitations={data.consistencyLimitations} />
      {state.status === 'pending' && <p role="status" className="type-caption text-text-secondary">Awaiting transaction processing. Missing results have not been replaced with zero.</p>}
      {currencies.length > 0 && <div>
        <label className="flex max-w-xs flex-col gap-1 type-caption text-text-secondary" htmlFor={`${id}-currency`}>Analytics currency
          <select id={`${id}-currency`} className="min-w-0 rounded-lg border border-border-default bg-bg-surface-2 px-3 py-2 text-text-primary" value={selectedCurrency ?? ''} onChange={(event) => {
            setSelected(null); setChoice(event.target.value === '' ? null : { accountId: data.accountId, key: event.target.value })
          }}>
            {selectedCurrency === null && <option value="">Choose analytics currency</option>}
            {currencies.map(([key, currency]) => <option key={key} value={key}>{dimensionLabel(currency, 'currency')}</option>)}
          </select>
        </label>
        {selectedCurrency === null && <p className="mt-1 type-caption text-text-secondary">Several currencies are available. Choose one to inspect its separate partitions.</p>}
      </div>}
      {currencies.length === 0 && state.status !== 'pending' && <p className="rounded-xl border border-dashed border-border-default p-5 type-caption text-text-secondary">No matching records in available history. This is not a verified zero result.</p>}
      {[...partitions].map(([key, partition]) => <section key={key} className="flex min-w-0 flex-col gap-3" aria-label={`Analytics partition: ${partitionLabel(partition.dimensions)}`}>
        <h3 className="break-words type-caption font-medium text-text-secondary">{partitionLabel(partition.dimensions)}</h3>
        {partition.totals.length === 0 && <p className="type-caption text-text-secondary">No period-total group was reported for this partition. Daily bars are not summed into a total.</p>}
        {partition.totals.map((group, index) => <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-4" key={index}>
          <section className={cardClass} aria-label="Realized trading profit"><h4 className="type-subhead font-semibold text-text-primary">Realized trading profit</h4><p className="mb-3 mt-1 type-caption text-text-tertiary">Before fees and funding</p><AnalyticsMetricValue metric="calculated_realized_gross_profit" group={group} onInspect={inspect} tone={profitTone(group.metrics.calculated_realized_gross_profit?.value)} /></section>
          <TradingCostsCard group={group} onInspect={inspect} /><FundingCard group={group} onInspect={inspect} /><TradingActivityCard group={group} onInspect={inspect} />
        </div>)}
        <RealizedProfitChart groups={partition.days} window={data.window} onInspect={inspect} />
      </section>)}
      {active && <AnalyticsTransactionDrawer selection={active.result} originPair={active.pair} pair={data} trigger={selectionTrigger.current} onClose={() => setSelected(null)} refreshSummary={retry} summaryRefreshing={state.refreshing} summaryError={state.refreshError ?? state.error} summaryCanRetry={state.canRetry} summaryRetryAt={state.retryAt} />}
    </>}
  </section>
}
