import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { parseHubAnalyticsSummary, type ExactDecimal } from '@/lib/portfolioDataHub'
import { captureAnalyticsPeriod, validateAnalyticsPair, type AnalyticsPair } from '@/lib/portfolioDataHub/analyticsClient'
import type { usePortfolioHubAnalytics } from '../../../usePortfolioHubAnalytics'
import { TradingAnalyticsView } from '../TradingAnalyticsSection'
import { AnalyticsPeriodControl } from '../AnalyticsPeriodControl'
import { AnalyticsCoverage } from '../AnalyticsCoverage'
import { RealizedProfitChart } from '../RealizedProfitChart'
import { plotCoordinate } from '../analyticsPresentation'

const root = resolve(process.cwd(), 'docs/integrations/2026-10-21-transaction-analytics/synthetic')
const raw = (name: string) => JSON.parse(readFileSync(resolve(root, `${name}.json`), 'utf8'))
function pair(name = 'costs-funding-activity', dailyName = 'daily-profit'): AnalyticsPair {
  const totals = parseHubAnalyticsSummary(raw(name))
  const daily = parseHubAnalyticsSummary(raw(dailyName))
  daily.coverage = { ...totals.coverage }
  daily.groupBy = ['day']
  if (totals.coverage.derivedStatus === 'pending') daily.groups = []
  const window = { start: totals.coverage.requestedStart!, end: totals.coverage.requestedEnd! }
  return validateAnalyticsPair(totals, daily, window, {})
}
function hook(data: AnalyticsPair | null = pair(), overrides: Partial<ReturnType<typeof usePortfolioHubAnalytics>['state']> = {}): ReturnType<typeof usePortfolioHubAnalytics> {
  return {
    state: { status: 'ready', data, refreshing: false, error: null, refreshError: null, errorCode: null, retryAt: null, canRetry: true, requestKey: 'fixture', ...overrides },
    period: { kind: 'month-to-date' }, window: data?.window ?? null, filters: {}, setPeriod: vi.fn(), setFilters: vi.fn(), refresh: vi.fn(), retry: vi.fn(),
  }
}
const renderView = (data = pair(), accountCurrency?: string | null) => render(<TradingAnalyticsView analytics={hook(data)} accountCurrency={accountCurrency} />)

