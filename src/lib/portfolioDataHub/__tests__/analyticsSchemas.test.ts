import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ANALYTICS_CATEGORIES, ANALYTICS_GROUPINGS, ANALYTICS_METRICS,
  analyticsSummarySchema, analyticsTransactionPageSchema,
  compareAnalyticsInstants, parseAnalyticsQuery,
} from '../analyticsSchemas'
import { parseHubAnalyticsSummary, parseHubAnalyticsTransactionPage } from '../analyticsNormalizers'

const root = resolve(process.cwd(), 'docs/integrations/2026-10-21-transaction-analytics')
const load = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const example = (account: string, file: string) => load(`provider/analytics_handoff/examples/${account}/${file}.json`)
const synthetic = (name: string) => load(`synthetic/${name}.json`)

describe('analytics schemas and normalization', () => {
  it.each(['annamite', 'coincall', 'dwf', 'nickel', 'paradex', 'paradex-hype'])('parses %s without requiring a canonical schema version', (account) => {
    const raw = example(account, 'summary')
    const summary = parseHubAnalyticsSummary(raw)
    const page = parseHubAnalyticsTransactionPage(example(account, 'transactions'))
    expect(summary.accountId).toBe(raw.account_id)
    expect(summary.coverage.historyComplete).toBe(false)
    expect(summary.groups[0].dimensions.quantityUnit).toBe(raw.groups[0].dimensions.quantity_unit)
    expect(summary.groups[0].metrics.calculated_realized_gross_profit.value)
      .toBe(raw.groups[0].metrics.calculated_realized_gross_profit.value)
    expect(page.items[0].accounting?.grossProfit).toBe(page.items[0].metrics.calculated_realized_gross_profit)
  })

  it.each(load('synthetic/index.json').summary_scenarios as string[])('parses the %s fixture', (name) => {
    expect(() => parseHubAnalyticsSummary(synthetic(name))).not.toThrow()
  })

  it('retains zero, partial, null, absent metrics, unknown units and long decimals distinctly', () => {
    expect(parseHubAnalyticsSummary(synthetic('explicit-zero')).groups[0].metrics.calculated_realized_gross_profit.value).toBe('0')
    expect(parseHubAnalyticsSummary(synthetic('partial')).groups[0].metrics.calculated_realized_gross_profit.missingCount).toBe(1)
    expect(parseHubAnalyticsSummary(synthetic('unavailable')).groups[0].metrics.net_funding.value).toBeNull()
    expect(parseHubAnalyticsSummary(synthetic('ineligible')).groups[0].metrics).not.toHaveProperty('calculated_realized_gross_profit')
    expect(parseHubAnalyticsSummary(synthetic('multiple-partitions')).groups[4].dimensions.quantityUnit).toBeNull()
    expect(parseHubAnalyticsSummary(synthetic('costs-funding-activity')).groups[0].metrics.executed_quantity.value).toBe('0.020000000000000001')
  })

  it('preserves exponent strings and additive fields/metrics without changing metric or reason keys', () => {
    const raw = synthetic('partial-transactions-page-1')
    raw.items[0].execution_price = '0E+2'
    raw.items[0].metrics.future_metric = '1.0000000000000000001'
    raw.items[0].future_field = { nested_field: 'still-opaque' }
    raw.items[0].accounting.reason_codes = ['future_reason_code']
    const parsed = parseHubAnalyticsTransactionPage(raw)
    expect(parsed.items[0].executionPrice).toBe('0E+2')
    expect(parsed.items[0].metrics.future_metric).toBe('1.0000000000000000001')
    expect(parsed.items[0]).toHaveProperty('futureField', { nested_field: 'still-opaque' })
    expect(parsed.items[0].accounting?.reasonCodes).toContain('future_reason_code')
    const summary = synthetic('explicit-zero')
    summary.groups[0].metrics.future_metric = { ...summary.groups[0].metrics.calculated_realized_gross_profit }
    summary.coverage.future_field = true
    expect(parseHubAnalyticsSummary(summary).groups[0].metrics.future_metric.value).toBe('0')
    expect(parseHubAnalyticsSummary(summary).coverage).toHaveProperty('futureField', true)
  })

  it('does not invent build evidence when optional metadata is omitted', () => {
    const raw = synthetic('empty')
    for (const key of ['derived_status', 'derived_at', 'normalization_version', 'inventory_mismatch_count']) delete raw.coverage[key]
    const data = parseHubAnalyticsSummary(raw)
    expect(data.coverage.derivedStatus).toBe('live')
    expect(data.coverage.derivedAt).toBeNull()
    expect(data.coverage.normalizationVersion).toBeNull()
    expect(data.coverage.inventoryMismatchCount).toBeNull()
  })

  it.each([1.5, 'NaN', 'Infinity', '', '1,000'])('rejects invalid amount %s', (value) => {
    const raw = synthetic('explicit-zero')
    raw.groups[0].metrics.calculated_realized_gross_profit.value = value
    expect(analyticsSummarySchema.safeParse(raw).success).toBe(false)
  })

  it('rejects malformed counts, units, dates and accounting values', () => {
    for (const field of ['eligible_count', 'missing_count']) {
      const raw = synthetic('explicit-zero')
      raw.groups[0].metrics.calculated_realized_gross_profit[field] = -1
      expect(analyticsSummarySchema.safeParse(raw).success).toBe(false)
    }
    const raw = synthetic('explicit-zero')
    raw.groups[0].metrics.calculated_realized_gross_profit.missing_count = 2
    expect(analyticsSummarySchema.safeParse(raw).success).toBe(false)
    raw.groups[0].metrics.calculated_realized_gross_profit.missing_count = 0
    delete raw.groups[0].dimensions.quantity_unit
    expect(analyticsSummarySchema.safeParse(raw).success).toBe(false)
    const page = synthetic('partial-transactions-page-1')
    page.items[0].accounting.gross_profit = 0
    expect(analyticsTransactionPageSchema.safeParse(page).success).toBe(false)
    page.items[0].accounting.gross_profit = '0'
    page.items[0].event_time = '2026-10-01T00:00:00'
    expect(analyticsTransactionPageSchema.safeParse(page).success).toBe(false)
  })
})

