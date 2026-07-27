import { fmtGreek, fmtNumber } from '@/utils'
import type { PortfolioSummary } from '../../portfolio'
import type { DashboardDenomination } from '../../dashboard/denomination'
import { greekDisplays, type GreekTone } from '../../dashboard/greeksDisplay'
import { greekSeries } from '../../dashboard/series'
import { CHART_COLORS } from '../../dashboard/chartTheme'
import { AreaChart } from './AreaChart'

const TONE_HEX: Record<GreekTone, string> = {
  accent: CHART_COLORS.accent, sky: CHART_COLORS.sky, amber: CHART_COLORS.amber, rose: CHART_COLORS.rose,
}
const SWATCH: Record<GreekTone, string> = {
  accent: 'bg-accent-400', sky: 'bg-sky-400', amber: 'bg-amber-400', rose: 'bg-rose-400',
}

function fmtGreekValue(value: number, digits: number): string {
  const sign = value < 0 ? '−' : '+'
  const abs = Math.abs(value)
  const body = digits >= 4 ? fmtGreek(abs, digits) : fmtNumber(abs)
  return `${sign}${body}`
}

export function GreekCharts({ summary, denom }: { summary: PortfolioSummary; denom: DashboardDenomination }) {
  const rows = greekDisplays(summary, denom)
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {rows.map((g) => (
        <div key={g.key} className="rounded-2xl border border-border-default bg-bg-surface-1 p-3.5">
          <div className="flex items-center gap-2 type-caption font-semibold text-text-secondary">
            <span className={`inline-block h-2 w-2 rounded-sm ${SWATCH[g.tone]}`} />
            {g.label}
          </div>
          <div className={`mt-1.5 type-subhead font-bold ${g.value < 0 ? 'text-status-danger' : 'text-status-success'}`}>
            {fmtGreekValue(g.value, g.digits)} <span className="type-caption font-medium text-text-tertiary">{g.unit}</span>
          </div>
          <AreaChart
            data={greekSeries(g.key, g.value)} color={TONE_HEX[g.tone]} height={82}
            zeroBaseline={g.key === 'delta' || g.key === 'theta'}
            formatValue={(v) => fmtGreekValue(v, g.digits)} testId={`greek-chart-${g.key}`}
          />
        </div>
      ))}
    </div>
  )
}
