import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseHubAnalyticsSummary, parseHubAnalyticsTransactionPage } from '../analyticsNormalizers'
import { PortfolioHubClientError } from '../client'
import {
  analyticsQueryKey, captureAnalyticsPeriod, fetchPortfolioHubAnalyticsSummary,
  fetchPortfolioHubAnalyticsTransactions, validateAnalyticsPair,
} from '../analyticsClient'

const root = resolve(process.cwd(), 'docs/integrations/2026-10-21-transaction-analytics/synthetic')
const load = (name: string) => JSON.parse(readFileSync(resolve(root, `${name}.json`), 'utf8'))
const window = { start: '2026-10-01T00:00:00Z', end: '2026-10-21T12:00:00Z' }
const response = (data: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(data), { status, headers })
function pair() {
  return { totals: parseHubAnalyticsSummary(load('costs-funding-activity')), daily: parseHubAnalyticsSummary(load('daily-profit')) }
}

describe('authenticated analytics client', () => {
  it('calls only the protected summary route with Supabase auth and validated exact filters', async () => {
    const { totals } = pair()
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ data: totals }))
    const signal = new AbortController().signal
    const data = await fetchPortfolioHubAnalyticsSummary('session-token', { ...window, groupBy: ['day'], metric: 'calculated_realized_gross_profit', denomination: 'USDC', quantityUnit: 'BTC_face_value', currencyIsNull: true, instrumentIsNull: false }, fetch, signal)
    const [path, init] = fetch.mock.calls[0]
    expect(String(path)).toMatch(/^\/api\/portfolio-data-hub\/analytics\/summary\?/)
    const query = new URL(String(path), 'https://portal.example').searchParams
    expect(query.get('quantity_unit')).toBe('BTC_face_value')
    expect(query.get('currency_is_null')).toBe('true')
    expect(query.get('instrument_is_null')).toBe('false')
    expect(query.get('group_by')).toBe('day')
    expect(query.has('account_id')).toBe(false)
    expect(init?.headers).toMatchObject({ authorization: 'Bearer session-token' })
    expect(init?.signal).toBe(signal)
    expect(data.groups[0].metrics.executed_quantity.value).toBe('0.020000000000000001')
  })

  it('preserves exact transaction context, null-only filters and opaque cursor with a default 50-row page', async () => {
    const raw = parseHubAnalyticsTransactionPage(load('partial-transactions-page-1'))
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ data: raw }))
    const data = await fetchPortfolioHubAnalyticsTransactions('session-token', { ...window, metric: 'calculated_realized_gross_profit', currencyIsNull: true, quantityUnitIsNull: true, cursor: 'opaque +/=?&' }, fetch)
    const query = new URL(String(fetch.mock.calls[0][0]), 'https://portal.example').searchParams
    expect(query.get('cursor')).toBe('opaque +/=?&')
    expect(query.get('limit')).toBe('50')
    expect(query.get('quantity_unit_is_null')).toBe('true')
    expect(data.nextCursor).toBe('synthetic-opaque-next-page')
    expect(data.items[0].metrics.calculated_realized_gross_profit).toBe('-66.0000000000000000')
  })

  it('round-trips omitted optional coverage counts and unavailable values', async () => {
    const raw = load('unavailable')
    for (const name of ['ambiguous_rfq_count', 'excluded_rfq_count', 'inventory_mismatch_count']) delete raw.coverage[name]
    const normalized = parseHubAnalyticsSummary(raw)
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ data: normalized }))
    const data = await fetchPortfolioHubAnalyticsSummary('token', window, fetch)
    expect(data.coverage.ambiguousRfqCount).toBeNull()
    expect(data.groups[0].metrics.net_funding.value).toBeNull()
  })

  it('rejects invalid filters before any fetch', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    await expect(fetchPortfolioHubAnalyticsSummary('token', { ...window, currency: 'USD', currencyIsNull: true }, fetch)).rejects.toMatchObject({ code: 'ANALYTICS_INVALID_QUERY' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects malformed successful financial data rather than trusting numeric amounts', async () => {
    const data = pair().totals
    const malformed = JSON.parse(JSON.stringify(data))
    malformed.groups[0].metrics.executed_quantity.value = 0.02
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ data: malformed }))
    await expect(fetchPortfolioHubAnalyticsSummary('token', window, fetch)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it.each(['ANALYTICS_INVALID_QUERY', 'ANALYTICS_INVALID_CURSOR', 'ANALYTICS_PUBLICATION_CONFLICT'])('preserves the actionable %s code and confirmed mapping', async (code) => {
    const id = pair().totals.accountId
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ error: { code, message: 'Safe error' } }, code === 'ANALYTICS_PUBLICATION_CONFLICT' ? 409 : 400, { 'x-portfolio-hub-account-id': id }))
    await expect(fetchPortfolioHubAnalyticsSummary('token', window, fetch)).rejects.toMatchObject({ code, mappedAccountId: id })
  })

  it('keeps exact request keys stable across filter object order, distinct across windows and null filters', () => {
    expect(analyticsQueryKey(window, { currency: 'USD', denomination: 'USDC' })).toBe(analyticsQueryKey(window, { denomination: 'USDC', currency: 'USD' }))
    expect(analyticsQueryKey(window)).not.toBe(analyticsQueryKey(window, { currencyIsNull: false }))
    expect(analyticsQueryKey(window)).not.toBe(analyticsQueryKey({ ...window, end: '2026-10-21T12:00:00.000001Z' }))
  })
})

