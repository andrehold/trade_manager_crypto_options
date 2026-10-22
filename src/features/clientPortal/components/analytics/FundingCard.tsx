import type { HubAnalyticsGroup } from '@/lib/portfolioDataHub'
import { decimalFrom } from '@/lib/portfolioDataHub/decimal'
import { AnalyticsMetricValue } from './AnalyticsMetricValue'
import { cardClass, type InspectMetric } from './analyticsPresentation'

export function FundingCard({ group, onInspect }: { group: HubAnalyticsGroup; onInspect: InspectMetric }) {
  const funding = group.metrics.net_funding?.value
  const partial = (group.metrics.net_funding?.missingCount ?? 0) > 0
  const direction = funding == null || group.metrics.net_funding?.eligibleCount === 0 ? null
    : decimalFrom(funding).isZero() ? (partial ? 'Zero available subtotal' : 'No net funding')
      : `${decimalFrom(funding).isNegative() ? 'Paid' : 'Received'}${partial ? ' · available subtotal' : ''}`
  return <section className={cardClass} aria-label="Funding">
    <h4 className="type-subhead font-semibold text-text-primary">Funding</h4>
    <p className="mb-3 mt-1 type-caption text-text-tertiary">Verified signed net funding</p>
    <AnalyticsMetricValue metric="net_funding" group={group} onInspect={onInspect} />
    {direction && <p className="mt-1 type-caption text-text-secondary">{direction}</p>}
    {funding === null && <p className="mt-2 type-caption text-text-tertiary">The verified amount or direction is unavailable. Inspect the result for source notes.</p>}
  </section>
}
