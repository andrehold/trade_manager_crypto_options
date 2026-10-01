import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import summaryFixture from '@/lib/portfolioDataHub/__fixtures__/paradex/summary-latest.json'
import positionsFixture from '@/lib/portfolioDataHub/__fixtures__/paradex/positions-latest.json'
import ledgerFixture from '@/lib/portfolioDataHub/__fixtures__/paradex/ledger-events.json'
import readyPerformanceFixture from '@/lib/portfolioDataHub/__fixtures__/performance/ready.json'
import provisionalPerformanceFixture from '@/lib/portfolioDataHub/__fixtures__/performance/provisional.json'
import unavailablePerformanceFixture from '@/lib/portfolioDataHub/__fixtures__/performance/unavailable.json'
import { parseHubLatestPositionPage, parseHubLedgerEventPage, parseHubPerformance, parseHubSummary } from '@/lib/portfolioDataHub'
import type { PortfolioHubOverview } from '@/lib/portfolioDataHub/client'
import type { PortfolioHubPerformanceState } from '../../usePortfolioDataHub'

vi.mock('../../usePortfolioDataHub', () => ({ usePortfolioHubLedger: vi.fn(), usePortfolioHubPositions: vi.fn() }))
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 200 }}>{children}</div>
    ),
  }
})

import { HubDashboard, HubLedgerHistory, HubNativePositionsTable, HubPositionsPage } from '../HubPortfolioView'
import { HubPerformancePanel } from '../HubPerformancePanel'
import { usePortfolioHubLedger, usePortfolioHubPositions } from '../../usePortfolioDataHub'

const mixedPositions = structuredClone(positionsFixture)
mixedPositions.snapshot.run_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const overview: PortfolioHubOverview = {
  summary: parseHubSummary(summaryFixture),
  positions: { ...parseHubLatestPositionPage(mixedPositions), pageToken: 'signed-page-token' },
  reportingCurrency: 'USDC',
  reportingCurrencySource: 'client' as const,
  alignment: {
    runAligned: false,
    mixedAge: true,
    summaryRunId: summaryFixture.run_id,
    positionsRunId: mixedPositions.snapshot.run_id,
    summaryFetchedAt: summaryFixture.fetched_at,
    positionsFetchedAt: mixedPositions.snapshot.fetched_at,
  },
}

const dashboardActions = {
  onOpenPositions: () => {},
  onOpenLedger: () => {},
  onRefresh: () => {},
  onSaveAccountCurrency: () => {},
}

function performanceState(data = parseHubPerformance(readyPerformanceFixture), overrides: Partial<PortfolioHubPerformanceState> = {}): PortfolioHubPerformanceState {
  return {
    status: 'ready', data, refreshing: false, refreshError: null,
    errorCode: null, retryAt: null, canRefresh: true,
    ...overrides,
  }
}

function summaryComponent(currency: string, values: Record<string, unknown> = {}) {
  return {
    ...overview.summary.components[0],
    currency,
    equity: null,
    balance: null,
    collateral: null,
    availableFunds: null,
    availableWithdrawalFunds: null,
    initialMargin: null,
    maintenanceMargin: null,
    realizedPnl: null,
    unrealizedPnl: null,
    ...values,
  }
}

beforeEach(() => {
  vi.mocked(usePortfolioHubLedger).mockReturnValue({
    events: [], nextCursor: null, loading: false, loadingMore: false, error: null, loadMore: vi.fn(),
  })
  vi.mocked(usePortfolioHubPositions).mockReturnValue({
    items: parseHubLatestPositionPage(mixedPositions).items, nextCursor: null, loadingMore: false, error: null, loadMore: vi.fn(),
  })
})

