import type { PortfolioSummary } from '../portfolio'

export type DashboardDenomination = {
  depositAsset: string
  marginCcy: string
  spotUsd: number
}

// Illustrative constants for this phase. A later phase sources these from the
// account/venue feed. spotUsd converts deposit-asset amounts to cash figures.
const ILLUSTRATIVE_SPOT_USD = 100_000
const ILLUSTRATIVE_MARGIN_CCY = 'USDC'

export function denominationFor(summary: PortfolioSummary): DashboardDenomination {
  return {
    depositAsset: summary.asset || 'BTC',
    marginCcy: ILLUSTRATIVE_MARGIN_CCY,
    spotUsd: ILLUSTRATIVE_SPOT_USD,
  }
}
