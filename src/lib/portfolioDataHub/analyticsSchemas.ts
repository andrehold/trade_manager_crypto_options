import { z } from 'zod'
import { exactDecimalSchema } from './schemas'

export const ANALYTICS_METRICS = [
  'calculated_realized_gross_profit', 'settlement_cash_flow', 'execution_count',
  'executed_quantity', 'fee_expense', 'rebates', 'net_trading_cost',
  'source_reported_funding', 'net_funding', 'premium_turnover', 'notional_turnover',
  'source_reported_profit', 'exercise_net_cash_flow', 'exercise_open_cash_flow',
  'exercise_settlement_cash_flow', 'delivery_settlement_pnl', 'mark_improvement',
  'mark_value_turnover', 'mark_eligible_turnover', 'mark_covered_turnover', 'mark_improvement_bps',
] as const
export const ANALYTICS_GROUPINGS = ['day', 'month', 'instrument', 'category', 'currency'] as const
export const ANALYTICS_CATEGORIES = [
  'trading', 'funding', 'exercise', 'delivery', 'withdrawal', 'other', 'rfq_review',
  'transfer', 'bookkeeping', 'balance_cost', 'unsupported',
] as const
export type AnalyticsMetricName = typeof ANALYTICS_METRICS[number]
export type AnalyticsGrouping = typeof ANALYTICS_GROUPINGS[number]
export type AnalyticsEndpoint = 'summary' | 'transactions'

const contractObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).passthrough()
const stringOrNull = z.string().nullable()
const decimalOrNull = exactDecimalSchema.nullable()
const count = z.number().int().nonnegative().safe()
export const analyticsDateTimeSchema = z.string().datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)), 'Expected a valid aware date-time')
const dateOrNull = analyticsDateTimeSchema.nullable()

/** Compare instants without dropping sub-millisecond filter precision. */
export function compareAnalyticsInstants(left: string, right: string): number {
  const parts = (value: string) => {
    const fraction = /\.(\d+)(?=Z|[+-]\d{2}:\d{2}$)/.exec(value)
    const whole = fraction ? value.replace(fraction[0], '') : value
    return { whole: Date.parse(whole), fraction: fraction?.[1] ?? '' }
  }
  const a = parts(left)
  const b = parts(right)
  if (a.whole !== b.whole) return a.whole < b.whole ? -1 : 1
  const length = Math.max(a.fraction.length, b.fraction.length)
  const af = a.fraction.padEnd(length, '0')
  const bf = b.fraction.padEnd(length, '0')
  return af === bf ? 0 : af < bf ? -1 : 1
}

export const analyticsMetricSchema = contractObject({
  value: decimalOrNull,
  eligible_count: count,
  missing_count: count,
  available_start: dateOrNull,
  available_end: dateOrNull,
  notes: z.array(z.string()).default([]),
}).refine((metric) => metric.missing_count <= metric.eligible_count, 'Missing count exceeds eligible count')

