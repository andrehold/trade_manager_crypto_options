import { describe, expect, it } from 'vitest'
import { parseHubAnalyticsSummary } from '@/lib/portfolioDataHub'
import { analyticsDrillFilters, rowMatchesDrill } from '../analyticsDrillFilters'
import { parseHubAnalyticsTransactionPage } from '@/lib/portfolioDataHub'
import type { AnalyticsResultSelection } from '../../components/analytics/analyticsPresentation'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function selection(): AnalyticsResultSelection {
  const summary = parseHubAnalyticsSummary(JSON.parse(readFileSync(resolve(process.cwd(), 'docs/integrations/2026-10-21-transaction-analytics/synthetic/partial.json'), 'utf8')))
  return { metric: 'calculated_realized_gross_profit', group: summary.groups[0], window: { start: '2026-10-05T13:00:00.123456Z', end: '2026-10-21T12:00:00Z' }, filters: { instrument: 'SYNTHETIC-BTC-OPTION', category: 'exercise', currencyIsNull: false } }
}

describe('exact contributing-transaction scope', () => {
  it('retains all original filters and every mandatory partition without narrowing profit to trading', () => {
    const s = selection()
    expect(analyticsDrillFilters(s)).toEqual({ ...s.filters, ...s.window, metric: s.metric, limit: 50, currency: 'USDT', denomination: 'USDT', quantityUnit: 'BTC_face_value' })
    s.filters = {}
    expect(analyticsDrillFilters(s)).not.toHaveProperty('category')
  })
  it('intersects a day with a partial first day without dropping submillisecond precision', () => {
    const s = selection()
    s.group.dimensions.day = '2026-10-05'
    expect(analyticsDrillFilters(s)).toMatchObject({ start: s.window.start, end: '2026-10-06T00:00:00.000Z' })
    s.group.dimensions.day = '2026-10-21'
    expect(analyticsDrillFilters(s)).toMatchObject({ start: '2026-10-21T00:00:00.000Z', end: s.window.end })
  })
  it('intersects month and day buckets together, including December rollover', () => {
    const s = selection()
    s.window = { start: '2026-11-30T00:00:00Z', end: '2027-01-21T00:00:00Z' }
    s.group.dimensions.month = '2026-12'
    expect(analyticsDrillFilters(s)).toMatchObject({ start: '2026-12-01T00:00:00.000Z', end: '2027-01-01T00:00:00.000Z' })
    s.group.dimensions.day = '2026-12-31'
    expect(analyticsDrillFilters(s).start).toBe('2026-12-31T00:00:00.000Z')
  })
  it('uses explicit null-only filters and preserves false flags for nonnull partitions', () => {
    const s = selection()
    s.filters = {}
    s.group.dimensions = { currency: null, denomination: 'unknown', quantityUnit: null, instrument: null }
    expect(analyticsDrillFilters(s)).toMatchObject({ currencyIsNull: true, quantityUnitIsNull: true, instrumentIsNull: true, denomination: 'unknown' })
    expect(analyticsDrillFilters(s)).not.toHaveProperty('currency')
  })
  it('rejects unsupported null denominations instead of requesting multiple partitions', () => {
    const s = selection()
    s.group.dimensions.denomination = null
    expect(() => analyticsDrillFilters(s)).toThrow(/unknown denomination/)
  })
  it('treats explicit false null flags as unrestricted and scopes a returned null partition to true', () => {
    const s = selection()
    s.filters = { currencyIsNull: false, quantityUnitIsNull: false, instrumentIsNull: false }
    s.group.dimensions = { currency: null, denomination: 'unknown', quantityUnit: null, instrument: null }
    expect(analyticsDrillFilters(s)).toMatchObject({ currencyIsNull: true, quantityUnitIsNull: true, instrumentIsNull: true })
    const page = parseHubAnalyticsTransactionPage(JSON.parse(readFileSync(resolve(process.cwd(), 'docs/integrations/2026-10-21-transaction-analytics/synthetic/partial-transactions-page-1.json'), 'utf8')))
    const row = { ...page.items[0], currency: null, quantityUnit: null, instrument: null }
    expect(rowMatchesDrill(row, { ...s.window, start: '2026-10-01T00:00:00Z', ...s.filters })).toBe(true)
  })
  it('rejects nonoverlapping buckets and contradictory original filters', () => {
    const s = selection()
    s.group.dimensions.day = '2026-09-30'
    expect(() => analyticsDrillFilters(s)).toThrow(/overlap/)
    delete s.group.dimensions.day
    s.filters.currency = 'USD'
    expect(() => analyticsDrillFilters(s)).toThrow(/conflicts/)
    s.filters = { quantityUnitIsNull: true }
    s.group.dimensions.quantityUnit = 'contracts'
    expect(() => analyticsDrillFilters(s)).toThrow(/conflicts/)
    s.filters = { category: 'funding' }
    s.group.dimensions.category = 'delivery'
    expect(() => analyticsDrillFilters(s)).toThrow(/conflicts/)
  })
})