describe('captured UTC periods', () => {
  it('captures month-to-date and last 30 × 24 hours using one instant', () => {
    const now = new Date('2026-10-21T14:35:00+02:00')
    expect(captureAnalyticsPeriod({ kind: 'month-to-date' }, now)).toEqual({ start: '2026-10-01T00:00:00.000Z', end: '2026-10-21T12:35:00.000Z' })
    expect(captureAnalyticsPeriod({ kind: 'last-30-days' }, now)).toEqual({ start: '2026-09-21T12:35:00.000Z', end: '2026-10-21T12:35:00.000Z' })
  })
  it('converts inclusive custom dates through UTC year and leap-day boundaries', () => {
    expect(captureAnalyticsPeriod({ kind: 'custom', startDate: '2026-12-31', endDate: '2026-12-31' })).toEqual({ start: '2026-12-31T00:00:00.000Z', end: '2027-01-01T00:00:00.000Z' })
    expect(captureAnalyticsPeriod({ kind: 'custom', startDate: '2024-02-29', endDate: '2024-02-29' }).end).toBe('2024-03-01T00:00:00.000Z')
  })
  it.each([['2026-02-30', '2026-03-01'], ['2026-10-22', '2026-10-21'], ['', '2026-10-21']])('rejects invalid custom range %s..%s', (startDate, endDate) => {
    expect(() => captureAnalyticsPeriod({ kind: 'custom', startDate, endDate })).toThrow()
  })
})

describe('summary pair consistency', () => {
  it('retains independent period totals without calculating them from daily bars', () => {
    const { totals, daily } = pair()
    totals.groups[0].metrics.calculated_realized_gross_profit.value = '999' as never
    const data = validateAnalyticsPair(totals, daily, window, {})
    expect(data.totals).toBe(totals)
    expect(data.daily).toBe(daily)
  })
  it.each(['account', 'build time', 'version', 'processing'])('identifies a publication conflict for %s', (kind) => {
    const { totals, daily } = pair()
    if (kind === 'account') daily.accountId = '00000000-0000-4000-8000-000000000099'
    if (kind === 'build time') daily.coverage.derivedAt = '2026-10-21T12:02:00Z'
    if (kind === 'version') daily.coverage.normalizationVersion = 'new-version'
    if (kind === 'processing') daily.coverage.derivedStatus = 'stale'
    expect(() => validateAnalyticsPair(totals, daily, window, {})).toThrow(PortfolioHubClientError)
    try { validateAnalyticsPair(totals, daily, window, {}) } catch (error) { expect(error).toMatchObject({ code: 'ANALYTICS_PUBLICATION_CONFLICT' }) }
  })
  it.each(['venue', 'period', 'grouping'])('rejects inconsistent %s without treating it as a rebuild', (kind) => {
    const { totals, daily } = pair()
    if (kind === 'venue') daily.venue = 'deribit'
    if (kind === 'period') daily.coverage.requestedEnd = null
    if (kind === 'grouping') daily.groupBy = []
    try { validateAnalyticsPair(totals, daily, window, {}) } catch (error) { expect(error).toMatchObject({ code: 'INVALID_RESPONSE' }); return }
    throw new Error('Expected consistency rejection')
  })
  it('reports missing build evidence explicitly, including ready responses', () => {
    const { totals, daily } = pair()
    daily.coverage.derivedAt = null
    totals.coverage.normalizationVersion = null
    expect(validateAnalyticsPair(totals, daily, window, {}).consistencyLimitations).toHaveLength(2)
  })
})
