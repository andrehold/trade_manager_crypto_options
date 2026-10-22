import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseHubAnalyticsSummary, parseHubAnalyticsTransactionPage } from '@/lib/portfolioDataHub'
import type { AnalyticsPair, AnalyticsTransactionFilters } from '@/lib/portfolioDataHub/analyticsClient'
import type { usePortfolioHubAnalytics } from '../../../usePortfolioHubAnalytics'
import { TradingAnalyticsView } from '../TradingAnalyticsSection'
import { AnalyticsTransactionTable } from '../AnalyticsTransactionTable'
import { PortfolioHubClientError } from '@/lib/portfolioDataHub/client'

vi.mock('@/lib/supabase', () => ({
  hasSupabaseClient: () => true,
  getSupabaseClient: () => ({ auth: {
    getSession: async () => ({ data: { session: { access_token: 'test-token', user: { id: 'user-1', app_metadata: { client_id: 'client-1' } } } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
  } }),
}))
vi.mock('@/lib/portfolioDataHub/analyticsClient', async (original) => ({
  ...await original<typeof import('@/lib/portfolioDataHub/analyticsClient')>(), fetchPortfolioHubAnalyticsTransactions: vi.fn(),
}))
import { fetchPortfolioHubAnalyticsTransactions } from '@/lib/portfolioDataHub/analyticsClient'

const root = resolve(process.cwd(), 'docs/integrations/2026-10-21-transaction-analytics/synthetic')
const raw = (name: string) => JSON.parse(readFileSync(resolve(root, `${name}.json`), 'utf8'))
function pair() {
  const totals = parseHubAnalyticsSummary(raw('partial'))
  const daily = { ...structuredClone(totals), groupBy: ['day'] as const, groups: structuredClone(totals.groups) }
  daily.groups[0].dimensions.day = '2026-10-05'
  return { accountId: totals.accountId, totals, daily: { ...daily, groupBy: ['day'] }, window: { start: totals.coverage.requestedStart!, end: totals.coverage.requestedEnd! }, filters: {}, consistencyLimitations: [] } satisfies AnalyticsPair
}
function page(n: number, filters: AnalyticsTransactionFilters) {
  const p = parseHubAnalyticsTransactionPage(raw(`partial-transactions-page-${n}`))
  p.coverage.requestedStart = filters.start
  p.coverage.requestedEnd = filters.end
  return p
}
function analytics(data: AnalyticsPair | null = pair()): ReturnType<typeof usePortfolioHubAnalytics> {
  return { state: { status: 'ready', data, refreshing: false, error: null, refreshError: null, errorCode: null, retryAt: null, canRetry: true, requestKey: 'fixture' }, period: { kind: 'month-to-date' }, window: data?.window ?? null, filters: {}, setPeriod: vi.fn(), setFilters: vi.fn(), refresh: vi.fn(), retry: vi.fn() }
}
const fetchRows = vi.mocked(fetchPortfolioHubAnalyticsTransactions)
const openProfit = async () => {
  await userEvent.click(within(screen.getByRole('region', { name: 'Realized trading profit' })).getByRole('button'))
  return screen.getByRole('dialog', { name: 'Contributing transactions' })
}
beforeEach(() => { fetchRows.mockReset().mockImplementation(async (_token, filters) => page(filters.cursor ? 2 : 1, filters)) })

describe('contributing transaction drawer', () => {
  it('does not download transactions until a metric opens, then paginates to an explicit end with unavailable reasons', async () => {
    render(<TradingAnalyticsView analytics={analytics()} />)
    expect(fetchRows).not.toHaveBeenCalled()
    const dialog = await openProfit()
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Load more transactions' })).toBeInTheDocument())
    expect(within(dialog).getByRole('region', { name: 'Trading result details' })).toHaveTextContent('Before fees and funding')
    expect(within(dialog).getByRole('table')).toHaveTextContent('-66.0000000000000000')
    expect(within(dialog).getByRole('table')).toHaveTextContent('BTC_face_value')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Load more transactions' }))
    await waitFor(() => expect(within(dialog).getByText(/End of results/)).toBeInTheDocument())
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(within(dialog).getByRole('table')).toHaveTextContent('Unavailable')
    expect(within(dialog).getByRole('table')).toHaveTextContent('Cost basis for the unwind or transfer is unresolved.')
    expect(within(dialog).getByRole('table')).toHaveTextContent('unwind_transfer_basis_unresolved')
    expect(within(dialog).getAllByText('SYNTHETIC-BTC-OPTION')).toHaveLength(2)
    expect(within(dialog).queryByRole('button', { name: 'Load more transactions' })).toBeNull()
  })
  it('uses the original day intersection and metric without advancing the relative period', async () => {
    const hook = analytics()
    render(<TradingAnalyticsView analytics={hook} />)
    await userEvent.click(screen.getByRole('button', { name: /^Day details:/ }))
    await waitFor(() => expect(fetchRows).toHaveBeenCalledOnce())
    expect(fetchRows.mock.calls[0][1]).toMatchObject({ start: '2026-10-05T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z', metric: 'calculated_realized_gross_profit' })
    expect(hook.refresh).not.toHaveBeenCalled()
    expect(hook.retry).not.toHaveBeenCalled()
  })
  it('traps keyboard focus, hides the background, closes on Escape and restores the trigger', async () => {
    const view = render(<TradingAnalyticsView analytics={analytics()} />)
    const trigger = within(screen.getByRole('region', { name: 'Realized trading profit' })).getByRole('button')
    const dialog = await openProfit()
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Load more transactions' })).toBeInTheDocument())
    expect(within(dialog).getByRole('region', { name: 'Trading result details' })).toHaveFocus()
    expect(view.container.inert).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')
    const close = within(dialog).getByRole('button', { name: 'Close result details' })
    close.focus()
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    expect(within(dialog).getByRole('button', { name: 'Load more transactions' })).toHaveFocus()
    await userEvent.keyboard('{Tab}')
    expect(close).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger).toHaveFocus()
    expect(view.container.inert).toBeFalsy()
    expect(document.body.style.overflow).toBe('')
  })
  it('does not offer a broadened request for unsupported unknown denomination', async () => {
    const data = pair()
    data.totals.groups[0].dimensions.denomination = null
    render(<TradingAnalyticsView analytics={analytics(data)} />)
    const dialog = await openProfit()
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/cannot be scoped to an unknown denomination/)
    expect(fetchRows).not.toHaveBeenCalled()
  })
  it('renders exact accounting fields, absent traces and source comparisons without app-side arithmetic', async () => {
    const row = page(1, pair().window).items[0]
    const tracePage = raw('partial-transactions-page-1')
    Object.assign(tracePage.items[0].accounting, { method: 'moving_weighted_average', cost_basis_before: '999.123456789012345678', cost_basis_after: null, quantity_before: '0.5', quantity_after: '0', opened_quantity: '0', closed_quantity: '0.5', average_price_before: '78', source_reported_profit: '123', comparison_difference: '-189', reconciliation: { source: null }, notes: ['future_provider_note'], reason_codes: ['future_provider_reason'], order_key: ['event-time', 'stable-id'] })
    row.accounting = parseHubAnalyticsTransactionPage(tracePage).items[0].accounting
    render(<AnalyticsTransactionTable rows={[row, { ...row, id: 'another-id', accounting: null }]} metric="calculated_realized_gross_profit" />)
    const explanations = screen.getAllByRole('button', { name: /^Accounting explanation/ })
    await userEvent.click(explanations[0])
    expect(screen.getByText('999.123456789012345678')).toBeVisible()
    expect(screen.getByText('Cost basis after').nextSibling).toHaveTextContent('Unavailable')
    expect(screen.getByText('Future provider reason')).toBeVisible()
    expect(screen.getByText('(future_provider_reason)')).toBeVisible()
    expect(screen.getByText('Source-reported profit (comparison)')).toBeVisible()
    expect(screen.getByText('Accounting order: event-time · stable-id')).toBeVisible()
    await userEvent.click(explanations[1])
    expect(screen.getByText('No accounting trace was supplied for this transaction.')).toBeVisible()
  })
  it('makes empty history and incomplete build evidence explicit', async () => {
    fetchRows.mockImplementation(async (_token, filters) => { const p = page(1, filters); p.items = []; p.nextCursor = null; p.coverage.derivedAt = null; p.coverage.normalizationVersion = null; return p })
    render(<TradingAnalyticsView analytics={analytics()} />)
    const dialog = await openProfit()
    await waitFor(() => expect(within(dialog).getByText(/No matching eligible transactions/)).toBeInTheDocument())
    expect(within(dialog).getByText(/Matching summary and transaction builds cannot be verified/)).toBeInTheDocument()
    expect(within(dialog).getByText('History completeness not verified')).toBeInTheDocument()
  })
  it('coordinates a build restart with summary retry, retains the original snapshot label and never mixes rows', async () => {
    const data = pair(), first = analytics(data)
    const { rerender } = render(<TradingAnalyticsView analytics={first} />)
    const dialog = await openProfit()
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Load more transactions' })).toBeInTheDocument())
    fetchRows.mockRejectedValueOnce(new PortfolioHubClientError('ANALYTICS_INVALID_CURSOR', 'Expired cursor', 400))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Load more transactions' }))
    await waitFor(() => expect(first.retry).toHaveBeenCalledOnce())
    expect(within(dialog).queryByRole('table')).toBeNull()
    expect(within(dialog).getByText(/Discarded the in-progress pages/)).toBeInTheDocument()
    const limited = analytics(data)
    limited.state.canRetry = false
    limited.state.retryAt = Date.now() + 60_000
    limited.state.refreshError = 'Summary refresh is rate limited.'
    rerender(<TradingAnalyticsView analytics={limited} />)
    expect(within(dialog).getByRole('button', { name: 'Retry summary refresh' })).toBeDisabled()
    expect(within(dialog).getByText(/Summary retry available after/)).toBeInTheDocument()
    const next = structuredClone(data)
    next.totals.coverage.normalizationVersion = 'new-build'
    fetchRows.mockImplementation(async (_token, filters) => { const p = page(1, filters); p.coverage.normalizationVersion = 'new-build'; return p })
    rerender(<TradingAnalyticsView analytics={analytics(next)} />)
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Load more transactions' })).toBeInTheDocument())
    expect(within(dialog).getByText(/do not reconcile to that old cell/)).toBeInTheDocument()
    expect(within(dialog).getAllByText('SYNTHETIC-BTC-OPTION')).toHaveLength(1)
    expect(fetchRows.mock.calls[2][1].cursor).toBeNull()
  })
  it('closes on account/period loss and does not resurrect an old selection when data returns', async () => {
    const data = pair()
    const { rerender } = render(<TradingAnalyticsView analytics={analytics(data)} />)
    await openProfit()
    rerender(<TradingAnalyticsView analytics={analytics(null)} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(<TradingAnalyticsView analytics={analytics(data)} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
