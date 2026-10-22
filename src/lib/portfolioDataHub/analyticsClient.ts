import { z } from 'zod'
import { PortfolioHubClientError, requestPortfolioHub } from './client'
import {
  compareAnalyticsInstants, parseAnalyticsQuery,
  type AnalyticsEndpoint, type AnalyticsGrouping, type AnalyticsMetricName,
  type ANALYTICS_CATEGORIES,
} from './analyticsSchemas'
import {
  parseHubAnalyticsSummary, parseHubAnalyticsTransactionPage,
  type HubAnalyticsSummary, type HubAnalyticsTransactionPage,
} from './analyticsNormalizers'

export type AnalyticsWindow = { start: string; end: string }
export type AnalyticsFilters = {
  instrument?: string
  category?: typeof ANALYTICS_CATEGORIES[number]
  currency?: string
  denomination?: string
  quantityUnit?: string
  instrumentIsNull?: boolean
  currencyIsNull?: boolean
  quantityUnitIsNull?: boolean
}
export type AnalyticsSummaryFilters = AnalyticsFilters & AnalyticsWindow & {
  metric?: AnalyticsMetricName
  groupBy?: AnalyticsGrouping[]
}
export type AnalyticsTransactionFilters = AnalyticsFilters & AnalyticsWindow & {
  metric?: AnalyticsMetricName
  cursor?: string | null
  limit?: number
}
export type AnalyticsPeriodSelection = { kind: 'month-to-date' } | { kind: 'last-30-days' }
  | { kind: 'custom'; startDate: string; endDate: string }

export function captureAnalyticsPeriod(selection: AnalyticsPeriodSelection, now = new Date()): AnalyticsWindow {
  let window: AnalyticsWindow
  if (selection.kind === 'custom') {
    z.string().date().parse(selection.startDate)
    z.string().date().parse(selection.endDate)
    const start = `${selection.startDate}T00:00:00.000Z`
    const end = new Date(`${selection.endDate}T00:00:00.000Z`)
    end.setUTCDate(end.getUTCDate() + 1)
    window = { start, end: end.toISOString() }
  } else {
    const end = now.toISOString()
    const start = selection.kind === 'month-to-date'
      ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
      : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    window = { start, end }
  }
  parseAnalyticsQuery(new URLSearchParams(window), 'summary')
  return window
}

/** Canonical request key includes exact window/filter strings, never the token. */
export function analyticsQueryKey(window: AnalyticsWindow, filters: AnalyticsFilters = {}): string {
  return [...analyticsSearch({ ...filters, ...window }, 'summary')].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')
}

function analyticsSearch(filters: AnalyticsSummaryFilters | AnalyticsTransactionFilters, endpoint: AnalyticsEndpoint) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || (key === 'cursor' && value === null)) continue
    const wireKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    search.set(wireKey, Array.isArray(value) ? value.join(',') : String(value))
  }
  try { return parseAnalyticsQuery(search, endpoint) } catch {
    throw new PortfolioHubClientError('ANALYTICS_INVALID_QUERY', 'The trading period or analytics filters are invalid', 400)
  }
}

// Portal fields are camelCase. Convert only object field names back to the
// existing wire schemas for validation; metric/reason dictionary keys stay exact.
function wireFields(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected an analytics object')
  const result: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(value)) {
    const wire = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    if (Object.prototype.hasOwnProperty.call(result, wire)) throw new Error('Ambiguous analytics field')
    Object.defineProperty(result, wire, { value: field, enumerable: true, configurable: true, writable: true })
  }
  return result
}
function wireResponse(value: unknown, endpoint: AnalyticsEndpoint) {
  const raw = wireFields(value)
  const coverage = wireFields(raw.coverage)
  // The portal explicitly represents omitted optional component counts as null.
  for (const key of ['inventory_mismatch_count', 'inventory_unavailable_count', 'ambiguous_rfq_count', 'excluded_rfq_count', 'unmatched_rfq_count']) {
    if (coverage[key] === null) delete coverage[key]
  }
  raw.coverage = coverage
  if (endpoint === 'summary') {
    if (!Array.isArray(raw.groups)) throw new Error('Expected analytics groups')
    raw.groups = raw.groups.map((value) => {
      const group = wireFields(value)
      group.dimensions = wireFields(group.dimensions)
      const metrics = group.metrics
      if (typeof metrics !== 'object' || metrics === null || Array.isArray(metrics)) throw new Error('Expected metrics')
      group.metrics = Object.fromEntries(Object.entries(metrics).map(([name, metric]) => [name, wireFields(metric)]))
      return group
    })
  } else {
    if (!Array.isArray(raw.items)) throw new Error('Expected analytics rows')
    raw.items = raw.items.map((value) => {
      const row = wireFields(value)
      if (row.accounting != null) row.accounting = wireFields(row.accounting)
      return row
    })
  }
  return raw
}

