import { compareAnalyticsInstants, type HubAnalyticsTransaction, type HubAnalyticsTransactionPage } from '@/lib/portfolioDataHub'
import type { AnalyticsTransactionFilters } from '@/lib/portfolioDataHub/analyticsClient'
import type { AnalyticsResultSelection } from '../components/analytics/analyticsPresentation'

/** Intersections preserve the original exact bound when it wins, including fractions. */
export function analyticsDrillFilters(selection: AnalyticsResultSelection): AnalyticsTransactionFilters {
  const { group: { dimensions: d }, metric, window, filters } = selection
  const result: AnalyticsTransactionFilters = { ...filters, ...window, metric, limit: 50 }
  const intersect = (start: string, end: string) => {
    if (compareAnalyticsInstants(start, result.start) > 0) result.start = start
    if (compareAnalyticsInstants(end, result.end) < 0) result.end = end
  }
  if (d.day) {
    const next = new Date(`${d.day}T00:00:00.000Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    intersect(`${d.day}T00:00:00.000Z`, next.toISOString())
  }
  if (d.month) {
    const next = new Date(`${d.month}-01T00:00:00.000Z`)
    next.setUTCMonth(next.getUTCMonth() + 1)
    intersect(`${d.month}-01T00:00:00.000Z`, next.toISOString())
  }
  if (compareAnalyticsInstants(result.start, result.end) >= 0) throw new Error('This bucket does not overlap the original trading period.')
  const partition = (name: 'currency' | 'quantityUnit' | 'instrument', value: string | null) => {
    const nullName = `${name}IsNull` as 'currencyIsNull' | 'quantityUnitIsNull' | 'instrumentIsNull'
    // False means no null-only restriction in the Hub query, not IS NOT NULL.
    if ((filters[name] !== undefined && filters[name] !== value) || (filters[nullName] === true && value !== null)) throw new Error('This group conflicts with the original filters.')
    delete result[name]
    delete result[nullName]
    if (value === null) result[nullName] = true
    else { result[name] = value; if (filters[nullName] === false) result[nullName] = false }
  }
  partition('currency', d.currency)
  partition('quantityUnit', d.quantityUnit)
  if (d.instrument !== undefined) partition('instrument', d.instrument)
  // The provider has no denomination-null or category-null query. Never broaden a drill.
  if (d.denomination === null || d.denomination === '') throw new Error('Transaction details cannot be scoped to an unknown denomination with the current service contract.')
  if (filters.denomination !== undefined && filters.denomination !== d.denomination) throw new Error('This denomination conflicts with the original filters.')
  result.denomination = d.denomination
  if (d.category !== undefined) {
    if (d.category === null) throw new Error('Transaction details cannot be scoped to an unknown category with the current service contract.')
    if (filters.category !== undefined && filters.category !== d.category) throw new Error('This category conflicts with the original filters.')
    result.category = d.category as AnalyticsTransactionFilters['category']
  }
  return result
}

/** A page may contain null-valued eligible contributors, but never another partition. */
export function rowMatchesDrill(row: HubAnalyticsTransaction, filters: AnalyticsTransactionFilters): boolean {
  if (compareAnalyticsInstants(row.eventTime, filters.start) < 0 || compareAnalyticsInstants(row.eventTime, filters.end) >= 0) return false
  for (const key of ['currency', 'quantityUnit', 'instrument'] as const) {
    const nullKey = `${key}IsNull` as 'currencyIsNull' | 'quantityUnitIsNull' | 'instrumentIsNull'
    if (filters[key] !== undefined && row[key] !== filters[key]) return false
    if (filters[nullKey] === true && row[key] !== null) return false
  }
  return (filters.denomination === undefined || row.denomination === filters.denomination)
    && (filters.category === undefined || row.category === filters.category)
    && (filters.metric === undefined || Object.prototype.hasOwnProperty.call(row.metrics, filters.metric))
}

type Build = Pick<HubAnalyticsTransactionPage['coverage'], 'derivedAt' | 'normalizationVersion' | 'derivedStatus'>
export function sameAnalyticsBuild(a: Build, b: Build, strict = false): boolean {
  if (a.derivedStatus !== b.derivedStatus) return false
  for (const field of ['derivedAt', 'normalizationVersion'] as const) {
    if (a[field] === null || b[field] === null) { if (strict && a[field] !== b[field]) return false; continue }
    if (field === 'derivedAt' ? compareAnalyticsInstants(a[field]!, b[field]!) !== 0 : a[field] !== b[field]) return false
  }
  return true
}
