import { fmtGreek, fmtNumber } from '@/utils'
import type { PortfolioSummary } from '../portfolio'
import type { DashboardDenomination } from '../dashboard/denomination'
import { greekDisplays, type GreekTone } from '../dashboard/greeksDisplay'

const BADGE: Record<GreekTone, string> = {
  accent: 'bg-accent-400/15 text-accent-400',
  sky: 'bg-sky-400/15 text-sky-400',
  amber: 'bg-amber-400/15 text-amber-400',
  rose: 'bg-rose-400/15 text-rose-400',
}

function fmtValue(value: number, digits: number): string {
  const sign = value < 0 ? '−' : '+'
  const abs = Math.abs(value)
  return `${sign}${digits >= 4 ? fmtGreek(abs, digits) : fmtNumber(abs)}`
}

export function GreeksStrip({ summary, denom }: { summary: PortfolioSummary; denom: DashboardDenomination }) {
  const rows = greekDisplays(summary, denom)
  return (
    <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {rows.map((g) => (
          <div key={g.key} className="flex items-center gap-3">
            <div className={`grid h-9 w-9 flex-none place-items-center rounded-lg text-base font-bold ${BADGE[g.tone]}`}>
              {g.symbol}
            </div>
            <div className="min-w-0">
              <div className="type-caption uppercase tracking-wide text-text-tertiary">{g.label}</div>
              {summary.hasAnyMarks ? (
                <div className={`type-subhead font-bold ${g.value < 0 ? 'text-status-danger' : 'text-status-success'}`}>
                  {fmtValue(g.value, g.digits)}
                </div>
              ) : (
                <div className="type-subhead font-bold text-text-tertiary">—</div>
              )}
              <div className="type-caption text-text-tertiary">{g.unit}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
