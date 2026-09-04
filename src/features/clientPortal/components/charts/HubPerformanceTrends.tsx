import type { HubSummary, HubSummaryComponent } from '@/lib/portfolioDataHub'
import type { ExactDecimal } from '@/lib/portfolioDataHub/schemas'
import { decimalFrom } from '@/lib/portfolioDataHub/decimal'
import { formatPortfolioValue } from '../portfolioFormatters'
import { AreaChart } from './AreaChart'
import { CHART_COLORS } from '../../dashboard/chartTheme'

type MetricKey = 'equity' | 'realizedPnl' | 'unrealizedPnl'

const METRICS: Array<{ key: MetricKey; label: string; color: string }> = [
  { key: 'equity', label: 'Equity', color: CHART_COLORS.accent },
  { key: 'realizedPnl', label: 'Realized P&L', color: CHART_COLORS.sky },
  { key: 'unrealizedPnl', label: 'Unrealized P&L', color: CHART_COLORS.good },
]

function componentAtSnapshot(
  summary: HubSummary,
  currency: string,
  componentScope: string,
  metric: MetricKey,
): HubSummaryComponent | null {
  const exact = summary.components.find((item) => (
    item.currency.trim().toUpperCase() === currency && item.componentScope === componentScope
  ))
  if (exact?.[metric] != null) return exact
  return summary.components.find((item) => (
    item.currency.trim().toUpperCase() === currency && item[metric] != null
  )) ?? exact ?? null
}

export function hubMetricSeries(
  history: HubSummary[],
  current: HubSummary,
  component: HubSummaryComponent,
  metric: MetricKey,
) {
  const snapshots = new Map(history.map((summary) => [summary.fetchedAt, summary]))
  snapshots.set(current.fetchedAt, current)
  const currency = component.currency.trim().toUpperCase()
  return [...snapshots.values()]
    .sort((left, right) => Date.parse(left.fetchedAt) - Date.parse(right.fetchedAt))
    .flatMap((summary) => {
      const value = componentAtSnapshot(summary, currency, component.componentScope, metric)?.[metric]
      if (value == null) return []
      return [{ t: summary.fetchedAt.slice(0, 10), v: decimalFrom(value).toNumber() }]
    })
}

function TrendCard({ label, current, currency, data, color, testId }: {
  label: string
  current: ExactDecimal | null
  currency: string
  data: Array<{ t: string; v: number }>
  color: string
  testId: string
}) {
  return (
    <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-4">
      <div className="type-caption font-semibold text-text-secondary">{label}</div>
      <div className="mt-1 type-title-l font-bold text-text-primary">{formatPortfolioValue(current, currency)}</div>
      <div className="mt-0.5 type-caption text-text-tertiary">Last 30 days · API snapshots</div>
      {data.length > 1 ? (
        <div className="mt-3">
          <AreaChart
            data={data}
            color={color}
            height={144}
            zeroBaseline={label !== 'Equity'}
            formatValue={(value) => formatPortfolioValue(String(value) as ExactDecimal, currency)}
            testId={testId}
          />
        </div>
      ) : (
        <div className="mt-3 grid h-36 place-items-center rounded-xl border border-dashed border-border-default bg-bg-canvas/40 px-4 text-center type-caption text-text-tertiary">
          Trend appears after a second historical snapshot is available.
        </div>
      )}
    </div>
  )
}

export function HubPerformanceTrends({ history, current, component }: {
  history: HubSummary[]
  current: HubSummary
  component: HubSummaryComponent
}) {
  const currency = component.currency.trim().toUpperCase()
  return (
    <div className="grid gap-3 lg:grid-cols-3" data-testid="hub-performance-trends">
      {METRICS.map((metric) => (
        <TrendCard
          key={metric.key}
          label={metric.label}
          current={component[metric.key]}
          currency={currency}
          data={hubMetricSeries(history, current, component, metric.key)}
          color={metric.color}
          testId={`hub-${metric.key}-trend`}
        />
      ))}
    </div>
  )
}
