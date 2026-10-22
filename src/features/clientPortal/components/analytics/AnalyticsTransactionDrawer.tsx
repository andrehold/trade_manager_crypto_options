import React from 'react'
import { createPortal } from 'react-dom'
import type { AnalyticsPair } from '@/lib/portfolioDataHub/analyticsClient'
import { Button } from '@/components/ui/Button'
import { useAnalyticsTransactions } from '../../useAnalyticsTransactions'
import { sameAnalyticsBuild } from '../../dashboard/analyticsDrillFilters'
import { AnalyticsCoverage, reasonCopy } from './AnalyticsCoverage'
import { AnalyticsTransactionTable } from './AnalyticsTransactionTable'
import { completenessText, metricText, metricUnit, METRIC_LABELS, partitionLabel, utcLabel, type AnalyticsResultSelection } from './analyticsPresentation'

export function AnalyticsTransactionDrawer({ selection, pair, originPair, trigger, onClose, refreshSummary, summaryRefreshing, summaryError, summaryCanRetry, summaryRetryAt }: {
  selection: AnalyticsResultSelection
  pair: AnalyticsPair
  originPair: AnalyticsPair
  trigger: HTMLElement | SVGElement | null
  onClose: () => void
  refreshSummary: () => void
  summaryRefreshing: boolean
  summaryError: string | null
  summaryCanRetry: boolean
  summaryRetryAt: number | null
}) {
  const details = useAnalyticsTransactions(selection, pair, refreshSummary)
  const root = React.useRef<HTMLDivElement>(null)
  const initial = React.useRef<HTMLElement>(null)
  const closeRef = React.useRef(onClose)
  closeRef.current = onClose
  const id = React.useId()
  const { group, metric, window } = selection
  const cell = group.metrics[metric]
  const page = details.sequence?.page
  const changedSummary = !sameAnalyticsBuild(originPair.totals.coverage, pair.totals.coverage, true)
  const incompleteEvidence = page && (page.coverage.derivedAt === null || page.coverage.normalizationVersion === null
    || pair.totals.coverage.derivedAt === null || pair.totals.coverage.normalizationVersion === null)

  // Loading/end-of-results can remove the focused pagination button.
  React.useEffect(() => {
    if (root.current && !root.current.contains(document.activeElement)) initial.current?.focus()
  }, [details.status])

  React.useEffect(() => {
    const container = root.current!
    const siblings = [...document.body.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child !== container)
    const prior = siblings.map((child) => ({ child, inert: child.inert }))
    for (const { child } of prior) child.inert = true
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    initial.current?.focus()
    const focusables = () => [...container.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')]
      .filter((element) => {
        for (let parent = element.parentElement; parent && parent !== container; parent = parent.parentElement) {
          if (parent instanceof HTMLDetailsElement && !parent.open && parent.querySelector('summary') !== element) return false
        }
        return true
      })
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const nodes = focusables()
      const first = nodes[0], last = nodes[nodes.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === initial.current || !container.contains(active))) { event.preventDefault(); (last ?? initial.current)?.focus() }
      else if (!event.shiftKey && (active === last || !container.contains(active))) { event.preventDefault(); (first ?? initial.current)?.focus() }
    }
    const focusin = (event: FocusEvent) => { if (!container.contains(event.target as Node)) initial.current?.focus() }
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('focusin', focusin)
    return () => {
      document.removeEventListener('keydown', keydown, true)
      document.removeEventListener('focusin', focusin)
      for (const { child, inert } of prior) child.inert = inert
      document.body.style.overflow = overflow
      if (trigger?.isConnected) trigger.focus()
    }
  }, [trigger])

  return createPortal(<div ref={root} className="fixed inset-0 z-modal">
    <div className="absolute inset-0 bg-bg-overlay" onClick={onClose} aria-hidden="true" />
    <div role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className="absolute inset-y-0 right-0 flex w-full max-w-5xl flex-col border-l border-border-default bg-bg-surface-1 shadow-xl">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border-default px-4 py-4 sm:px-6"><h2 id={`${id}-title`} className="type-title-m text-text-primary">Contributing transactions</h2><Button size="sm" variant="ghost" onClick={onClose}>Close result details</Button></header>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6">
        <section ref={initial} tabIndex={-1} role="region" aria-label="Trading result details" className="outline-none focus-visible:ring-2 focus-visible:ring-accent-500">
          <h3 className="type-subhead font-semibold text-text-primary">{METRIC_LABELS[metric] ?? metric}{group.dimensions.day ? ` · ${group.dimensions.day} UTC` : group.dimensions.month ? ` · ${group.dimensions.month} UTC` : ''}</h3>
          <p className="mt-2 break-all type-title-m tabular-nums text-text-primary">{metricText(cell)}{cell?.value != null ? ` ${metricUnit(metric, group.dimensions)}` : ''}</p>
          {metric === 'calculated_realized_gross_profit' && <p className="mt-1 type-caption text-text-secondary">Before fees and funding</p>}
          {completenessText(cell) && <p className="mt-1 type-caption text-status-warning">{completenessText(cell)}</p>}
          <p className="mt-2 break-words type-caption text-text-secondary">{partitionLabel(group.dimensions)}</p>
          <p className="mt-1 type-caption text-text-tertiary">Original trading period: {utcLabel(window.start)} to {utcLabel(window.end)} (end exclusive).</p>
          {details.filters && <p className="mt-1 type-caption text-text-secondary">Transaction window: {utcLabel(details.filters.start)} to {utcLabel(details.filters.end)} (end exclusive).</p>}
          <p className="mt-1 type-caption text-text-secondary">{cell?.eligibleCount ?? 0} eligible components · {cell?.missingCount ?? 0} missing. Component counts are not execution counts.</p>
          {cell?.notes.map((note, index) => <p key={index} className="mt-2 break-words type-caption text-text-secondary">{reasonCopy(note)}{reasonCopy(note) !== note && <span className="ml-1 break-all text-text-tertiary">({note})</span>}</p>)}
          {metric === 'net_funding' && group.metrics.source_reported_funding && <details className="mt-3 type-caption text-text-secondary"><summary className="cursor-pointer">Source-reported funding comparison</summary><p className="mt-1 break-all tabular-nums">{metricText(group.metrics.source_reported_funding)} {group.dimensions.currency ?? 'Unknown currency'}. Comparison context; not substituted for verified funding.</p></details>}
          {details.filters && <details className="mt-3 type-caption text-text-secondary"><summary className="cursor-pointer">Exact transaction filters</summary><dl>{Object.entries(details.filters).map(([name, value]) => <div key={name} className="mt-1"><dt>{name}</dt><dd className="break-all">{String(value)}</dd></div>)}</dl></details>}
        </section>
        {changedSummary && <p role="status" className="type-caption text-status-warning">The summary was refreshed to a different build. The selected value above is an older snapshot; these transaction results do not reconcile to that old cell. Close and select the refreshed metric to inspect its value.</p>}
        {details.previous && <p role="status" className="type-caption text-status-warning">Previous results: a completed sequence for this exact context. They are not combined with replacement pages.</p>}
        {(details.status === 'loading' || details.status === 'restarting') && <p role="status" className="type-caption text-text-secondary">{details.status === 'restarting' ? 'Restarting transaction details from page one…' : 'Loading contributing transactions…'}</p>}
        {details.status === 'awaiting-summary' && <div role="status" className="type-caption text-status-warning"><p>Transaction results changed. Discarded the in-progress pages; refreshing the original summary before one restart from page one.</p>
          {!summaryRefreshing && <><p>{summaryError ?? 'Waiting for a refreshed summary.'}</p>{summaryRetryAt !== null && <p>Summary retry available after {utcLabel(new Date(summaryRetryAt).toISOString())}.</p>}<Button size="sm" variant="secondary" disabled={!summaryCanRetry} onClick={refreshSummary}>Retry summary refresh</Button></>}
        </div>}
        {details.error && <div role="alert" className="type-caption text-status-danger"><p>{details.error}</p>{!details.blocked && <Button size="sm" variant="secondary" disabled={details.retryAt !== null && details.retryAt > Date.now()} onClick={details.retry}>Retry transaction details</Button>}{details.retryAt !== null && <p>Retry available after {utcLabel(new Date(details.retryAt).toISOString())}.</p>}</div>}
        {page && <AnalyticsCoverage coverage={page.coverage} limitations={incompleteEvidence ? ['Build comparison evidence is incomplete. Matching summary and transaction builds cannot be verified.'] : []} />}
        {details.sequence && <>
          <AnalyticsTransactionTable rows={details.sequence.rows} metric={metric} />
          <p className="type-caption text-text-tertiary">{details.sequence.rows.length} contributing rows loaded. Rows and component counts can differ.</p>
          {details.status === 'ready' && (page?.nextCursor !== null ? <Button size="sm" variant="secondary" onClick={details.loadMore}>Load more transactions</Button> : <p role="status" className="type-caption text-text-secondary">End of results in available history.{details.sequence.rows.length === 0 ? ' No matching eligible transactions were reported; this does not certify a zero result.' : ''}</p>)}
        </>}
      </div>
    </div>
  </div>, document.body)
}
