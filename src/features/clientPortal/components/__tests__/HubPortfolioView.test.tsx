import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import summaryFixture from '@/lib/portfolioDataHub/__fixtures__/paradex/summary-latest.json'
import positionsFixture from '@/lib/portfolioDataHub/__fixtures__/paradex/positions-latest.json'
import ledgerFixture from '@/lib/portfolioDataHub/__fixtures__/paradex/ledger-events.json'
import { parseHubLatestPositionPage, parseHubLedgerEventPage, parseHubSummary } from '@/lib/portfolioDataHub'

vi.mock('../../usePortfolioDataHub', () => ({ usePortfolioHubLedger: vi.fn(), usePortfolioHubPositions: vi.fn() }))

import { HubDashboard, HubLedgerHistory, HubPositionsPage } from '../HubPortfolioView'
import { usePortfolioHubLedger, usePortfolioHubPositions } from '../../usePortfolioDataHub'

const mixedPositions = structuredClone(positionsFixture)
mixedPositions.snapshot.run_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const overview = {
  summary: parseHubSummary(summaryFixture),
  positions: { ...parseHubLatestPositionPage(mixedPositions), pageToken: 'signed-page-token' },
  reportingCurrency: 'USDC',
  alignment: {
    runAligned: false,
    mixedAge: true,
    summaryRunId: summaryFixture.run_id,
    positionsRunId: mixedPositions.snapshot.run_id,
    summaryFetchedAt: summaryFixture.fetched_at,
    positionsFetchedAt: mixedPositions.snapshot.fetched_at,
  },
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
    render(<HubDashboard overview={overview} onOpenPositions={() => {}} onOpenLedger={() => {}} onRefresh={onRefresh} />)
    expect(screen.getByTestId('hub-provenance')).toHaveTextContent('Summary as of')
    expect(screen.getByRole('status')).toHaveTextContent(/mixed-age data/i)
    expect(screen.getByText('BTC-USD-PERP')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^modify$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^close$/i })).toBeNull()
    expect(screen.getAllByText('1,250.13 USDC').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /refresh portfolio/i })).toBeInTheDocument()
  })

  it('renders native Hub positions as read-only data', () => {
    render(<HubPositionsPage overview={overview} onRefresh={() => {}} />)
    expect(screen.getByText(/native venue positions/i)).toBeInTheDocument()
    expect(screen.getByText('BTC-USD-PERP')).toBeInTheDocument()
    expect(screen.queryByText('Control')).toBeNull()
  })

  it('does not claim an authoritative zero when the position snapshot is partial', () => {
    const partial = structuredClone(overview)
    partial.positions.snapshot.quality = 'partial'
    partial.positions.snapshot.positionCount = 0
    partial.positions.items = []
    render(<HubDashboard overview={partial} onOpenPositions={() => {}} onOpenLedger={() => {}} onRefresh={() => {}} />)
    expect(screen.getAllByRole('status').some((node) => /partial position collection/i.test(node.textContent ?? ''))).toBe(true)
    expect(screen.getByText('Partial collection')).toBeInTheDocument()
    expect(screen.getByText(/not an authoritative zero-position result/i)).toBeInTheDocument()
  })

  it('does not select or combine a summary component when the reporting currency has no account-level match', () => {
    render(<HubDashboard overview={{ ...overview, reportingCurrency: 'EUR' }} onOpenPositions={() => {}} onOpenLedger={() => {}} onRefresh={() => {}} />)
    expect(screen.getByText(/No account-level summary component was reported in EUR/i)).toBeInTheDocument()
  })

  it('uses an explicit account-total scope priority and warns when fully loaded rows disagree with snapshot count', () => {
    const margin = structuredClone(overview)
    margin.summary.components = [
      { ...margin.summary.components[0], componentScope: 'asset_balance', equity: '999.00' as any },
      { ...margin.summary.components[0], componentScope: 'margin_account', equity: '1250.00' as any },
    ]
    render(<HubDashboard overview={margin} onOpenPositions={() => {}} onOpenLedger={() => {}} onRefresh={() => {}} />)
    expect(screen.getAllByText('1,250.00 USDC').length).toBeGreaterThan(0)
  })

  it('does not apply full-position count reconciliation to the five-row dashboard preview', () => {
    const preview = structuredClone(overview)
    preview.alignment = { ...preview.alignment, mixedAge: false, runAligned: true }
    preview.positions.items = Array.from({ length: 6 }, (_, index) => ({ ...preview.positions.items[0], id: `00000000-0000-4000-8000-00000000000${index}` }))
    preview.positions.snapshot.positionCount = 6
    preview.positions.nextCursor = null
    render(<HubDashboard overview={preview} onOpenPositions={() => {}} onOpenLedger={() => {}} onRefresh={() => {}} />)
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
})
