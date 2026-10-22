import React from 'react'
import type { AnalyticsMetricName, HubAnalyticsTransaction } from '@/lib/portfolioDataHub'
import { AccountingTrace } from './AccountingTrace'
import { reasonCopy } from './AnalyticsCoverage'
import { dimensionLabel, METRIC_LABELS, metricUnit, utcLabel } from './analyticsPresentation'

export function AnalyticsTransactionTable({ rows, metric }: { rows: HubAnalyticsTransaction[]; metric: AnalyticsMetricName }) {
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set())
  const id = React.useId()
  return <div className="min-w-0 shrink-0 overflow-x-auto rounded-xl border border-border-default" tabIndex={0} role="region" aria-label="Contributing transaction table">
    <table className="w-full table-fixed text-left type-caption text-text-secondary">
      <caption className="p-3 text-left">Contributing transactions · {METRIC_LABELS[metric] ?? metric}. Unavailable eligible values remain included.</caption>
      <thead className="hidden border-b border-border-default text-text-tertiary sm:table-header-group"><tr><th scope="col" className="w-1/3 p-3">Time · instrument</th><th scope="col" className="w-1/3 p-3">Category · value · units</th><th scope="col" className="p-3">Explanation</th></tr></thead>
      <tbody>{rows.map((row) => <React.Fragment key={row.id}><tr className="block border-t border-border-subtle sm:table-row" data-transaction-id={row.id}>
        <td className="block min-w-0 break-words px-3 py-2 align-top sm:table-cell"><time dateTime={row.eventTime}>{utcLabel(row.eventTime)}</time><div className="mt-1 break-all text-text-primary">{dimensionLabel(row.instrument, 'instrument')}</div></td>
        <td className="block min-w-0 px-3 py-2 align-top sm:table-cell"><div className="capitalize">{row.category}</div><div className="mt-1 break-all tabular-nums text-text-primary">{row.metrics[metric] ?? 'Unavailable'}</div><div className="mt-1 break-all">{metricUnit(metric, { currency: row.currency, denomination: row.denomination, quantityUnit: row.quantityUnit })}</div><div className="mt-1 break-all text-text-tertiary">Denomination: {row.denomination}</div><div className="mt-1 break-all text-text-tertiary">Quantity unit: {dimensionLabel(row.quantityUnit, 'quantity unit')}</div></td>
        <td className="block min-w-0 px-3 py-2 align-top sm:table-cell">
          {row.missingData[metric] && <p className="mb-2 text-status-warning">{reasonCopy(row.missingData[metric])}<span className="ml-1 break-all text-text-tertiary">({row.missingData[metric]})</span></p>}
          {row.metrics[metric] === null && !row.missingData[metric] && <p className="mb-2 text-status-warning">A reason for this unavailable value was not supplied.</p>}
          <button type="button" className="rounded text-left text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500" aria-expanded={expanded.has(row.id)} aria-controls={`${id}-${row.id}`} onClick={() => setExpanded((previous) => {
            const next = new Set(previous)
            if (next.has(row.id)) next.delete(row.id); else next.add(row.id)
            return next
          })}>{expanded.has(row.id) ? 'Hide accounting explanation' : 'Accounting explanation'}<span className="sr-only"> for transaction {row.id}</span></button>
        </td>
      </tr>{expanded.has(row.id) && <tr className="block sm:table-row"><td colSpan={3} className="block p-3 sm:table-cell"><div id={`${id}-${row.id}`}><AccountingTrace row={row} /></div></td></tr>}</React.Fragment>)}</tbody>
    </table>
  </div>
}
