import type { PortfolioSummary } from '../portfolio'
import type { DashboardDenomination } from './denomination'

export type UtilizationZone = 'ok' | 'warn' | 'high'

export function utilizationZone(u: number): UtilizationZone {
  if (u <= 0.5) return 'ok'
  if (u <= 0.8) return 'warn'
  return 'high'
}

export type MarginUsage = {
  imUtilization: number
  initialMargin: number
  maintenanceMargin: number
  marginBalance: number
  available: number
  ccy: string
  zone: UtilizationZone
}

// Illustrative IM utilization for this phase. Real feed replaces this.
const ILLUSTRATIVE_IM_UTILIZATION = 0.31
const MM_TO_IM_RATIO = 0.5

export function illustrativeMargin(
  summary: PortfolioSummary,
  denom: DashboardDenomination,
): MarginUsage {
  const marginBalance = Math.round(summary.totalEquity * denom.spotUsd)
  const imUtilization = ILLUSTRATIVE_IM_UTILIZATION
  const initialMargin = Math.round(marginBalance * imUtilization)
  const maintenanceMargin = Math.round(initialMargin * MM_TO_IM_RATIO)
  const available = marginBalance - initialMargin
  return {
    imUtilization,
    initialMargin,
    maintenanceMargin,
    marginBalance,
    available,
    ccy: denom.marginCcy,
    zone: utilizationZone(imUtilization),
  }
}
