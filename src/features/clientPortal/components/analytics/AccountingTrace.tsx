import type { HubAnalyticsTransaction } from '@/lib/portfolioDataHub'
import { reasonCopy } from './AnalyticsCoverage'
import { dimensionLabel } from './analyticsPresentation'

const accountingFields = [
  ['method', 'Method'], ['quantityBefore', 'Quantity before'], ['quantityAfter', 'Quantity after'],
  ['costBasisBefore', 'Cost basis before'], ['costBasisAfter', 'Cost basis after'],
  ['averagePriceBefore', 'Average price before'], ['averagePriceAfter', 'Average price after'],
  ['openedQuantity', 'Opened quantity'], ['closedQuantity', 'Closed quantity'],
  ['executionPrice', 'Execution price'], ['grossProfit', 'Gross profit before fees and funding'],
  ['settlementCashValue', 'Settlement cash value'], ['settlementReferencePrice', 'Settlement reference price'],
  ['sourceReportedProfit', 'Source-reported profit (comparison)'], ['comparisonDifference', 'Comparison difference'],
] as const

export function AccountingTrace({ row }: { row: HubAnalyticsTransaction }) {
  const trace = row.accounting
  return <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border-subtle bg-bg-surface-2 p-3 type-caption text-text-secondary">
    <p>Accounting explanation supplied by the portfolio service. Values are not recalculated in this portal.</p>
    {!trace ? <p>No accounting trace was supplied for this transaction.</p> : <>
      <p>Status: {trace.status} · Contract family: {trace.contractFamily}</p>
      <p>{dimensionLabel(trace.currency, 'accounting currency')} · {dimensionLabel(trace.quantityUnit, 'accounting quantity unit')}</p>
      <dl className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        {accountingFields.filter(([key]) => trace[key] !== undefined).map(([key, label]) => <div key={key} className="min-w-0"><dt className="text-text-tertiary">{label}</dt><dd className="break-all tabular-nums text-text-primary">{trace[key] === null ? 'Unavailable' : String(trace[key])}</dd></div>)}
      </dl>
      {[...new Set([...trace.reasonCodes, ...trace.notes])].map((reason) => <p key={reason}>{reasonCopy(reason)} <span className="break-all text-text-tertiary">({reason})</span></p>)}
      {trace.orderKey.length > 0 && <p className="break-all">Accounting order: {trace.orderKey.join(' · ')}</p>}
      {trace.reconciliation && <details><summary className="cursor-pointer">Reconciliation context</summary><dl>{Object.entries(trace.reconciliation).map(([key, value]) => <div key={key} className="mt-2"><dt className="break-all">{key}</dt><dd className="break-all tabular-nums">{value ?? 'Unavailable'}</dd></div>)}</dl></details>}
    </>}
    <details><summary className="cursor-pointer">Source and comparison context</summary>
      <dl className="mt-2 grid min-w-0 gap-2 sm:grid-cols-2">
        {[
          ['Side', row.side], ['Quantity', row.quantity], ['Quantity unit', row.quantityUnit], ['Execution price', row.executionPrice], ['Price currency', row.priceCurrency],
          ['Canonical amount', row.canonicalAmount], ['Canonical currency', row.canonicalCurrency], ['Canonical quantity', row.canonicalQuantity], ['Canonical quantity unit', row.canonicalQuantityUnit],
          ['Source-reported profit', row.metrics.source_reported_profit], ['Source-reported funding', row.metrics.source_reported_funding],
          ['Source endpoint', row.sourceEndpoint], ['Transaction ID', row.id], ['Venue event ID', row.venueEventIdentifier], ['Trade ID', row.tradeIdentifier], ['Order ID', row.orderIdentifier], ['Source batch', row.sourceRawBatchId],
        ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-text-tertiary">{label}</dt><dd className="break-all tabular-nums">{value ?? 'Unavailable'}</dd></div>)}
      </dl>
    </details>
    {row.notes.map((note, index) => <p key={index} className="break-words">{reasonCopy(note)}{reasonCopy(note) !== note && <span className="ml-1 break-all text-text-tertiary">({note})</span>}</p>)}
  </div>
}
