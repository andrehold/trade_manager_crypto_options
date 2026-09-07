import type { HubSummary } from '@/lib/portfolioDataHub'
import type { ExactDecimal } from '@/lib/portfolioDataHub/schemas'
import {
  buildCurrencyMetricSeries,
  resolveCurrencyMetric,
  type AccountCurrencyMetricKey,
  type CurrencyMetricPoint,
} from '../../dashboard/accountCurrency'
import { formatPortfolioValue } from '../portfolioFormatters'
import { AreaChart } from './AreaChart'
import { CHART_COLORS } from '../../dashboard/chartTheme'

type MetricKey = Extract<AccountCurrencyMetricKey, 'equity' | 'realizedPnl' | 'unrealizedPnl'>

const METRICS: Array<{ key: MetricKey; label: string; color: string }> = [
  { key: 'equity', label: 'Equity', color: CHART_COLORS.accent },
  { key: 'realizedPnl', label: 'Realized P&L', color: CHART_COLORS.sky },
  { key: 'unrealizedPnl', label: 'Unrealized P&L', color: CHART_COLORS.good },
]

function TrendCard({ label, current, currency, data, color, testId }: {
  label: string
  current: ExactDecimal | null
  currency: string
  data: CurrencyMetricPoint[]
  color: string
  testId: string
}) {
  const numericPointCount = data.reduce((count, point) => count + (point.v === null ? 0 : 1), 0)
  return (
    <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-4">
      <div className="type-caption font-semibold text-text-secondary">{label}</div>
      <div className="mt-1 type-title-l font-bold text-text-primary">{formatPortfolioValue(current, currency)}</div>
      <div className="mt-0.5 type-caption text-text-tertiary">Last 30 days · API snapshots</div>
      {numericPointCount > 1 ? (
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

export function HubPerformanceTrends({ history, current, currency }: {
  history: HubSummary[]
  current: HubSummary
  currency: string
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-3" data-testid="hub-performance-trends">
      {METRICS.map((metric) => (
        <TrendCard
          key={metric.key}
          label={metric.label}
          current={resolveCurrencyMetric(current.components, currency, metric.key)}
          currency={currency}
          data={buildCurrencyMetricSeries(history, current, currency, metric.key)}
          color={metric.color}
          testId={`hub-${metric.key}-trend`}
        />
      ))}
    </div>
  )
}
