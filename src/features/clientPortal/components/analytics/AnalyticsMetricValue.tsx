import type { AnalyticsMetricName } from '@/lib/portfolioDataHub'
import type { HubAnalyticsGroup } from '@/lib/portfolioDataHub'
import { completenessText, metricText, metricUnit, METRIC_LABELS, type InspectMetric } from './analyticsPresentation'

export function AnalyticsMetricValue({ metric: name, group, onInspect, tone = 'text-text-primary' }: {
  metric: AnalyticsMetricName; group: HubAnalyticsGroup; onInspect: InspectMetric; tone?: string
}) {
  const metric = group.metrics[name]
  const label = METRIC_LABELS[name] ?? name
  const text = metricText(metric)
  const unit = metricUnit(name, group.dimensions)
  const available = metric?.value != null && metric.eligibleCount > 0
  const partial = completenessText(metric)
  const eligible = metric !== undefined && metric.eligibleCount > 0
  return <div className="min-w-0">
    {eligible ? <button type="button" className={`max-w-full break-all text-left font-semibold tabular-nums underline decoration-border-default underline-offset-4 hover:decoration-current focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500 ${tone}`} title={`${label}: ${text}${available ? ` ${unit}` : ''}${partial ? ` · ${partial}` : ''}`} aria-label={`${label}: ${text}${available ? ` ${unit}` : ''}${partial ? ` · ${partial}` : ''}. Inspect result`} onClick={() => onInspect(name, group)}>
      <span className={`block ${text.length > 18 ? 'text-base leading-snug' : 'type-title-m'}`}>{text}</span>{available && <span className="mt-1 block text-sm font-medium text-text-secondary">{' '}{unit}</span>}
    </button> : <span className="type-subhead text-text-tertiary">{text}</span>}
    {partial && <p className="mt-1 type-caption text-status-warning">{partial}</p>}
  </div>
}