describe('Hub-backed portfolio views', () => {
  it('shows independent provenance and a mixed-age warning without inferring structures', () => {
    const onRefresh = vi.fn()
    render(<HubDashboard overview={overview} {...dashboardActions} onRefresh={onRefresh} />)
    expect(screen.getByTestId('hub-provenance')).toHaveTextContent('Summary as of')
    expect(screen.getByRole('status')).toHaveTextContent(/mixed-age data/i)
    expect(screen.getByText('BTC-USD-PERP')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^modify$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^close$/i })).toBeNull()
    expect(screen.getAllByText('1,250.13 USDC').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument()
  })

  it('prioritizes performance, then balance capacity, trends, and neutral risk values', () => {
    const earlier = structuredClone(overview.summary)
    earlier.fetchedAt = '2026-08-01T00:00:00.000Z'
    earlier.components[0] = { ...earlier.components[0], equity: '1100.00' as any }
    render(
      <HubDashboard
        overview={overview}
        history={[earlier]}
        {...dashboardActions}
      />,
    )

    const performance = screen.getByTestId('hub-kpi-row')
    expect(within(performance).getByText('Equity')).toBeInTheDocument()
    expect(within(performance).getByText('Realized P&L')).toBeInTheDocument()
    expect(within(performance).getByText('Unrealized P&L')).toBeInTheDocument()
    expect(within(performance).getByText('Balance')).toBeInTheDocument()
    expect(within(performance).getByText('Available funds')).toBeInTheDocument()
    expect(within(performance).getByText('1,200.00 USDC')).toBeInTheDocument()
    expect(within(performance).getByText('900.25 USDC')).toBeInTheDocument()
    expect(screen.getByTestId('hub-equity-trend')).toBeInTheDocument()

    const risk = screen.getByTestId('hub-risk-row')
    expect(within(risk).getByText('Initial margin')).toBeInTheDocument()
    expect(within(risk).getByText('Maintenance margin')).toBeInTheDocument()
    expect(within(risk).getByText('Collateral')).toBeInTheDocument()
    expect(within(risk).getByText('Available to withdraw')).toBeInTheDocument()
  })

  it('renders native Hub positions as read-only data', () => {
    render(<HubPositionsPage overview={overview} onRefresh={() => {}} />)
    expect(screen.getByText(/native venue positions/i)).toBeInTheDocument()
    expect(screen.getByText('BTC-USD-PERP')).toBeInTheDocument()
    expect(screen.queryByText('Control')).toBeNull()
  })

  it('renders inverse option premiums in their BTC quote currency with sans-serif tabular cells', () => {
    const sourcePosition = parseHubLatestPositionPage(mixedPositions).items[0]
    const inverseOption = {
      ...sourcePosition,
      nativeInstrumentId: 'BTC-25SEP26-52000-P',
      instrumentType: 'option' as const,
      quoteCurrency: 'BTC',
      settlementCurrency: 'BTC',
      quantity: '-12.5' as typeof sourcePosition.quantity,
      quantityUnit: 'BTC',
      averagePrice: '0.0525' as typeof sourcePosition.averagePrice,
      markPrice: '0.049' as typeof sourcePosition.markPrice,
      unrealizedPnl: '0.000000001' as typeof sourcePosition.unrealizedPnl,
    }
    render(<HubNativePositionsTable positions={[inverseOption]} quality="complete" />)

    const averagePriceCell = screen.getByText('0.0525 BTC').closest('td')
    expect(averagePriceCell).toHaveClass('text-right', 'tabular-nums')
    expect(averagePriceCell).not.toHaveClass('font-mono')
    expect(screen.getByText('0.0490 BTC')).toBeInTheDocument()
    expect(screen.getByText('<0.00000001 BTC')).toBeInTheDocument()
  })

  it('does not reuse the price quote currency for PnL or margin when settlement currency is unknown', () => {
    const sourcePosition = parseHubLatestPositionPage(mixedPositions).items[0]
    const unknownSettlement = {
      ...sourcePosition,
      quoteCurrency: 'USD',
      settlementCurrency: null,
      unrealizedPnl: '4.75' as typeof sourcePosition.unrealizedPnl,
      initialMargin: '1.25' as typeof sourcePosition.initialMargin,
    }
    render(<HubNativePositionsTable positions={[unknownSettlement]} quality="complete" />)

    expect(screen.getByText('4.75')).toBeInTheDocument()
    expect(screen.getByText('1.25')).toBeInTheDocument()
    expect(screen.queryByText('4.75 USD')).toBeNull()
    expect(screen.queryByText('1.25 USD')).toBeNull()
  })

  it('does not claim an authoritative zero when the position snapshot is partial', () => {
    const partial = structuredClone(overview)
    partial.positions.snapshot.quality = 'partial'
    partial.positions.snapshot.positionCount = 0
    partial.positions.items = []
    render(<HubDashboard overview={partial} {...dashboardActions} />)
    expect(screen.getAllByRole('status').some((node) => /partial position collection/i.test(node.textContent ?? ''))).toBe(true)
    expect(screen.getByText('Partial collection')).toBeInTheDocument()
    expect(screen.getByText(/not an authoritative zero-position result/i)).toBeInTheDocument()
  })

  it('infers the sole funded currency instead of the alphabetically first zero currency', () => {
    const multiCurrency = structuredClone(overview)
    multiCurrency.reportingCurrency = null
    multiCurrency.reportingCurrencySource = null
    multiCurrency.summary.components = [
      summaryComponent('BNB', { balance: '0' }),
      summaryComponent('BTC', { equity: '1.25', balance: '1.10' }),
      summaryComponent('ETH', { collateral: '-0' }),
    ] as typeof multiCurrency.summary.components

    const { rerender } = render(<HubDashboard overview={multiCurrency} {...dashboardActions} />)
    expect(screen.getByLabelText('Account currency')).toHaveValue('BTC')
    expect(screen.getByText('Detected from funded balance')).toBeInTheDocument()
    expect(screen.getAllByText('1.2500 BTC').length).toBeGreaterThan(0)

    multiCurrency.summary.components.reverse()
    rerender(<HubDashboard overview={multiCurrency} {...dashboardActions} />)
    expect(screen.getByLabelText('Account currency')).toHaveValue('BTC')
    expect(screen.getAllByText('1.2500 BTC').length).toBeGreaterThan(0)
  })

  it('suppresses currency-dependent sections until an ambiguous account currency is selected', () => {
    const ambiguous = structuredClone(overview)
    ambiguous.reportingCurrency = null
    ambiguous.reportingCurrencySource = null
    ambiguous.summary.components = [
      summaryComponent('BTC', { equity: '1' }),
      summaryComponent('USDC', { balance: '100' }),
    ] as typeof ambiguous.summary.components

    render(<HubDashboard overview={ambiguous} {...dashboardActions} />)
    expect(screen.getByText('Choose the account currency to show on this dashboard.')).toBeInTheDocument()
    expect(screen.queryByTestId('hub-kpi-row')).toBeNull()
    expect(screen.queryByTestId('hub-risk-row')).toBeNull()
    expect(screen.queryByTestId('hub-performance-trends')).toBeNull()
    expect(screen.getByText('Native positions')).toBeInTheDocument()
  })

  it('keeps a present persisted currency authoritative even when its values are zero', () => {
    const persisted = structuredClone(overview)
    persisted.reportingCurrency = 'USDC'
    persisted.reportingCurrencySource = 'client'
    persisted.summary.components = [
      summaryComponent('BTC', { equity: '2' }),
      summaryComponent('USDC', { equity: '0', balance: '0' }),
    ] as typeof persisted.summary.components

    render(<HubDashboard overview={persisted} {...dashboardActions} />)
    expect(screen.getByLabelText('Account currency')).toHaveValue('USDC')
    const performance = screen.getByTestId('hub-kpi-row')
    expect(within(performance).getAllByText('0.00 USDC').length).toBeGreaterThan(0)
    expect(within(performance).queryByText('2.0000 BTC')).toBeNull()
  })

  it('fails closed when the saved currency is missing', () => {
    const stale = structuredClone(overview)
    stale.reportingCurrency = 'EUR'
    stale.reportingCurrencySource = 'client'
    stale.summary.components = [summaryComponent('BTC', { equity: '1' })] as typeof stale.summary.components

    render(<HubDashboard overview={stale} {...dashboardActions} />)
    expect(screen.getByText(/saved account currency is not present/i)).toBeInTheDocument()
    expect(screen.queryByTestId('hub-kpi-row')).toBeNull()
    expect(screen.queryByTestId('hub-risk-row')).toBeNull()
  })

  it('asks for a choice instead of guessing when no funded currency exists', () => {
    const empty = structuredClone(overview)
    empty.reportingCurrency = null
    empty.reportingCurrencySource = null
    empty.summary.components = [
      summaryComponent('BNB', { equity: '0', balance: '-0', collateral: null }),
    ] as typeof empty.summary.components

    render(<HubDashboard overview={empty} {...dashboardActions} />)
    expect(screen.getByText(/No funded account currency was detected/i)).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'BNB' })).toBeInTheDocument()
    expect(screen.queryByTestId('hub-kpi-row')).toBeNull()
  })

  it('resolves each field from the best same-currency component and keeps current values when history fails', () => {
    const split = structuredClone(overview)
    split.summary.components = [
      summaryComponent('USDC', { componentScope: 'asset_balance', balance: '777.25' }),
      summaryComponent('USDC', { componentScope: 'account', equity: '888.50' }),
    ] as typeof split.summary.components

    render(<HubDashboard overview={split} historyError="history offline" {...dashboardActions} />)
    const performance = screen.getByTestId('hub-kpi-row')
    expect(within(performance).getByText('888.50 USDC')).toBeInTheDocument()
    expect(within(performance).getByText('777.25 USDC')).toBeInTheDocument()
    expect(screen.getByText(/Historical trends could not be loaded/i)).toBeInTheDocument()
  })

  it('matches lowercase Hub summary currency to the canonical configured currency without conversion or summation', () => {
    const lowerCase = structuredClone(overview)
    lowerCase.reportingCurrency = ' usdc '
    lowerCase.summary.components = [{ ...lowerCase.summary.components[0], currency: 'usdc', componentScope: 'account', equity: '123.45' as any }]
    render(<HubDashboard overview={lowerCase} {...dashboardActions} />)
    expect(screen.getAllByText('123.45 USDC').length).toBeGreaterThan(0)
  })

  it('uses an explicit account-total scope priority and warns when fully loaded rows disagree with snapshot count', () => {
    const margin = structuredClone(overview)
    margin.summary.components = [
      { ...margin.summary.components[0], componentScope: 'asset_balance', equity: '999.00' as any },
      { ...margin.summary.components[0], componentScope: 'margin_account', equity: '1250.00' as any },
    ]
    render(<HubDashboard overview={margin} {...dashboardActions} />)
    expect(screen.getAllByText('1,250.00 USDC').length).toBeGreaterThan(0)
  })

  it('hides zero-quantity coins from the account summary', () => {
    const balances = structuredClone(overview)
    balances.summary.components = [
      { ...balances.summary.components[0], currency: 'USDC', balance: '1250' as any },
      { ...balances.summary.components[0], currency: 'BTC', componentScope: 'asset_balance', balance: '0.00000000' as any },
      { ...balances.summary.components[0], currency: 'ETH', componentScope: 'asset_balance', balance: '-0' as any },
    ]
    render(<HubDashboard overview={balances} {...dashboardActions} />)

    const accountSummary = screen.getByRole('heading', { name: /account summary/i }).closest('section')
    expect(accountSummary).not.toBeNull()
    expect(within(accountSummary!).getByText('USDC')).toBeInTheDocument()
    expect(within(accountSummary!).queryByText('BTC')).toBeNull()
    expect(within(accountSummary!).queryByText('ETH')).toBeNull()
  })

  it('does not apply full-position count reconciliation to the five-row dashboard preview', () => {
    const preview = structuredClone(overview)
    preview.alignment = { ...preview.alignment, mixedAge: false, runAligned: true }
    preview.positions.items = Array.from({ length: 6 }, (_, index) => ({ ...preview.positions.items[0], id: `00000000-0000-4000-8000-00000000000${index}` }))
    preview.positions.snapshot.positionCount = 6
    preview.positions.nextCursor = null
    render(<HubDashboard overview={preview} {...dashboardActions} />)
    expect(screen.queryByText(/Loaded 5 unique rows, but this complete snapshot reports 6/i)).toBeNull()
  })

  it('renders the newest ledger page and continues through the cursor on request', async () => {
    const loadMore = vi.fn()
    vi.mocked(usePortfolioHubLedger).mockReturnValue({
      events: parseHubLedgerEventPage(ledgerFixture).items,
      nextCursor: 'next-page', loading: false, loadingMore: false, error: null, loadMore,
    })
    render(<HubLedgerHistory />)
    expect(screen.getAllByText('Deposit')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: /load more/i }))
    expect(loadMore).toHaveBeenCalledOnce()
  })

  it('keeps ready equity visible when performance is unavailable, and never fills unavailable values from the summary', () => {
    const data = parseHubPerformance(unavailablePerformanceFixture)
    data.quality.equityStatus = 'ready'
    data.equity = '125.5' as typeof data.equity
    render(<HubPerformancePanel state={performanceState(data)} onRefresh={() => {}} />)

    expect(screen.getByRole('heading', { name: 'Equity' }).closest('section')).toHaveTextContent('125.50 USDC')
    expect(screen.getByText('Performance unavailable. No value has been substituted.')).toBeInTheDocument()
    expect(screen.queryByText('Opening equity')).toBeNull()
  })

  it('renders an unavailable Hub response as a valid state with its reviewed reason, not as fabricated data', () => {
    render(<HubPerformancePanel state={performanceState(parseHubPerformance(unavailablePerformanceFixture))} onRefresh={() => {}} />)

    expect(screen.getAllByText('Unavailable')).toHaveLength(2)
    expect(screen.getByText('Performance calculation is not configured for this account.')).toBeInTheDocument()
    expect(screen.queryByText('P&L')).toBeNull()
  })

  it('renders loading and transport-unavailable states without inventing performance values', () => {
    const { rerender } = render(<HubPerformancePanel state={performanceState(undefined, {
      status: 'loading', data: null, refreshing: true, canRefresh: false,
    })} onRefresh={() => {}} />)
    expect(screen.getByText('Loading performance data…')).toBeInTheDocument()

    rerender(<HubPerformancePanel state={performanceState(undefined, {
      status: 'unavailable', data: null, refreshing: false, refreshError: 'offline', canRefresh: true,
    })} onRefresh={() => {}} />)
    expect(screen.getByText(/Performance unavailable\. No values have been substituted/i)).toBeInTheDocument()
    expect(screen.queryByText('Opening equity')).toBeNull()
  })

  it('keeps performance visible when equity is unavailable without substituting summary equity', () => {
    const data = parseHubPerformance(readyPerformanceFixture)
    data.quality.equityStatus = 'unavailable'
    data.equity = null
    render(<HubPerformancePanel state={performanceState(data)} onRefresh={() => {}} />)

    expect(screen.getByText('Equity unavailable. No value has been substituted.')).toBeInTheDocument()
    expect(screen.getByText('Opening equity')).toBeInTheDocument()
    expect(screen.getByText('9,000.00 USD')).toBeInTheDocument()
  })

  it('does not render summary equity beside an authoritative unavailable equity state', () => {
    const data = parseHubPerformance(readyPerformanceFixture)
    data.quality.equityStatus = 'unavailable'
    data.equity = null
    render(
      <HubDashboard
        overview={overview}
        {...dashboardActions}
        performanceState={performanceState(data)}
      />,
    )

    expect(screen.getByText('Equity unavailable. No value has been substituted.')).toBeInTheDocument()
    expect(within(screen.getByTestId('hub-kpi-row')).queryByText('Equity')).toBeNull()
    expect(within(screen.getByTestId('hub-kpi-row')).queryByText('1,250.13 USDC')).toBeNull()
  })

  it('keeps independent summary equity visible when no performance response is available', () => {
    render(
      <HubDashboard
        overview={overview}
        {...dashboardActions}
        performanceState={performanceState(undefined, {
          status: 'unavailable', data: null, refreshError: 'offline', canRefresh: true,
        })}
      />,
    )

    expect(within(screen.getByTestId('hub-kpi-row')).getByText('Equity')).toBeInTheDocument()
    expect(within(screen.getByTestId('hub-kpi-row')).getByText('1,250.13 USDC')).toBeInTheDocument()
  })

  it('renders ready and provisional values with reviewed reasons, unresolved movements, and provenance', () => {
    const data = parseHubPerformance(provisionalPerformanceFixture)
    data.quality.unresolvedMovementCount = 2
    render(<HubPerformancePanel state={performanceState(data)} onRefresh={() => {}} />)

    expect(screen.getAllByText('Provisional').length).toBeGreaterThan(0)
    expect(screen.getByText(/snapshot time is approximate/i)).toBeInTheDocument()
    expect(screen.getByText('2 unresolved movements')).toBeInTheDocument()
    expect(screen.getByText('Policy revision 3')).toBeInTheDocument()
    expect(screen.getByText('Calculation performance-v1')).toBeInTheDocument()
  })

  it('renders every availability state independently with stale/unknown freshness and recalculation pending', () => {
    const statuses = ['ready', 'provisional', 'unavailable'] as const
    for (const equityStatus of statuses) {
      for (const performanceStatus of statuses) {
        const data = parseHubPerformance(readyPerformanceFixture)
        data.quality.equityStatus = equityStatus
        data.quality.performanceStatus = performanceStatus
        data.quality.freshness = equityStatus === 'ready' ? 'stale' : 'unknown'
        data.quality.recalculationPending = true
        if (equityStatus === 'unavailable') data.equity = null
        if (performanceStatus === 'unavailable') {
          data.openingEquity = null
          data.performance = null
        }
        const { unmount } = render(<HubPerformancePanel state={performanceState(data)} onRefresh={() => {}} />)
        expect(screen.getByText('Recalculation pending')).toBeInTheDocument()
        expect(screen.getByText(equityStatus === 'ready' ? 'Data may be stale' : 'Freshness unavailable')).toBeInTheDocument()
        expect(screen.getAllByText(equityStatus === 'ready' ? 'Ready' : equityStatus === 'provisional' ? 'Provisional' : 'Unavailable').length).toBeGreaterThan(0)
        expect(screen.getAllByText(performanceStatus === 'ready' ? 'Ready' : performanceStatus === 'provisional' ? 'Provisional' : 'Unavailable').length).toBeGreaterThan(0)
        unmount()
      }
    }
  })

  it('preserves null, exact zero, and the top-level opening equity display source', () => {
    const data = parseHubPerformance(readyPerformanceFixture)
    data.equity = null
    data.openingEquity = '0' as typeof data.openingEquity
    const totals = data.performance
    if (totals === null) throw new Error('ready fixture must include totals')
    totals.openingEquity = '999' as typeof totals.openingEquity
    totals.pnl = '-0' as typeof totals.pnl
    render(<HubPerformancePanel state={performanceState(data)} onRefresh={() => {}} />)

    expect(screen.getByRole('heading', { name: 'Equity' }).closest('section')).toHaveTextContent('—')
    expect(screen.getAllByText('0.00 USD')).toHaveLength(2)
    expect(screen.queryByText('999.00 USD')).toBeNull()
  })

  it('uses generic safe copy for unknown reasons and never exposes opaque details', () => {
    const data = parseHubPerformance(readyPerformanceFixture)
    data.quality.reasonCodes = ['future_internal_reason']
    ;(data.quality as typeof data.quality & { details?: unknown }).details = { secret: 'do-not-render' }
    render(<HubPerformancePanel state={performanceState(data)} onRefresh={() => {}} />)

    expect(screen.getByText('Additional performance data qualification is available.')).toBeInTheDocument()
    expect(screen.queryByText(/future_internal_reason|do-not-render/i)).toBeNull()
  })

  it('retains valid data after a refresh failure and disables rate-limited refresh until retry time', () => {
    const onRefresh = vi.fn()
    const data = parseHubPerformance(readyPerformanceFixture)
    const retryAt = Date.now() + 60_000
    render(<HubPerformancePanel state={performanceState(data, {
      refreshError: 'network failure', errorCode: 'HUB_RATE_LIMITED', retryAt, canRefresh: false,
    })} onRefresh={onRefresh} />)

    expect(screen.getByRole('alert')).toHaveTextContent(/last valid performance result is shown/i)
    expect(screen.getByText('10,000.00 USD')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /refresh performance/i })).toBeDisabled()
    expect(screen.getByText(/refresh available/i)).toBeInTheDocument()
  })
})
