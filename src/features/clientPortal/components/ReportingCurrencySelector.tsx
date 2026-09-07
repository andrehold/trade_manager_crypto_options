import React from 'react'
import { Button } from '@/components/ui/Button'
import {
  normalizeReportingCurrency,
  type ReportingCurrencySource,
} from '@/lib/clientPortal/reportingCurrencyRepo'
import type { AccountCurrencyResolution } from '../dashboard/accountCurrency'

export type ReportingCurrencySelectorProps = {
  resolution: AccountCurrencyResolution
  reportingCurrency: string | null
  reportingCurrencySource: ReportingCurrencySource
  saving?: boolean
  error?: string | null
  presentation?: 'compact' | 'configuration'
  onSave: (currency: string | null) => void
}

export function reportingCurrencySourceLabel(source: ReportingCurrencySource): string {
  if (source === 'admin') return 'Administrator'
  if (source === 'client') return 'Client'
  return 'Not configured'
}

function orderedCurrencies(resolution: AccountCurrencyResolution): string[] {
  const available = new Set(resolution.availableCurrencies)
  const funded = resolution.fundedCurrencies
    .filter((currency) => available.has(currency))
    .sort((left, right) => left.localeCompare(right))
  const fundedSet = new Set(funded)
  const remaining = resolution.availableCurrencies
    .filter((currency) => !fundedSet.has(currency))
    .sort((left, right) => left.localeCompare(right))
  return [...funded, ...remaining]
}

function initialDraft(
  resolution: AccountCurrencyResolution,
  reportingCurrency: string | null,
): string {
  const persisted = normalizeReportingCurrency(reportingCurrency)
  if (persisted) return persisted
  return resolution.status === 'resolved' && resolution.source === 'inferred'
    ? resolution.currency
    : ''
}

function selectionMessage(resolution: AccountCurrencyResolution): string | null {
  if (resolution.status === 'resolved') return null
  if (resolution.reason === 'multiple-funded') {
    return 'Choose the account currency to show on this dashboard.'
  }
  if (resolution.reason === 'saved-currency-missing') {
    return 'Your saved account currency is not present in the latest venue summary. Choose an available currency.'
  }
  return 'No funded account currency was detected. Choose a currency to view its venue-reported values.'
}

export function ReportingCurrencySelector({
  resolution,
  reportingCurrency,
  reportingCurrencySource,
  saving = false,
  error = null,
  presentation = 'configuration',
  onSave,
}: ReportingCurrencySelectorProps) {
  const choices = React.useMemo(() => orderedCurrencies(resolution), [resolution])
  const choicesKey = choices.join('\u0000')
  const canonicalReportingCurrency = normalizeReportingCurrency(reportingCurrency)
  const resolvedDraft = initialDraft(resolution, reportingCurrency)
  const [draft, setDraft] = React.useState(resolvedDraft)

  // The refreshed server overview remains authoritative after a successful save. An inferred
  // value is only a local display default: this effect never persists it.
  React.useEffect(() => {
    if (!saving) setDraft(resolvedDraft)
  }, [choicesKey, resolvedDraft, saving])

  const available = new Set(resolution.availableCurrencies)
  const savedCurrencyMissing = resolution.status === 'selection-required'
    && resolution.reason === 'saved-currency-missing'
    && resolution.savedCurrency !== null
    && !available.has(resolution.savedCurrency)
    ? resolution.savedCurrency
    : null
  const canSelect = choices.length > 0
  const canSave = !saving
    && available.has(draft)
    && (draft !== canonicalReportingCurrency || reportingCurrencySource !== 'client')
  const canClear = !saving && reportingCurrency !== null
  const message = selectionMessage(resolution)
  const sourceCopy = resolution.status === 'resolved' && resolution.source === 'inferred'
    ? 'Detected from funded balance'
    : `Last set by: ${reportingCurrencySourceLabel(reportingCurrencySource)}`

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Account currency"
        value={draft}
        disabled={!canSelect || saving}
        onChange={(event) => setDraft(event.target.value)}
        className="min-w-28 rounded-lg border border-border-default bg-bg-canvas px-2.5 py-1.5 type-caption text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
      >
        {!draft && <option value="">Select currency</option>}
        {choices.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
        {savedCurrencyMissing && (
          <option value={savedCurrencyMissing} disabled>
            {savedCurrencyMissing} (not in latest summary)
          </option>
        )}
      </select>
      <Button
        size="sm"
        variant="secondary"
        disabled={!canSave}
        onClick={() => { if (canSave) onSave(draft) }}
      >
        {saving ? 'Saving…' : 'Save'}
      </Button>
      {reportingCurrency !== null && (
        <Button
          size="sm"
          variant="ghost"
          disabled={!canClear}
          onClick={() => { if (canClear) onSave(null) }}
        >
          Clear
        </Button>
      )}
    </div>
  )

  return (
    <section className={presentation === 'configuration'
      ? 'rounded-2xl border border-border-default bg-bg-surface-1 p-4'
      : 'flex flex-wrap items-center gap-3'}>
      {message && <p className="mb-3 type-caption text-text-secondary" role="status">{message}</p>}
      <div className={presentation === 'configuration'
        ? 'flex flex-wrap items-start justify-between gap-3'
        : 'flex flex-wrap items-center gap-3'}>
        <div>
          {presentation === 'configuration'
            ? <h2 className="type-subhead font-semibold text-text-primary">Account currency</h2>
            : <div className="type-caption font-semibold text-text-primary">Account currency</div>}
          <p className="mt-0.5 type-caption text-text-tertiary">Values stay in the venue-native currency and are not converted or combined.</p>
          <p className="mt-1 type-caption text-text-secondary">{sourceCopy}</p>
        </div>
        {controls}
      </div>
      {!canSelect && (
        <p className="mt-3 type-caption text-text-secondary">
          The latest Hub summary did not report a selectable account currency.
          {reportingCurrency !== null ? ' You may still clear the saved selection.' : ''}
        </p>
      )}
      {error && <p className="mt-3 type-caption text-status-danger" role="alert">{error}</p>}
    </section>
  )
}
