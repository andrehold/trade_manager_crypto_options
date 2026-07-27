import { fmtPremium } from '@/utils'
import type { PortfolioSummary } from '../../portfolio'
import type { DashboardDenomination } from '../../dashboard/denomination'
import { equitySeries } from '../../dashboard/series'
import { CHART_COLORS } from '../../dashboard/chartTheme'
import { AreaChart } from './AreaChart'

export function EquityChart({ summary, denom }: { summary: PortfolioSummary; denom: DashboardDenomination }) {
  return (
    <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-4">
      <div className="type-caption font-semibold text-text-secondary">Equity Curve</div>
      <div className="mt-1 type-title-l font-bold text-text-primary">{fmtPremium(summary.totalEquity, denom.depositAsset)}</div>
      <div className="mt-0.5 type-caption text-text-tertiary">Account equity in deposit asset, marked to live prices</div>
      <AreaChart
        data={equitySeries(summary)} color={CHART_COLORS.accent}
        formatValue={(v) => fmtPremium(v, denom.depositAsset)} testId="equity-chart"
      />
    </div>
  )
}