describe('transaction-based trading results', () => {
  it('uses independent supplied gross profit, costs, verified funding and exact execution activity', () => {
    const data = pair()
    data.totals.groups[0].metrics.calculated_realized_gross_profit.value = '999.123456789012345678901' as ExactDecimal
    renderView(data)
    expect(screen.getByRole('heading', { name: 'Trading results' })).toBeInTheDocument()
    const profit = screen.getByRole('region', { name: 'Realized trading profit' })
    expect(within(profit).getByText('Before fees and funding')).toBeInTheDocument()
    expect(within(profit).getByRole('button')).toHaveTextContent('999.123456789012345678901 USDT')
    expect(screen.getByRole('region', { name: 'Trading costs' })).toHaveTextContent('1.00 USDT')
    expect(screen.getByRole('region', { name: 'Trading activity' })).toHaveTextContent('0.020000000000000001 BTC_face_value')
    expect(screen.getByRole('region', { name: 'Trading activity' })).toHaveTextContent('126.123456789012345678 USDT')
    expect(screen.getByRole('region', { name: 'Funding' })).toHaveTextContent('-0.125 USDT')
    expect(screen.getByText('Paid')).toBeInTheDocument()
    expect(screen.queryByText('0.125 USDT')).toBeNull()
    expect(screen.queryByText('Calculated net realized P&L')).toBeNull()
  })

  it('labels net rebates and received funding without recomputing financial measures', () => {
    renderView(pair('net-rebate-funding-received'))
    expect(screen.getByText('Net rebate')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Funding' })).toHaveTextContent('Received')
    expect(screen.getByRole('region', { name: 'Trading costs' })).toHaveTextContent('-1.00 USDT')
  })

  it('qualifies partial funding/cost directions and does not claim a certified zero total', () => {
    const data = pair()
    const metrics = data.totals.groups[0].metrics
    metrics.net_funding = { ...metrics.net_funding, value: '0' as ExactDecimal, eligibleCount: 2, missingCount: 1 }
    metrics.net_trading_cost = { ...metrics.net_trading_cost, value: '-1' as ExactDecimal, eligibleCount: 2, missingCount: 1 }
    renderView(data)
    expect(screen.getByRole('region', { name: 'Funding' })).toHaveTextContent('Zero available subtotal')
    expect(screen.getByRole('region', { name: 'Funding' })).not.toHaveTextContent('No net funding')
    expect(screen.getByRole('region', { name: 'Trading costs' })).toHaveTextContent('Net rebate · available subtotal')
  })

  it('prefers an existing account currency but keeps analytics available for a missing/unselected one', () => {
    const { rerender } = renderView(pair(), 'BTC')
    expect(screen.getByLabelText('Analytics currency')).toHaveValue('"USDT"')
    expect(screen.getByRole('region', { name: 'Realized trading profit' })).toBeInTheDocument()
    rerender(<TradingAnalyticsView analytics={hook(pair('multiple-partitions'))} accountCurrency="USD" />)
    expect(screen.getByLabelText('Analytics currency')).toHaveValue('"USD"')
    expect(screen.getAllByRole('region', { name: 'Realized trading profit' })).toHaveLength(3)
  })

  it('requires a choice for multiple currencies and never combines denomination or quantity-unit partitions', async () => {
    const analytics = hook(pair('multiple-partitions'))
    render(<TradingAnalyticsView analytics={analytics} accountCurrency="BTC" />)
    expect(screen.getByLabelText('Analytics currency')).toHaveValue('')
    expect(screen.queryByRole('region', { name: 'Realized trading profit' })).toBeNull()
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(expect.arrayContaining(['USD', 'USDC', 'USDT', 'Unknown currency']))
    await userEvent.selectOptions(screen.getByLabelText('Analytics currency'), '"USD"')
    expect(screen.getAllByRole('region', { name: /Analytics partition:/ })).toHaveLength(3)
    expect(screen.getByText('USD · Denomination: USDC · Quantity unit: BTC')).toBeInTheDocument()
    expect(screen.getByText('USD · Denomination: USD · Quantity unit: contracts')).toBeInTheDocument()
    expect(analytics.setFilters).not.toHaveBeenCalled()
    await userEvent.selectOptions(screen.getByLabelText('Analytics currency'), 'null')
    expect(screen.getByText('Unknown currency · Denomination: unknown · Quantity unit: Unknown quantity unit')).toBeInTheDocument()
  })

  it('keeps a local currency choice through a period refresh without persisting or filtering it', async () => {
    const data = pair('multiple-partitions')
    const first = hook(data)
    const { rerender } = render(<TradingAnalyticsView analytics={first} />)
    await userEvent.selectOptions(screen.getByLabelText('Analytics currency'), '"USDC"')
    rerender(<TradingAnalyticsView analytics={hook(structuredClone(data))} accountCurrency="USD" />)
    expect(screen.getByLabelText('Analytics currency')).toHaveValue('"USDC"')
    expect(first.setFilters).not.toHaveBeenCalled()
  })

  it('distinguishes partial, all-missing, ineligible, explicit zero and empty history', () => {
    const data = pair('partial')
    const { rerender } = renderView(data)
    expect(screen.getAllByText(/Partial subtotal · 1 of 2 eligible components missing/).length).toBeGreaterThan(0)
    rerender(<TradingAnalyticsView analytics={hook(pair('unavailable'))} />)
    expect(within(screen.getByRole('region', { name: 'Funding' })).getByRole('button')).toHaveTextContent('Unavailable')
    expect(screen.getByRole('region', { name: 'Trading costs' })).toHaveTextContent('1.25 USDT')
    rerender(<TradingAnalyticsView analytics={hook(pair('ineligible'))} />)
    expect(screen.getByRole('region', { name: 'Realized trading profit' })).toHaveTextContent('Not eligible')
    rerender(<TradingAnalyticsView analytics={hook(pair('explicit-zero'))} />)
    expect(within(screen.getByRole('region', { name: 'Realized trading profit' })).getByRole('button')).toHaveTextContent('0 USDT')
    const empty = pair('empty', 'empty'); empty.daily.groupBy = ['day']
    rerender(<TradingAnalyticsView analytics={hook(empty)} />)
    expect(screen.getByText(/No matching records in available history/)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Realized trading profit' })).toBeNull()
  })

  it('keeps pending, stale and neutral live processing distinct from economics and history', () => {
    const pending = pair('pending')
    const { rerender } = render(<TradingAnalyticsView analytics={hook(pending, { status: 'pending' })} />)
    expect(screen.getByText('Awaiting processing')).toBeInTheDocument()
    expect(screen.getByText('History completeness not verified')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Realized trading profit' })).toBeNull()
    rerender(<TradingAnalyticsView analytics={hook(pair('stale'))} />)
    expect(screen.getByText('Processing stale')).toBeInTheDocument()
    rerender(<TradingAnalyticsView analytics={hook(pair('live'))} />)
    expect(screen.getByText('Live processing')).toBeInTheDocument()
    expect(screen.getByText(/does not establish ready or current/)).toBeInTheDocument()
  })

  it('shows loading/failure states without fallback values and preserves qualified refresh results', async () => {
    const analytics = hook(null, { status: 'loading', refreshing: true })
    const { rerender } = render(<TradingAnalyticsView analytics={analytics} />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading trading results')
    expect(screen.queryByRole('region', { name: 'Funding' })).toBeNull()
    const failed = hook(null, { status: 'unavailable', error: 'Analytics failed', errorCode: 'ANALYTICS_PUBLICATION_CONFLICT' })
    rerender(<TradingAnalyticsView analytics={failed} />)
    await userEvent.click(screen.getByRole('button', { name: 'Retry trading results' }))
    expect(failed.retry).toHaveBeenCalledOnce()
    expect(screen.queryByRole('region', { name: 'Funding' })).toBeNull()
    rerender(<TradingAnalyticsView analytics={hook(pair(), { refreshError: 'Temporary outage' })} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Previous completed results shown. Refresh failed')
    expect(screen.getByRole('region', { name: 'Funding' })).toBeInTheDocument()
  })

  it('opens exact metric details with missing reasons and source funding only in comparison details', async () => {
    const data = pair('unavailable')
    renderView(data)
    const funding = screen.getByRole('region', { name: 'Funding' })
    await userEvent.click(within(funding).getByRole('button'))
    const details = screen.getByRole('region', { name: 'Trading result details' })
    expect(details).toHaveFocus()
    expect(details).toHaveTextContent('Component counts are not execution counts')
    expect(details).toHaveTextContent('Nonzero funding receipt/payment convention')
    await userEvent.click(screen.getByRole('button', { name: 'Close result details' }))
    expect(screen.queryByRole('region', { name: 'Trading result details' })).toBeNull()
    expect(within(funding).getByRole('button')).toHaveFocus()
  })

  it('drops selected result details when the completed pair changes', async () => {
    const data = pair()
    const { rerender } = renderView(data)
    await userEvent.click(within(screen.getByRole('region', { name: 'Funding' })).getByRole('button'))
    expect(screen.getByRole('region', { name: 'Trading result details' })).toBeInTheDocument()
    rerender(<TradingAnalyticsView analytics={hook(structuredClone(data))} />)
    expect(screen.queryByRole('region', { name: 'Trading result details' })).toBeNull()
  })
})

describe('daily exact values and keyboard access', () => {
  it('plots both signs on opposite sides of zero with exact tooltips and preserves the source group', () => {
    const data = pair()
    data.daily.groups[0].metrics.calculated_realized_gross_profit.value = '3.123456789012345678' as ExactDecimal
    const inspect = vi.fn()
    render(<RealizedProfitChart groups={data.daily.groups} window={data.window} onInspect={inspect} />)
    const positive = screen.getByRole('button', { name: /^Inspect 2026-10-05/ })
    const negative = screen.getByRole('button', { name: /^Inspect 2026-10-07/ })
    expect(Number(positive.querySelector('rect')!.getAttribute('y'))).toBeLessThan(92)
    expect(Number(negative.querySelector('rect')!.getAttribute('y'))).toBe(92)
    fireEvent.focus(positive)
    expect(screen.getByRole('tooltip')).toHaveTextContent('3.123456789012345678 USDT')
    fireEvent.keyDown(positive, { key: 'Enter' })
    expect(inspect).toHaveBeenCalledWith('calculated_realized_gross_profit', data.daily.groups[0])
  })

  it('keeps absent days absent, explicit zero selectable and partial notes in tooltips', async () => {
    const data = pair()
    const inspect = vi.fn()
    render(<RealizedProfitChart groups={data.daily.groups} window={data.window} onInspect={inspect} />)
    expect(screen.getByRole('table')).toHaveTextContent('2026-10-05')
    expect(screen.getByRole('table')).not.toHaveTextContent('2026-10-06')
    const zero = screen.getByRole('button', { name: /^Day details: 2026-10-05/ })
    zero.focus()
    await userEvent.keyboard('{Enter}')
    expect(inspect).toHaveBeenCalledWith('calculated_realized_gross_profit', data.daily.groups[0])
    const negativeBar = screen.getByRole('button', { name: /^Inspect 2026-10-07/ })
    fireEvent.focus(negativeBar)
    expect(screen.getByRole('tooltip')).toHaveTextContent('-66.0000000000000000 USDT · Partial subtotal')
    fireEvent.keyDown(negativeBar, { key: ' ' })
    expect(inspect).toHaveBeenLastCalledWith('calculated_realized_gross_profit', data.daily.groups[1])
  })

  it('shows exact overflow and underflow amounts in the table instead of a false numeric zero', () => {
    const data = pair()
    data.daily.groups[0].metrics.calculated_realized_gross_profit.value = '1e400' as ExactDecimal
    data.daily.groups[1].metrics.calculated_realized_gross_profit.value = '1e-400' as ExactDecimal
    render(<RealizedProfitChart groups={data.daily.groups} window={data.window} onInspect={() => {}} />)
    expect(screen.getByRole('table')).toHaveTextContent('1e400 USDT')
    expect(screen.getByRole('table')).toHaveTextContent('1e-400 USDT')
    expect(screen.getAllByText(/Outside plot range/)).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /^Inspect / })).toBeNull()
    expect(plotCoordinate('0' as ExactDecimal)).toBe(0)
  })
})

describe('trading controls and coverage', () => {
  it('applies valid inclusive custom dates once, validates reversed dates, and switches relative presets', async () => {
    const change = vi.fn()
    render(<AnalyticsPeriodControl period={{ kind: 'month-to-date' }} window={pair().window} onChange={change} />)
    await userEvent.selectOptions(screen.getByLabelText('Trading period · UTC'), 'custom')
    expect(change).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-21' } })
    fireEvent.change(screen.getByLabelText('Through'), { target: { value: '2026-10-20' } })
    await userEvent.click(screen.getByRole('button', { name: 'Apply dates' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(change).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Through'), { target: { value: '2026-10-21' } })
    await userEvent.click(screen.getByRole('button', { name: 'Apply dates' }))
    expect(captureAnalyticsPeriod(change.mock.calls[0][0]).end).toBe('2026-10-22T00:00:00.000Z')
    await userEvent.selectOptions(screen.getByLabelText('Trading period · UTC'), 'last-30-days')
    expect(change).toHaveBeenLastCalledWith({ kind: 'last-30-days' })
  })

  it('preserves processing time, collection time, history limits, unknown reasons and consistency limitations', () => {
    const coverage = pair().totals.coverage
    coverage.notes = ['unwind_transfer_basis_unresolved', 'new_provider_reason']
    render(<AnalyticsCoverage coverage={coverage} limitations={['Build identity is unavailable.']} />)
    expect(screen.getByText('History completeness not verified')).toBeInTheDocument()
    expect(screen.getByText(/Processed: 2026-10-21/)).toBeInTheDocument()
    expect(screen.getByText('Source collected: Unavailable')).toBeInTheDocument()
    expect(screen.getByText('Build identity is unavailable.')).toBeInTheDocument()
    expect(screen.getByText('Cost basis for the unwind or transfer is unresolved.')).toBeInTheDocument()
    expect(screen.getByText('(new_provider_reason)')).toBeInTheDocument()
    expect(screen.getByText('New provider reason')).toBeInTheDocument()
  })
})
