import type { HubAnalyticsGroup } from '@/lib/portfolioDataHub'
import { AnalyticsMetricValue } from './AnalyticsMetricValue'
import { cardClass, METRIC_LABELS, type InspectMetric } from './analyticsPresentation'
const metrics = ['execution_count', 'executed_quantity', 'premium_turnover', 'notional_turnover'] as const
export function TradingActivityCard({ group, onInspect }: { group: HubAnalyticsGroup; onInspect: InspectMetric }) {
  return <section className={cardClass} aria-label="Trading activity">
    <h4 className="type-subhead font-semibold text-text-primary">Trading activity</h4>
    <dl className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
      {metrics.map((name) => <div key={name}><dt className="mb-1 type-caption text-text-tertiary">{METRIC_LABELS[name]}</dt><dd><AnalyticsMetricValue metric={name} group={group} onInspect={onInspect} /></dd></div>)}
    </dl>
  </section>
}
