import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { HubSummary, HubSummaryComponent } from '@/lib/portfolioDataHub'
import type { ExactDecimal } from '@/lib/portfolioDataHub/schemas'

const areaChartSpy = vi.hoisted(() => vi.fn())

vi.mock('../charts/AreaChart', () => ({
  AreaChart: (props: { testId?: string }) => {
    areaChartSpy(props)
    return <div data-testid={props.testId} />
  },
}))

import { HubPerformanceTrends } from '../charts/HubPerformanceTrends'

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

function summary(id: string, fetchedAt: string, components: HubSummaryComponent[]): HubSummary {
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

function chartProps(testId: string) {
  const call = areaChartSpy.mock.calls.find(([props]) => props.testId === testId)
  expect(call, `Expected ${testId} to render`).toBeDefined()
  return call![0] as { data: Array<{ t: string; v: number | null }> }
}

beforeEach(() => areaChartSpy.mockClear())

describe('HubPerformanceTrends', () => {
  it('resolves headlines for the explicit currency and preserves history gaps passed to charts', () => {
    const history = [
      summary('one', '2026-09-01T00:00:00Z', [
        component({ equity: exact('1'), realizedPnl: exact('0.1'), unrealizedPnl: exact('0.2') }),
      ]),
      summary('gap', '2026-09-02T00:00:00Z', [
        component({ currency: 'USDC', equity: exact('200'), realizedPnl: exact('20'), unrealizedPnl: exact('30') }),
      ]),
    ]
    const current = summary('current', '2026-09-03T00:00:00Z', [
      component({ currency: 'USDC', equity: exact('999'), realizedPnl: exact('99'), unrealizedPnl: exact('88') }),
      component({ currency: 'BTC', componentScope: 'account', equity: exact('3') }),
      component({ currency: 'BTC', componentScope: 'asset_balance', realizedPnl: exact('0.4'), unrealizedPnl: exact('0.6') }),
    ])

    render(<HubPerformanceTrends history={history} current={current} currency="BTC" />)

    expect(screen.getByText('3.0000 BTC')).toBeInTheDocument()
    expect(screen.getByText('0.4000 BTC')).toBeInTheDocument()
    expect(screen.getByText('0.6000 BTC')).toBeInTheDocument()
    expect(chartProps('hub-equity-trend').data).toEqual([
      { t: '2026-09-01T00:00:00Z', v: 1 },
      { t: '2026-09-02T00:00:00Z', v: null },
      { t: '2026-09-03T00:00:00Z', v: 3 },
    ])
  })

  it('requires two non-null values rather than counting null snapshots as trend data', () => {
    const history = [
      summary('one', '2026-09-01T00:00:00Z', [component({ equity: exact('1') })]),
      summary('gap', '2026-09-02T00:00:00Z', [component({ currency: 'USDC', equity: exact('20') })]),
    ]
    const current = summary('current', '2026-09-03T00:00:00Z', [component({ balance: exact('2') })])

    render(<HubPerformanceTrends history={history} current={current} currency="BTC" />)

    expect(screen.getAllByText(/second historical snapshot/i)).toHaveLength(3)
    expect(screen.queryByTestId('hub-equity-trend')).toBeNull()
    expect(areaChartSpy).not.toHaveBeenCalled()
  })

  it('rebuilds every headline and series when the explicit currency changes', () => {
    const history = [
      summary('one', '2026-09-01T00:00:00Z', [
        component({ currency: 'BTC', equity: exact('1'), realizedPnl: exact('0.1'), unrealizedPnl: exact('0.2') }),
        component({ currency: 'USDC', equity: exact('10'), realizedPnl: exact('1'), unrealizedPnl: exact('2') }),
      ]),
    ]
    const current = summary('current', '2026-09-02T00:00:00Z', [
      component({ currency: 'BTC', equity: exact('2'), realizedPnl: exact('0.2'), unrealizedPnl: exact('0.4') }),
      component({ currency: 'USDC', equity: exact('30'), realizedPnl: exact('3'), unrealizedPnl: exact('4') }),
    ])
    const { rerender } = render(<HubPerformanceTrends history={history} current={current} currency="BTC" />)
    expect(screen.getByText('2.0000 BTC')).toBeInTheDocument()

    areaChartSpy.mockClear()
    rerender(<HubPerformanceTrends history={history} current={current} currency="USDC" />)

    expect(screen.getByText('30.00 USDC')).toBeInTheDocument()
    expect(screen.getByText('3.00 USDC')).toBeInTheDocument()
    expect(screen.getByText('4.00 USDC')).toBeInTheDocument()
    expect(screen.queryByText(/BTC$/)).toBeNull()
    expect(chartProps('hub-equity-trend').data.map((point) => point.v)).toEqual([10, 30])
    expect(chartProps('hub-realizedPnl-trend').data.map((point) => point.v)).toEqual([1, 3])
    expect(chartProps('hub-unrealizedPnl-trend').data.map((point) => point.v)).toEqual([2, 4])
  })
})
