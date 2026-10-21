import {
  analyticsCoverageSchema,
  analyticsSummarySchema,
  analyticsTransactionPageSchema,
  type RawAnalyticsCoverage,
  type RawAnalyticsMetric,
  type RawAnalyticsTransaction,
} from './analyticsSchemas'

type CamelKey<S extends string> = S extends `${infer Head}_${infer Tail}` ? `${Head}${Capitalize<CamelKey<Tail>>}` : S
type CamelFields<T> = { [K in keyof T as K extends string ? CamelKey<K> : K]: T[K] }

// Deliberately shallow: metric names, missing-data codes and reconciliation keys
// are Hub identifiers, not portal property names. Decimal strings are untouched.
function camelFields<T extends object>(value: T): CamelFields<T> {
  const keys = new Set<string>()
  return Object.fromEntries(Object.entries(value).map(([key, field]) => {
    const normalized = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
    if (keys.has(normalized)) throw new Error('Ambiguous analytics response field')
    keys.add(normalized)
    return [normalized, field]
  })) as CamelFields<T>
}

export function normalizeAnalyticsCoverage(coverage: RawAnalyticsCoverage) {
  return {
    ...camelFields(coverage),
    derivedAt: coverage.derived_at ?? null,
    normalizationVersion: coverage.normalization_version ?? null,
    inventoryAsOf: coverage.inventory_as_of ?? null,
    inventoryMismatchCount: coverage.inventory_mismatch_count ?? null,
    inventoryUnavailableCount: coverage.inventory_unavailable_count ?? null,
    ambiguousRfqCount: coverage.ambiguous_rfq_count ?? null,
    excludedRfqCount: coverage.excluded_rfq_count ?? null,
    unmatchedRfqCount: coverage.unmatched_rfq_count ?? null,
  }
}

function normalizeMetrics(metrics: Record<string, RawAnalyticsMetric>) {
  return Object.fromEntries(Object.entries(metrics).map(([name, metric]) => [name, camelFields(metric)]))
}

function normalizeTransaction(row: RawAnalyticsTransaction) {
  return {
    ...camelFields(row),
    accountId: row.account_id ?? null,
    venue: row.venue ?? null,
    accounting: row.accounting ? camelFields(row.accounting) : null,
  }
}

export function parseHubAnalyticsSummary(value: unknown) {
  const raw = analyticsSummarySchema.parse(value)
  return {
    ...camelFields(raw),
    venue: raw.venue ?? null,
    coverage: normalizeAnalyticsCoverage(raw.coverage),
    groups: raw.groups.map((group) => ({
      ...group,
      dimensions: camelFields(group.dimensions),
      metrics: normalizeMetrics(group.metrics),
    })),
  }
}

export function parseHubAnalyticsTransactionPage(value: unknown) {
  const raw = analyticsTransactionPageSchema.parse(value)
  return {
    ...camelFields(raw),
    venue: raw.venue ?? null,
    coverage: normalizeAnalyticsCoverage(raw.coverage),
    items: raw.items.map(normalizeTransaction),
  }
}

export type HubAnalyticsSummary = ReturnType<typeof parseHubAnalyticsSummary>
export type HubAnalyticsTransactionPage = ReturnType<typeof parseHubAnalyticsTransactionPage>
export type HubAnalyticsCoverage = ReturnType<typeof normalizeAnalyticsCoverage>
export type HubAnalyticsTransaction = ReturnType<typeof normalizeTransaction>
export type HubAnalyticsMetric = CamelFields<RawAnalyticsMetric>
export type HubAnalyticsGroup = HubAnalyticsSummary['groups'][number]
export type HubAnalyticsDimensions = HubAnalyticsGroup['dimensions']
export type HubAnalyticsAccounting = NonNullable<HubAnalyticsTransaction['accounting']>

// Validate a standalone coverage object without inventing omitted build metadata.
export function parseHubAnalyticsCoverage(value: unknown): HubAnalyticsCoverage {
  return normalizeAnalyticsCoverage(analyticsCoverageSchema.parse(value))
}
