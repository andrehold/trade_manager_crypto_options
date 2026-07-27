import type { PortfolioSummary } from '../portfolio'
import type { DashboardDenomination } from './denomination'

export type GreekTone = 'accent' | 'sky' | 'amber' | 'rose'
export type GreekKey = 'delta' | 'gamma' | 'vega' | 'theta'
export type GreekDisplay = {
  key: GreekKey
  label: string
  symbol: string
  value: number
  unit: string
  tone: GreekTone
  digits: number
}

// Delta/Gamma report in the deposit asset; Vega/Theta report in USD (spot-converted).
export function greekDisplays(
  summary: PortfolioSummary,
  denom: DashboardDenomination,
): GreekDisplay[] {
  const asset = denom.depositAsset
  return [
    { key: 'delta', label: 'Delta', symbol: 'Δ', value: summary.delta, unit: `${asset} equivalent`, tone: 'accent', digits: 4 },
    { key: 'gamma', label: 'Gamma', symbol: 'Γ', value: summary.gamma, unit: `${asset} per 1% move`, tone: 'sky', digits: 5 },
    { key: 'vega', label: 'Vega', symbol: 'V', value: summary.vega * denom.spotUsd, unit: 'USD per vol pt', tone: 'amber', digits: 1 },
    { key: 'theta', label: 'Theta', symbol: 'Θ', value: summary.theta * denom.spotUsd, unit: 'USD per day', tone: 'rose', digits: 1 },
  ]
}
