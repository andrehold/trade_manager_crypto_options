import React from 'react'
import { Button } from '@/components/ui/Button'
import { captureAnalyticsPeriod, type AnalyticsPeriodSelection, type AnalyticsWindow } from '@/lib/portfolioDataHub/analyticsClient'
import { utcLabel } from './analyticsPresentation'

const inputClass = 'min-w-0 rounded-lg border border-border-default bg-bg-surface-2 px-3 py-2 type-caption text-text-primary [color-scheme:dark] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-500'
export function AnalyticsPeriodControl({ period, window, onChange }: {
  period: AnalyticsPeriodSelection; window: AnalyticsWindow | null; onChange: (period: AnalyticsPeriodSelection) => void
}) {
  const id = React.useId()
  const [draftKind, setDraftKind] = React.useState(period.kind)
  const [start, setStart] = React.useState(period.kind === 'custom' ? period.startDate : window?.start.slice(0, 10) ?? '')
  const [end, setEnd] = React.useState(period.kind === 'custom' ? period.endDate : window?.end.slice(0, 10) ?? '')
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => {
    setDraftKind(period.kind)
    if (period.kind === 'custom') { setStart(period.startDate); setEnd(period.endDate) }
  }, [period])
  return <div className="min-w-0">
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 type-caption text-text-secondary" htmlFor={`${id}-period`}>Trading period · UTC
        <select id={`${id}-period`} value={draftKind} className={inputClass} onChange={(event) => {
          const kind = event.target.value as AnalyticsPeriodSelection['kind']
          setDraftKind(kind); setError(null)
          if (kind !== 'custom') onChange({ kind })
        }}>
          <option value="month-to-date">Month to date</option><option value="last-30-days">Last 30 days</option><option value="custom">Custom dates</option>
        </select>
      </label>
      {draftKind === 'custom' && <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
        event.preventDefault()
        const selection = { kind: 'custom', startDate: start, endDate: end } as const
        try { captureAnalyticsPeriod(selection); setError(null); onChange(selection) }
        catch { setError('Enter valid UTC dates with the start on or before the end.') }
      }}>
        <label className="flex min-w-0 flex-col gap-1 type-caption text-text-secondary">From<input type="date" value={start} required className={inputClass} onChange={(event) => setStart(event.target.value)} aria-describedby={error ? `${id}-error` : undefined} /></label>
        <label className="flex min-w-0 flex-col gap-1 type-caption text-text-secondary">Through<input type="date" value={end} required className={inputClass} onChange={(event) => setEnd(event.target.value)} aria-describedby={error ? `${id}-error` : undefined} /></label>
        <Button type="submit" size="sm">Apply dates</Button>
      </form>}
    </div>
    {error && <p id={`${id}-error`} role="alert" className="mt-2 type-caption text-status-danger">{error}</p>}
    {window && <p className="mt-2 break-words type-caption text-text-tertiary">Showing {utcLabel(window.start)} to {utcLabel(window.end)} (end exclusive).</p>}
    {draftKind === 'custom' && (period.kind !== 'custom' || start !== period.startDate || end !== period.endDate) && <p className="mt-1 type-caption text-text-secondary">Apply dates to change the results shown.</p>}
    <p className="mt-1 type-caption text-text-tertiary">Applies to trading results. Current account values, lifetime performance and snapshot trends keep their own scope.</p>
  </div>
}