export const analyticsDimensionsSchema = z.object({
  currency: stringOrNull,
  denomination: stringOrNull,
  quantity_unit: stringOrNull,
  day: z.string().date().nullable().optional(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable().optional(),
  instrument: stringOrNull.optional(),
  category: stringOrNull.optional(),
}).catchall(stringOrNull)

export const analyticsCoverageSchema = contractObject({
  requested_start: dateOrNull,
  requested_end: dateOrNull,
  available_start: dateOrNull,
  available_end: dateOrNull,
  latest_collection_at: dateOrNull,
  notes: z.array(z.string()),
  derived_status: z.enum(['live', 'pending', 'ready', 'stale']).default('live'),
  derived_at: dateOrNull.optional(),
  normalization_version: stringOrNull.optional(),
  history_complete: z.boolean().default(false),
  inventory_status: z.enum(['not_checked', 'matched', 'mismatched', 'unavailable']).default('not_checked'),
  inventory_as_of: dateOrNull.optional(),
  inventory_mismatch_count: count.optional(),
  inventory_unavailable_count: count.optional(),
  ambiguous_rfq_count: count.optional(),
  excluded_rfq_count: count.optional(),
  unmatched_rfq_count: count.optional(),
})

export const analyticsGroupSchema = contractObject({
  dimensions: analyticsDimensionsSchema,
  // Response keys are open for additive metrics; requests use the pinned allowlist.
  metrics: z.record(z.string(), analyticsMetricSchema),
})
export const analyticsSummarySchema = contractObject({
  account_id: z.string().uuid(),
  venue: stringOrNull.optional(),
  group_by: z.array(z.enum(ANALYTICS_GROUPINGS)).refine((values) => new Set(values).size === values.length),
  coverage: analyticsCoverageSchema,
  groups: z.array(analyticsGroupSchema),
})

export const transactionAccountingSchema = contractObject({
  status: z.enum(['calculated', 'unavailable']),
  currency: stringOrNull,
  quantity_unit: stringOrNull,
  contract_family: z.string(),
  method: z.literal('moving_weighted_average').optional(),
  average_price_after: decimalOrNull.optional(),
  average_price_before: decimalOrNull.optional(),
  closed_quantity: decimalOrNull.optional(),
  comparison_difference: decimalOrNull.optional(),
  cost_basis_after: decimalOrNull.optional(),
  cost_basis_before: decimalOrNull.optional(),
  execution_price: decimalOrNull.optional(),
  gross_profit: decimalOrNull.optional(),
  opened_quantity: decimalOrNull.optional(),
  quantity_after: decimalOrNull.optional(),
  quantity_before: decimalOrNull.optional(),
  settlement_cash_value: decimalOrNull.optional(),
  settlement_reference_price: decimalOrNull.optional(),
  source_reported_profit: decimalOrNull.optional(),
  notes: z.array(z.string()).default([]),
  reason_codes: z.array(z.string()).default([]),
  order_key: z.array(z.string()).default([]),
  reconciliation: z.record(z.string(), stringOrNull).optional(),
})

export const analyticsTransactionSchema = contractObject({
  id: z.string().uuid(),
  event_time: analyticsDateTimeSchema,
  account_id: z.string().uuid().nullable().optional(),
  venue: stringOrNull.optional(),
  category: z.enum(ANALYTICS_CATEGORIES),
  instrument: stringOrNull,
  currency: stringOrNull,
  denomination: z.string(),
  quantity_unit: stringOrNull,
  source_endpoint: z.string(),
  source_raw_batch_id: z.string().uuid(),
  venue_event_identifier: stringOrNull,
  order_identifier: stringOrNull,
  trade_identifier: stringOrNull,
  canonical_amount: decimalOrNull,
  canonical_currency: stringOrNull,
  canonical_quantity_unit: stringOrNull,
  canonical_price_currency: stringOrNull.optional(),
  canonical_quantity: decimalOrNull.optional(),
  economic_type: stringOrNull.optional(),
  price_currency: stringOrNull,
  mark_improvement_per_unit: decimalOrNull,
  mark_improvement_percent: decimalOrNull,
  mark_improvement_bps: decimalOrNull,
  side: stringOrNull,
  execution_price: decimalOrNull,
  mark_price: decimalOrNull,
  quantity: decimalOrNull,
  metrics: z.record(z.string(), decimalOrNull),
  missing_data: z.record(z.string(), z.string()),
  notes: z.array(z.string()),
  accounting: transactionAccountingSchema.nullable().optional(),
  regular_candidate_ids: z.array(z.string().uuid()).optional(),
  related_rfq_event_ids: z.array(z.string().uuid()).optional(),
  source_event_ids: z.array(z.string().uuid()).optional(),
  source_raw_batch_ids: z.array(z.string().uuid()).optional(),
})

export const analyticsTransactionPageSchema = contractObject({
  account_id: z.string().uuid(),
  venue: stringOrNull.optional(),
  coverage: analyticsCoverageSchema,
  items: z.array(analyticsTransactionSchema),
  next_cursor: stringOrNull,
})

const filterString = z.string().min(1).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'Invalid filter characters')
const sharedQuery = {
  start: analyticsDateTimeSchema.optional(),
  end: analyticsDateTimeSchema.optional(),
  instrument: filterString.optional(),
  category: z.enum(ANALYTICS_CATEGORIES).optional(),
  currency: filterString.optional(),
  denomination: filterString.optional(),
  quantity_unit: filterString.optional(),
  metric: z.enum(ANALYTICS_METRICS).optional(),
  instrument_is_null: z.enum(['true', 'false']).optional(),
  currency_is_null: z.enum(['true', 'false']).optional(),
  quantity_unit_is_null: z.enum(['true', 'false']).optional(),
}
const groupBy = z.string().transform((value) => value === '' ? [] : value.split(',').map((part) => part.trim()))
  .pipe(z.array(z.enum(ANALYTICS_GROUPINGS)).refine((values) => new Set(values).size === values.length, 'Duplicate grouping'))
const limit = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(200))

const summaryQuerySchema = z.strictObject({ ...sharedQuery, group_by: groupBy.optional() })
const transactionsQuerySchema = z.strictObject({ ...sharedQuery, cursor: filterString.optional(), limit: limit.optional() })

/** Keeps opaque cursors, exact values and explicit false/null-only filters intact. */
export function parseAnalyticsQuery(params: URLSearchParams, endpoint: AnalyticsEndpoint): URLSearchParams {
  const inputs: Record<string, string> = {}
  for (const [name, value] of params) {
    if (Object.prototype.hasOwnProperty.call(inputs, name)) throw new Error('Duplicate analytics query parameter')
    Object.defineProperty(inputs, name, { value, enumerable: true, configurable: true })
  }
  const query = endpoint === 'summary' ? summaryQuerySchema.parse(inputs) : transactionsQuerySchema.parse(inputs)
  if (query.start && query.end && compareAnalyticsInstants(query.start, query.end) >= 0) {
    throw new Error('Analytics start must precede end')
  }
  for (const name of ['instrument', 'currency', 'quantity_unit'] as const) {
    if (query[name] !== undefined && query[`${name}_is_null`] === 'true') throw new Error('Conflicting analytics null filter')
  }
  const search = new URLSearchParams()
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) search.set(name, Array.isArray(value) ? value.join(',') : String(value))
  }
  if (endpoint === 'transactions' && !search.has('limit')) search.set('limit', '50')
  return search
}

export type RawAnalyticsSummary = z.infer<typeof analyticsSummarySchema>
export type RawAnalyticsTransactionPage = z.infer<typeof analyticsTransactionPageSchema>
export type RawAnalyticsCoverage = z.infer<typeof analyticsCoverageSchema>
export type RawAnalyticsMetric = z.infer<typeof analyticsMetricSchema>
export type RawAnalyticsTransaction = z.infer<typeof analyticsTransactionSchema>
export type RawTransactionAccounting = z.infer<typeof transactionAccountingSchema>
