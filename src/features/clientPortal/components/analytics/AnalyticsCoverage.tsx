import type { HubAnalyticsCoverage } from '@/lib/portfolioDataHub'
import { utcLabel } from './analyticsPresentation'

const statusCopy = { ready: 'Processing ready', pending: 'Awaiting processing', stale: 'Processing stale', live: 'Live processing' } as const
const reasons: Record<string, string> = {
  unwind_transfer_basis_unresolved: 'Cost basis for the unwind or transfer is unresolved.',
  missing_execution_mark: 'An execution-time mark is missing.',
  funding_direction_unverified: 'The source has not established whether funding was paid or received.',
}
export function reasonCopy(code: string): string {
  return reasons[code] ?? code.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase())
}
export function AnalyticsCoverage({ coverage, limitations }: { coverage: HubAnalyticsCoverage; limitations: string[] }) {
  return <div className="rounded-xl border border-border-default bg-bg-surface-2 p-4 type-caption" aria-label="Analytics coverage">
    <div className="flex flex-wrap gap-x-5 gap-y-2">
      <span className={coverage.derivedStatus === 'stale' ? 'font-semibold text-status-warning' : 'font-semibold text-text-primary'}>{statusCopy[coverage.derivedStatus]}</span>
      <span className="text-text-secondary">{coverage.historyComplete ? 'History completeness reported by source' : 'History completeness not verified'}</span>
      <span className="text-text-tertiary">Processed: {utcLabel(coverage.derivedAt)}</span>
      <span className="text-text-tertiary">Source collected: {utcLabel(coverage.latestCollectionAt)}</span>
    </div>
    <p className="mt-2 text-text-tertiary">Processing status does not certify complete history or availability of every metric.</p>
    {coverage.derivedStatus === 'live' && <p className="mt-1 text-text-secondary">Processing semantics are not verified; this status does not establish ready or current results.</p>}
    {limitations.map((note) => <p className="mt-1 text-status-warning" key={note}>{note}</p>)}
    <details className="mt-3 text-text-secondary"><summary className="cursor-pointer">Source coverage and processing details</summary>
      <dl className="mt-2 grid gap-2 sm:grid-cols-2">
        <div><dt className="text-text-tertiary">Inventory check</dt><dd>{coverage.inventoryStatus.replace(/_/g, ' ')} · As of {utcLabel(coverage.inventoryAsOf)}</dd></div>
        <div><dt className="text-text-tertiary">Normalization version</dt><dd className="break-all">{coverage.normalizationVersion ?? 'Unavailable'}</dd></div>
        <div><dt className="text-text-tertiary">Observed history bounds (before period filters)</dt><dd>{utcLabel(coverage.availableStart)} to {utcLabel(coverage.availableEnd)}</dd></div>
        <div><dt className="text-text-tertiary">Inventory mismatches / unavailable checks</dt><dd>{coverage.inventoryMismatchCount ?? 'Unknown'} / {coverage.inventoryUnavailableCount ?? 'Unknown'}</dd></div>
        <div><dt className="text-text-tertiary">Excluded / unmatched / ambiguous RFQ components</dt><dd>{coverage.excludedRfqCount ?? 'Unknown'} / {coverage.unmatchedRfqCount ?? 'Unknown'} / {coverage.ambiguousRfqCount ?? 'Unknown'}</dd></div>
      </dl>
      {coverage.notes.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4">{coverage.notes.map((note, i) => <li key={i}>{reasonCopy(note)}{note.includes('_') && <span className="ml-1 break-all text-text-tertiary">({note})</span>}</li>)}</ul>}
    </details>
  </div>
}
