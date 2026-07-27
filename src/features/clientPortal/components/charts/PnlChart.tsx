import { fmtPremium } from '@/utils'
import type { PortfolioSummary } from '../../portfolio'
import type { DashboardDenomination } from '../../dashboard/denomination'
import { pnlSeries } from '../../dashboard/series'
import { CHART_COLORS } from '../../dashboard/chartTheme'
import { AreaChart } from './AreaChart'

export function PnlChart({ summary, denom }: { summary: PortfolioSummary; denom: DashboardDenomination }) {
  const pnl = summary.totalPnl ?? 0
  const color = pnl < 0 ? CHART_COLORS.danger : CHART_COLORS.good
  return (
    <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-4">
      <div className="type-caption font-semibold text-text-secondary">Cumulative PnL</div>
      <div className={`mt-1 type-title-l font-bold ${pnl < 0 ? 'text-status-danger' : 'text-status-success'}`}>
        {fmtPremium(pnl, denom.depositAsset)}
      </div>
      <div className="mt-0.5 type-caption text-text-tertiary">Realized + unrealized, from inception baseline</div>
      <AreaChart
        data={pnlSeries(summary)} color={color} zeroBaseline
        formatValue={(v) => fmtPremium(v, denom.depositAsset)} testId="pnl-chart"
      />
    </div>
  )
}
