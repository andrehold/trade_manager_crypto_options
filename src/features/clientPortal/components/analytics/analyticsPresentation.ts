import { decimalFrom, type ExactDecimal, type HubAnalyticsDimensions, type HubAnalyticsGroup, type HubAnalyticsMetric, type AnalyticsMetricName } from '@/lib/portfolioDataHub'
import type { AnalyticsWindow, AnalyticsFilters } from '@/lib/portfolioDataHub/analyticsClient'

export const METRIC_LABELS: Partial<Record<AnalyticsMetricName, string>> = {
  calculated_realized_gross_profit: 'Realized trading profit', net_trading_cost: 'Net trading cost',
  fee_expense: 'Fee expense', rebates: 'Rebates', net_funding: 'Verified net funding',
  execution_count: 'Execution count', executed_quantity: 'Executed quantity',
  premium_turnover: 'Premium turnover', notional_turnover: 'Notional turnover',
}
export const cardClass = 'min-w-0 rounded-2xl border border-border-default bg-bg-surface-1 p-4'
export type AnalyticsResultSelection = {
  metric: AnalyticsMetricName
  group: HubAnalyticsGroup
  window: AnalyticsWindow
  filters: AnalyticsFilters
}
export type InspectMetric = (metric: AnalyticsMetricName, group: HubAnalyticsGroup) => void
export function partitionKey(dimensions: HubAnalyticsDimensions): string {
  return JSON.stringify([dimensions.currency, dimensions.denomination, dimensions.quantityUnit])
}
export function currencyKey(currency: string | null): string { return JSON.stringify(currency) }
export function dimensionLabel(value: string | null | undefined, kind: string): string {
  return value === null || value === undefined || value === '' ? `Unknown ${kind}` : value
}
export function partitionLabel(dimensions: HubAnalyticsDimensions): string {
  return `${dimensionLabel(dimensions.currency, 'currency')} · Denomination: ${dimensionLabel(dimensions.denomination, 'denomination')} · Quantity unit: ${dimensionLabel(dimensions.quantityUnit, 'quantity unit')}`
}
export function metricUnit(metric: AnalyticsMetricName, dimensions: HubAnalyticsDimensions): string | null {
  if (metric === 'execution_count') return 'executions'
  if (metric === 'executed_quantity') return dimensions.quantityUnit ?? 'Unknown quantity unit'
  return dimensions.currency ?? 'Unknown currency'
}
export function metricText(metric: HubAnalyticsMetric | undefined): string {
  if (!metric) return 'Not eligible'
  if (metric.eligibleCount === 0) return 'No eligible components'
  if (metric.value === null) return 'Unavailable'
  return metric.value
}
export function completenessText(metric: HubAnalyticsMetric | undefined): string | null {
  if (!metric || metric.missingCount === 0) return null
  return `${metric.value !== null ? 'Partial subtotal' : 'Unavailable'} · ${metric.missingCount} of ${metric.eligibleCount} eligible components missing`
}
export function profitTone(value: ExactDecimal | null | undefined): string {
  if (value == null || decimalFrom(value).isZero()) return 'text-text-primary'
  return decimalFrom(value).isNegative() ? 'text-status-danger' : 'text-status-success'
}
/** Only the plot consumes numbers. Underflow/overflow never becomes a false zero. */
export function plotCoordinate(value: ExactDecimal | null | undefined): number | null {
  if (value == null) return null
  const exact = decimalFrom(value)
  const numeric = exact.toNumber()
  return Number.isFinite(numeric) && (numeric !== 0 || exact.isZero()) ? numeric : null
}
export function utcLabel(value: string | null): string {
  return value === null ? 'Unavailable' : new Date(value).toISOString().replace('T', ' ').replace('Z', ' UTC')
}
