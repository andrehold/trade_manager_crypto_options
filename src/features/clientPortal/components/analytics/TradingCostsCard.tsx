import type { HubAnalyticsGroup } from '@/lib/portfolioDataHub'
import { decimalFrom } from '@/lib/portfolioDataHub/decimal'
import { AnalyticsMetricValue } from './AnalyticsMetricValue'
import { cardClass, type InspectMetric } from './analyticsPresentation'

export function TradingCostsCard({ group, onInspect }: { group: HubAnalyticsGroup; onInspect: InspectMetric }) {
  const cost = group.metrics.net_trading_cost?.value
  const partial = (group.metrics.net_trading_cost?.missingCount ?? 0) > 0
  const qualifier = cost == null || group.metrics.net_trading_cost?.eligibleCount === 0 ? null
    : decimalFrom(cost).isZero() ? (partial ? 'Zero available subtotal' : 'No net expense')
      : `${decimalFrom(cost).isNegative() ? 'Net rebate' : 'Net expense'}${partial ? ' · available subtotal' : ''}`
  return <section className={cardClass} aria-label="Trading costs">
    <h4 className="type-subhead font-semibold text-text-primary">Trading costs</h4>
    <div className="mt-3"><AnalyticsMetricValue metric="net_trading_cost" group={group} onInspect={onInspect} /></div>
    {qualifier && <p className="mt-1 type-caption text-text-tertiary">{qualifier}</p>}
    <dl className="mt-4 flex flex-col gap-3 border-t border-border-default pt-3">
      <div><dt className="mb-1 type-caption text-text-tertiary">Fee expense</dt><dd><AnalyticsMetricValue metric="fee_expense" group={group} onInspect={onInspect} /></dd></div>
      <div><dt className="mb-1 type-caption text-text-tertiary">Rebates</dt><dd><AnalyticsMetricValue metric="rebates" group={group} onInspect={onInspect} /></dd></div>
    </dl>
  </section>
}
