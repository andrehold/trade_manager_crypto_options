import React from 'react'
import type { HubSummaryComponent } from '@/lib/portfolioDataHub'
import { normalizeReportingCurrency, type ReportingCurrencySource } from '@/lib/clientPortal/reportingCurrencyRepo'
import { Button } from '@/components/ui/Button'

/** Only summary currencies are selectable: positions and ledger units are never inferred as reporting currencies. */
export function reportingCurrenciesFromSummary(components: HubSummaryComponent[]): string[] {
  return [...new Set(components
    .map((component) => normalizeReportingCurrency(component.currency))
    .filter((currency): currency is string => currency !== null))]
    .sort((left, right) => left.localeCompare(right))
}

export function reportingCurrencySourceLabel(source: ReportingCurrencySource): string {
  if (source === 'admin') return 'Administrator'
  if (source === 'client') return 'Client'
  return 'Not configured'
}

export function ReportingCurrencySelector({
  components,
  reportingCurrency,
  reportingCurrencySource,
  saving = false,
  error = null,
  onSave,
}: {
  components: HubSummaryComponent[]
  reportingCurrency: string | null
  reportingCurrencySource: ReportingCurrencySource
  saving?: boolean
  error?: string | null
  onSave: (currency: string | null) => void
}) {
  const availableCurrencies = React.useMemo(() => reportingCurrenciesFromSummary(components), [components])
  const canonicalReportingCurrency = normalizeReportingCurrency(reportingCurrency)
  const currentInLatestSummary = canonicalReportingCurrency === null || availableCurrencies.includes(canonicalReportingCurrency)
  const [draft, setDraft] = React.useState(canonicalReportingCurrency ?? '')

  // A successful save causes a fresh overview to arrive. Do not overwrite a pending selection
  // while the RPC is in flight; a failed save deliberately leaves the prior saved value visible.
  React.useEffect(() => {
    if (!saving) setDraft(canonicalReportingCurrency ?? '')
  }, [canonicalReportingCurrency, saving])

  const canSelect = availableCurrencies.length > 0
  // A previously saved but no-longer-reported currency remains visible for context, but must
  // never be re-submitted. New selections are constrained to this latest Hub summary.
  const canSave = !saving
    && availableCurrencies.includes(draft)
    && (draft !== canonicalReportingCurrency || reportingCurrencySource !== 'client')
  const canClear = !saving && reportingCurrency !== null

  return (
    <section className="rounded-2xl border border-border-default bg-bg-surface-1 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="type-subhead font-semibold text-text-primary">Reporting currency</h2>
          <p className="mt-0.5 type-caption text-text-tertiary">Headlines use one Hub summary currency. Values are never converted or combined.</p>
          <p className="mt-1 type-caption text-text-secondary">Last set by: <span className="font-medium text-text-primary">{reportingCurrencySourceLabel(reportingCurrencySource)}</span></p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="hub-reporting-currency">Reporting currency</label>
          <select
            id="hub-reporting-currency"
            value={draft}
            disabled={!canSelect || saving}
            onChange={(event) => setDraft(event.target.value)}
            className="min-w-28 rounded-lg border border-border-default bg-bg-canvas px-2.5 py-1.5 type-caption text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {!draft && <option value="">Select currency</option>}
            {canonicalReportingCurrency && !currentInLatestSummary && <option value={canonicalReportingCurrency}>{canonicalReportingCurrency} (not in latest summary)</option>}
            {availableCurrencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
          </select>
          <Button size="sm" variant="secondary" disabled={!canSave} onClick={() => onSave(draft)}>{saving ? 'Saving…' : 'Save'}</Button>
          {reportingCurrency && <Button size="sm" variant="ghost" disabled={!canClear} onClick={() => onSave(null)}>Clear</Button>}
        </div>
      </div>
      {!canSelect && <p className="mt-3 type-caption text-text-secondary">The latest Hub summary did not report a selectable currency. You may still clear an existing selection.</p>}
      {canonicalReportingCurrency && !currentInLatestSummary && <p className="mt-3 type-caption text-status-warning" role="status">{canonicalReportingCurrency} is saved, but no matching component is present in the latest Hub summary.</p>}
      {error && <p className="mt-3 type-caption text-status-danger" role="alert">{error}</p>}
    </section>
  )
}
