import { describe, expect, it } from 'vitest'
import type { HubSummary, HubSummaryComponent } from '@/lib/portfolioDataHub'
import type { ExactDecimal } from '@/lib/portfolioDataHub/schemas'
import {
  buildCurrencyMetricSeries,
  fundedCurrenciesFromSummary,
  groupSummaryComponentsByCurrency,
  resolveAccountCurrency,
  resolveCurrencyMetric,
} from '../accountCurrency'

const exact = (value: string) => value as ExactDecimal

function component(overrides: Partial<HubSummaryComponent> = {}): HubSummaryComponent {
  return {
    currency: 'BTC',
    componentScope: 'account',
    equity: null,
    balance: null,
    collateral: null,
    availableFunds: null,
    availableWithdrawalFunds: null,
    initialMargin: null,
    maintenanceMargin: null,
    realizedPnl: null,
    unrealizedPnl: null,
    attributes: {},
    ...overrides,
  }
}

function summary(
  id: string,
  fetchedAt: string,
  components: HubSummaryComponent[],
): HubSummary {
  return {
    id,
    accountId: '11111111-1111-4111-8111-111111111111',
    accountLabel: 'Primary',
    canonicalSchemaVersion: '1.0',
    runId: `run-${id}`,
    fetchedAt,
    venueObservedAt: fetchedAt,
    processingVersion: 'test',
    quality: 'complete',
    venue: 'deribit',
    sourceRawBatchId: null,
    ingestedAt: fetchedAt,
    components,
    attributes: {},
  }
}

describe('account currency grouping and funding', () => {
  it('canonicalizes valid labels, rejects invalid labels, and preserves component order within a group', () => {
    const first = component({ currency: ' usdc ', componentScope: 'asset_balance' })
    const second = component({ currency: 'USDC', componentScope: 'account' })
    const groups = groupSummaryComponentsByCurrency([
      component({ currency: 'A' }),
      first,
      component({ currency: 'US$' }),
      second,
      component({ currency: 'TOO-LONG-CURRENCY' }),
      component({ currency: ' btc ' }),
    ])

    expect([...groups.keys()]).toEqual(['USDC', 'BTC'])
    expect(groups.get('USDC')).toEqual([first, second])
  })

  it('uses only exact non-zero equity, balance, or collateral and returns sorted unique currencies', () => {
    const components = [
      component({ currency: 'ZERO', equity: exact('0'), balance: exact('+0.0'), collateral: exact('-0') }),
      component({ currency: 'EQT', equity: exact('1e-4000') }),
      component({ currency: 'NEG', balance: exact('-0.0001') }),
      component({ currency: 'COL', collateral: exact('2') }),
      component({ currency: 'PNL', realizedPnl: exact('5'), unrealizedPnl: exact('-2') }),
      component({ currency: 'FUNDS', availableFunds: exact('4'), availableWithdrawalFunds: exact('3') }),
      component({ currency: 'MARGIN', initialMargin: exact('1'), maintenanceMargin: exact('1') }),
      component({ currency: 'BAD', equity: 'not-a-decimal' as ExactDecimal }),
      component({ currency: 'EQT', balance: exact('0') }),
    ]

    expect(fundedCurrenciesFromSummary(components)).toEqual(['COL', 'EQT', 'NEG'])
  })
})

describe('resolveAccountCurrency', () => {
  const zeroBnb = component({ currency: 'BNB', equity: exact('0') })
  const fundedBtc = component({ currency: 'BTC', balance: exact('0.25') })

  it('infers the sole funded currency independently of API ordering without mutating input', () => {
    const forward = [zeroBnb, fundedBtc]
    const reverse = [...forward].reverse()
    const before = structuredClone(forward)

    expect(resolveAccountCurrency(forward, null, null)).toEqual({
      status: 'resolved',
      currency: 'BTC',
      source: 'inferred',
      fundedCurrencies: ['BTC'],
      availableCurrencies: ['BNB', 'BTC'],
    })
    expect(resolveAccountCurrency(reverse, null, null)).toMatchObject({ status: 'resolved', currency: 'BTC' })
    expect(forward).toEqual(before)
  })

  it.each(['client', 'admin'] as const)('keeps a present zero-valued persisted currency and its %s provenance', (source) => {
    expect(resolveAccountCurrency([fundedBtc, component({ currency: 'usdc', balance: exact('0') })], ' USDC ', source)).toMatchObject({
      status: 'resolved',
      currency: 'USDC',
      source,
    })
  })

  it('requires selection when multiple currencies are funded', () => {
    expect(resolveAccountCurrency([
      fundedBtc,
      component({ currency: 'USDC', collateral: exact('100') }),
    ], null, null)).toEqual({
      status: 'selection-required',
      reason: 'multiple-funded',
      savedCurrency: null,
      fundedCurrencies: ['BTC', 'USDC'],
      availableCurrencies: ['BTC', 'USDC'],
    })
  })

  it('requires selection when no currency is funded', () => {
    expect(resolveAccountCurrency([zeroBnb], null, null)).toEqual({
      status: 'selection-required',
      reason: 'no-funded-currency',
      savedCurrency: null,
      fundedCurrencies: [],
      availableCurrencies: ['BNB'],
    })
  })

  it('fails closed and retains context when a valid persisted currency is missing', () => {
    expect(resolveAccountCurrency([fundedBtc], 'USDC', 'client')).toEqual({
      status: 'selection-required',
      reason: 'saved-currency-missing',
      savedCurrency: 'USDC',
      fundedCurrencies: ['BTC'],
      availableCurrencies: ['BTC'],
    })
  })

  it('never exposes invalid component or persisted labels', () => {
    expect(resolveAccountCurrency([
      component({ currency: 'US$', equity: exact('10') }),
      fundedBtc,
    ], 'NO!', 'client')).toEqual({
      status: 'resolved',
      currency: 'BTC',
      source: 'inferred',
      fundedCurrencies: ['BTC'],
      availableCurrencies: ['BTC'],
    })
  })
})