describe('analytics query validation', () => {
  it('pins the complete request allowlists to the supplied OpenAPI', () => {
    const spec = load('provider/analytics_handoff/openapi.json')
    const parameters = spec.paths['/api/v1/accounts/{account_id}/analytics/summary'].get.parameters
    expect(ANALYTICS_METRICS).toEqual(parameters.find((p: { name: string }) => p.name === 'metric').schema.anyOf[0].enum)
    expect(ANALYTICS_CATEGORIES).toEqual(parameters.find((p: { name: string }) => p.name === 'category').schema.anyOf[0].enum)
    expect(ANALYTICS_GROUPINGS).toEqual(spec.components.schemas.AnalyticsSummary.properties.group_by.items.enum)
  })

  it('accepts totals with no metric, currency or category defaults', () => {
    expect(parseAnalyticsQuery(new URLSearchParams(), 'summary').toString()).toBe('')
    expect(parseAnalyticsQuery(new URLSearchParams(), 'transactions').toString()).toBe('limit=50')
  })

  it('preserves every supported shared filter and opaque cursor exactly', () => {
    const params = new URLSearchParams({
      start: '2026-10-01T02:00:00+02:00', end: '2026-10-21T12:00:00.123456Z',
      instrument: 'BTC/OPTION:exact', category: 'exercise', currency: 'USD', denomination: 'USDC',
      quantity_unit: 'contracts', metric: 'execution_count', instrument_is_null: 'false',
      currency_is_null: 'false', quantity_unit_is_null: 'false', cursor: ' opaque+/=:% ?&', limit: '200',
    })
    expect([...parseAnalyticsQuery(params, 'transactions')]).toEqual([...params])
    const nulls = new URLSearchParams({ instrument_is_null: 'true', currency_is_null: 'true', quantity_unit_is_null: 'true' })
    const parsed = parseAnalyticsQuery(nulls, 'summary')
    expect([...parsed]).toEqual([...nulls])
  })

  it('supports every unique grouping combination, including day and month together', () => {
    for (let mask = 0; mask < 32; mask++) {
      const groupings = ANALYTICS_GROUPINGS.filter((_, i) => mask & (1 << i))
      const parsed = parseAnalyticsQuery(new URLSearchParams({ group_by: groupings.join(', ') }), 'summary')
      expect(parsed.get('group_by')).toBe(groupings.join(','))
    }
  })

  it('orders aware instants precisely across offsets and sub-millisecond boundaries', () => {
    expect(compareAnalyticsInstants('2026-10-01T02:00:00+02:00', '2026-10-01T00:00:00Z')).toBe(0)
    expect(compareAnalyticsInstants('2026-10-01T00:00:00.0000001Z', '2026-10-01T00:00:00.0000002Z')).toBe(-1)
    expect(() => parseAnalyticsQuery(new URLSearchParams({ start: '2026-10-01T00:00:00.0000001Z', end: '2026-10-01T00:00:00.0000002Z' }), 'summary')).not.toThrow()
  })

  it.each([
    'account_id=arbitrary', 'hub_account_id=arbitrary', 'client_id=arbitrary', 'unsupported=x',
    'currency=USD&currency=USDC', 'start=2026-10-01', 'start=2026-10-01T00:00:00',
    'start=2026-02-30T00:00:00Z', 'start=2026-10-02T00:00:00Z&end=2026-10-01T00:00:00Z',
    'start=2026-10-01T02:00:00%2B02:00&end=2026-10-01T00:00:00Z',
    'metric=unknown', 'category=unknown', 'currency=', 'currency=%00',
    'currency=USD&currency_is_null=true', 'instrument=X&instrument_is_null=true',
    'quantity_unit=BTC&quantity_unit_is_null=true', 'currency_is_null=maybe', 'denomination_is_null=true',
  ])('rejects unsupported or inconsistent input %s', (query) => {
    for (const endpoint of ['summary', 'transactions'] as const) expect(() => parseAnalyticsQuery(new URLSearchParams(query), endpoint)).toThrow()
  })

  it.each(['group_by=day,day', 'group_by=day,', 'group_by=venue', 'cursor=abc', 'limit=50'])('rejects unsupported summary query %s', (query) => {
    expect(() => parseAnalyticsQuery(new URLSearchParams(query), 'summary')).toThrow()
  })

  it.each(['group_by=day', 'cursor=', 'limit=0', 'limit=201', 'limit=1.5', 'limit=-1', 'limit=NaN'])('rejects unsupported detail query %s', (query) => {
    expect(() => parseAnalyticsQuery(new URLSearchParams(query), 'transactions')).toThrow()
  })

  it.each(['1', '200'])('accepts detail limit %s', (limit) => {
    expect(parseAnalyticsQuery(new URLSearchParams({ limit }), 'transactions').get('limit')).toBe(limit)
  })
})