export async function fetchPortfolioHubAnalyticsSummary(
  token: string, filters: AnalyticsSummaryFilters, fetchImpl?: typeof fetch, signal?: AbortSignal,
): Promise<HubAnalyticsSummary> {
  const search = analyticsSearch(filters, 'summary')
  const data = await requestPortfolioHub<unknown>(`/api/portfolio-data-hub/analytics/summary?${search}`, token, fetchImpl, signal)
  try { return parseHubAnalyticsSummary(wireResponse(data, 'summary')) } catch {
    throw new PortfolioHubClientError('INVALID_RESPONSE', 'The portfolio service returned invalid analytics')
  }
}
export async function fetchPortfolioHubAnalyticsTransactions(
  token: string, filters: AnalyticsTransactionFilters, fetchImpl?: typeof fetch, signal?: AbortSignal,
): Promise<HubAnalyticsTransactionPage> {
  const search = analyticsSearch(filters, 'transactions')
  const data = await requestPortfolioHub<unknown>(`/api/portfolio-data-hub/analytics/transactions?${search}`, token, fetchImpl, signal)
  try { return parseHubAnalyticsTransactionPage(wireResponse(data, 'transactions')) } catch {
    throw new PortfolioHubClientError('INVALID_RESPONSE', 'The portfolio service returned invalid analytics transactions')
  }
}

export type AnalyticsPair = {
  accountId: string
  window: AnalyticsWindow
  filters: AnalyticsFilters
  totals: HubAnalyticsSummary
  daily: HubAnalyticsSummary
  consistencyLimitations: string[]
}

export function validateAnalyticsPair(
  totals: HubAnalyticsSummary, daily: HubAnalyticsSummary,
  window: AnalyticsWindow, filters: AnalyticsFilters,
): AnalyticsPair {
  const invalid = () => new PortfolioHubClientError('INVALID_RESPONSE', 'Analytics responses do not match the requested account, period or grouping')
  if (totals.accountId !== daily.accountId) {
    throw new PortfolioHubClientError('ANALYTICS_PUBLICATION_CONFLICT', 'The mapped analytics account changed during this read', 409)
  }
  if (totals.venue !== null && daily.venue !== null && totals.venue !== daily.venue) throw invalid()
  if (totals.groupBy.length !== 0 || daily.groupBy.join(',') !== 'day') throw invalid()
  for (const summary of [totals, daily]) {
    for (const name of ['start', 'end'] as const) {
      const supplied = name === 'start' ? summary.coverage.requestedStart : summary.coverage.requestedEnd
      if (supplied === null || compareAnalyticsInstants(supplied, window[name]) !== 0) throw invalid()
    }
  }
  const limitations: string[] = []
  for (const field of ['derivedAt', 'normalizationVersion'] as const) {
    const a = totals.coverage[field]
    const b = daily.coverage[field]
    if (a !== null && b !== null) {
      const same = field === 'derivedAt' ? compareAnalyticsInstants(a, b) === 0 : a === b
      if (!same) throw new PortfolioHubClientError('ANALYTICS_PUBLICATION_CONFLICT', 'Analytics results changed during this read', 409)
    } else limitations.push(field === 'derivedAt' ? 'Processing time is unavailable for comparing builds.' : 'Normalization version is unavailable for comparing builds.')
  }
  if (totals.coverage.derivedStatus !== daily.coverage.derivedStatus) {
    throw new PortfolioHubClientError('ANALYTICS_PUBLICATION_CONFLICT', 'Analytics processing state changed during this read', 409)
  }
  return { accountId: totals.accountId, window: { ...window }, filters: { ...filters }, totals, daily, consistencyLimitations: limitations }
}