describe('resolveCurrencyMetric', () => {
  it('applies scope priority separately for every field without summing', () => {
    const components = [
      component({ currency: 'BTC', componentScope: 'asset_balance', equity: exact('40'), balance: exact('7') }),
      component({ currency: ' btc ', componentScope: 'margin_account', equity: exact('20'), collateral: exact('3') }),
      component({ currency: 'BTC', componentScope: 'account', equity: exact('10') }),
      component({ currency: 'BTC', componentScope: 'account_valuation', balance: exact('9') }),
      component({ currency: 'USDC', componentScope: 'account', availableFunds: exact('999') }),
    ]

    expect(resolveCurrencyMetric(components, ' btc ', 'equity')).toBe('10')
    expect(resolveCurrencyMetric(components, 'BTC', 'balance')).toBe('9')
    expect(resolveCurrencyMetric(components, 'BTC', 'collateral')).toBe('3')
    expect(resolveCurrencyMetric(components, 'BTC', 'availableFunds')).toBeNull()
  })

  it('falls back to a remaining same-currency component in API order', () => {
    const components = [
      component({ currency: 'BTC', componentScope: 'asset_balance', availableFunds: exact('4') }),
      component({ currency: 'BTC', componentScope: 'venue_extension', availableFunds: exact('5') }),
    ]
    expect(resolveCurrencyMetric(components, 'BTC', 'availableFunds')).toBe('4')
    expect(resolveCurrencyMetric(components, 'bad!', 'availableFunds')).toBeNull()
  })
})

describe('buildCurrencyMetricSeries', () => {
  it('isolates the selected currency, preserves null gaps, and sorts full timestamps ascending', () => {
    const history = [
      summary('b', '2026-09-03T12:00:00Z', [component({ currency: 'USDC', equity: exact('300') })]),
      summary('a', '2026-09-01T12:00:00Z', [component({ currency: 'BTC', equity: exact('1') })]),
      summary('c', '2026-09-02T12:00:00Z', [component({ currency: 'BTC', balance: exact('2') })]),
    ]
    const current = summary('d', '2026-09-04T12:00:00Z', [component({ currency: 'BTC', equity: exact('4') })])

    expect(buildCurrencyMetricSeries(history, current, 'BTC', 'equity')).toEqual([
      { t: '2026-09-01T12:00:00Z', v: 1 },
      { t: '2026-09-02T12:00:00Z', v: null },
      { t: '2026-09-03T12:00:00Z', v: null },
      { t: '2026-09-04T12:00:00Z', v: 4 },
    ])
  })

  it('keeps the greatest history id at duplicate timestamps and does not overwrite it with current', () => {
    const fetchedAt = '2026-09-01T00:00:00Z'
    const history = [
      summary('z-summary', fetchedAt, [component({ equity: exact('9') })]),
      summary('a-summary', fetchedAt, [component({ equity: exact('1') })]),
    ]
    const current = summary('zz-current', fetchedAt, [component({ equity: exact('99') })])

    expect(buildCurrencyMetricSeries(history, current, 'BTC', 'equity')).toEqual([{ t: fetchedAt, v: 9 }])
  })

  it('uses the same field-specific metric precedence as current values', () => {
    const earlier = summary('a', '2026-09-01T00:00:00Z', [
      component({ componentScope: 'asset_balance', balance: exact('8') }),
      component({ componentScope: 'account_valuation', balance: exact('6') }),
    ])
    const current = summary('b', '2026-09-02T00:00:00Z', [
      component({ componentScope: 'account', balance: exact('4') }),
    ])

    expect(buildCurrencyMetricSeries([earlier], current, 'BTC', 'balance')).toEqual([
      { t: '2026-09-01T00:00:00Z', v: 6 },
      { t: '2026-09-02T00:00:00Z', v: 4 },
    ])
  })
})
