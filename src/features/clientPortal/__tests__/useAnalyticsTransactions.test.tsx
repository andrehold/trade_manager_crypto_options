import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { parseHubAnalyticsSummary, parseHubAnalyticsTransactionPage, type HubAnalyticsTransactionPage } from '@/lib/portfolioDataHub'
import type { AnalyticsPair, AnalyticsTransactionFilters } from '@/lib/portfolioDataHub/analyticsClient'
import type { AnalyticsResultSelection } from '../components/analytics/analyticsPresentation'
import { PortfolioHubClientError } from '@/lib/portfolioDataHub/client'

const getSession = vi.fn()
let authListener: (event: string, session: Session | null) => void
const unsubscribe = vi.fn()
vi.mock('@/lib/supabase', () => ({
  hasSupabaseClient: () => true,
  getSupabaseClient: () => ({ auth: { getSession, onAuthStateChange: (callback: typeof authListener) => {
    authListener = callback; return { data: { subscription: { unsubscribe } } }
  } } }),
}))
vi.mock('@/lib/portfolioDataHub/analyticsClient', async (original) => ({
  ...await original<typeof import('@/lib/portfolioDataHub/analyticsClient')>(), fetchPortfolioHubAnalyticsTransactions: vi.fn(),
}))
import { fetchPortfolioHubAnalyticsTransactions } from '@/lib/portfolioDataHub/analyticsClient'
import { useAnalyticsTransactions } from '../useAnalyticsTransactions'

const root = resolve(process.cwd(), 'docs/integrations/2026-10-21-transaction-analytics/synthetic')
const raw = (name: string) => JSON.parse(readFileSync(resolve(root, `${name}.json`), 'utf8'))
function context() {
  const totals = parseHubAnalyticsSummary(raw('partial'))
  const window = { start: totals.coverage.requestedStart!, end: totals.coverage.requestedEnd! }
  const pair: AnalyticsPair = { accountId: totals.accountId, totals, daily: { ...totals, groupBy: ['day'] }, window, filters: {}, consistencyLimitations: [] }
  const selection: AnalyticsResultSelection = { group: totals.groups[0], metric: 'calculated_realized_gross_profit', window, filters: {} }
  return { selection, pair }
}
function page(n = 1, filters?: AnalyticsTransactionFilters) {
  const p = parseHubAnalyticsTransactionPage(raw(`partial-transactions-page-${n}`))
  if (filters) { p.coverage.requestedStart = filters.start; p.coverage.requestedEnd = filters.end }
  return p
}
function session(user = 'user-1', client = 'client-1'): Session {
  return { access_token: 'test-token', refresh_token: 'test-refresh', expires_in: 3600, token_type: 'bearer', user: { id: user, app_metadata: { client_id: client }, user_metadata: {}, aud: 'authenticated', created_at: '2026-10-01T00:00:00Z' } }
}
const sessionResult = (s: Session | null = session()) => ({ data: { session: s }, error: null })
const fetchRows = vi.mocked(fetchPortfolioHubAnalyticsTransactions)
function deferred<T>() { let resolve!: (v: T) => void; let reject!: (v: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const ready = async (result: { current: ReturnType<typeof useAnalyticsTransactions> }) => waitFor(() => expect(result.current.status).toBe('ready'))
function mount() {
  const c = context(), refresh = vi.fn()
  return { ...c, refresh, ...renderHook(({ pair }) => useAnalyticsTransactions(c.selection, pair, refresh), { initialProps: { pair: c.pair } }) }
}
beforeEach(() => {
  getSession.mockReset().mockResolvedValue(sessionResult())
  unsubscribe.mockClear()
  fetchRows.mockReset().mockImplementation(async (_token, filters) => page(filters.cursor ? 2 : 1, filters))
})

describe('transaction pagination isolation and recovery', () => {
  it('requests only page one on mount, loads all pages with unchanged scope and retains null-valued contributors', async () => {
    const { result, unmount } = mount()
    await ready(result)
    expect(fetchRows).toHaveBeenCalledTimes(1)
    expect(fetchRows.mock.calls[0][1]).toMatchObject({ limit: 50, metric: 'calculated_realized_gross_profit', currency: 'USDT', denomination: 'USDT', quantityUnit: 'BTC_face_value', cursor: null })
    act(() => { result.current.loadMore(); result.current.loadMore() })
    await waitFor(() => expect(result.current.sequence?.rows).toHaveLength(2))
    expect(fetchRows.mock.calls[1][1]).toEqual({ ...fetchRows.mock.calls[0][1], cursor: 'synthetic-opaque-next-page' })
    expect(result.current.sequence?.rows[1].metrics.calculated_realized_gross_profit).toBeNull()
    expect(result.current.sequence?.page.nextCursor).toBeNull()
    act(() => result.current.loadMore())
    expect(fetchRows).toHaveBeenCalledTimes(2)
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })
  it.each(['ANALYTICS_INVALID_CURSOR', 'ANALYTICS_PUBLICATION_CONFLICT'] as const)('discards partial pages on %s, refreshes the same summary, then restarts once', async (code) => {
    const { result, refresh, pair, rerender } = mount()
    await ready(result)
    fetchRows.mockRejectedValueOnce(new PortfolioHubClientError(code, 'Build changed', code === 'ANALYTICS_INVALID_CURSOR' ? 400 : 409))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.status).toBe('awaiting-summary'))
    expect(result.current.sequence).toBeNull()
    expect(refresh).toHaveBeenCalledOnce()
    expect(fetchRows).toHaveBeenCalledTimes(2)
    rerender({ pair: structuredClone(pair) })
    await ready(result)
    expect(fetchRows.mock.calls[2][1].cursor).toBeNull()
    expect(result.current.sequence?.rows).toHaveLength(1)
    fetchRows.mockRejectedValueOnce(new PortfolioHubClientError(code, 'Build changed', 409))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.sequence).toBeNull()
    expect(result.current.error).toMatch(/changed again/)
    expect(refresh).toHaveBeenCalledOnce()
  })
  it('does not blindly retry generic validation 400 errors', async () => {
    fetchRows.mockRejectedValue(new PortfolioHubClientError('ANALYTICS_INVALID_QUERY', 'Invalid filters', 400))
    const { result, refresh } = mount()
    await waitFor(() => expect(result.current.error).toBe('Invalid filters'))
    expect(fetchRows).toHaveBeenCalledOnce()
    expect(refresh).not.toHaveBeenCalled()
  })
  it('detects changed build evidence before appending and waits for coordinated summary refresh', async () => {
    const { result, pair, rerender, refresh } = mount()
    await ready(result)
    const changed = page(2)
    changed.coverage.normalizationVersion = 'new-build'
    fetchRows.mockResolvedValueOnce(changed)
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.status).toBe('awaiting-summary'))
    expect(result.current.sequence).toBeNull()
    expect(refresh).toHaveBeenCalledOnce()
    const next = structuredClone(pair)
    next.totals.coverage.normalizationVersion = 'new-build'
    fetchRows.mockImplementation(async (_token, filters) => { const p = page(filters.cursor ? 2 : 1, filters); p.coverage.normalizationVersion = 'new-build'; return p })
    rerender({ pair: next })
    await ready(result)
    expect(result.current.sequence?.rows).toHaveLength(1)
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.sequence?.rows).toHaveLength(2))
  })
  it('detects a page-one build newer than its summary and does not claim reconciliation to the old cell', async () => {
    fetchRows.mockImplementation(async (_token, filters) => { const p = page(1, filters); p.coverage.derivedAt = '2026-10-22T00:00:00Z'; return p })
    const { result, pair, rerender, refresh } = mount()
    await waitFor(() => expect(result.current.status).toBe('awaiting-summary'))
    expect(result.current.sequence).toBeNull()
    expect(refresh).toHaveBeenCalledOnce()
    const next = structuredClone(pair)
    next.totals.coverage.derivedAt = '2026-10-22T00:00:00Z'
    rerender({ pair: next })
    await ready(result)
    expect(fetchRows).toHaveBeenCalledTimes(2)
  })
  it('restarts when an explicit summary refresh changes the build while a page is in flight', async () => {
    const { result, pair, rerender } = mount()
    await ready(result)
    const late = deferred<HubAnalyticsTransactionPage>()
    fetchRows.mockReturnValueOnce(late.promise)
    act(() => result.current.loadMore())
    await waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(2))
    const next = structuredClone(pair)
    next.totals.coverage.normalizationVersion = 'new-build'
    fetchRows.mockImplementation(async (_token, filters) => { const p = page(1, filters); p.coverage.normalizationVersion = 'new-build'; return p })
    rerender({ pair: next })
    await ready(result)
    await act(async () => late.resolve(page(2)))
    expect(result.current.sequence?.rows).toHaveLength(1)
    expect(result.current.sequence?.page.coverage.normalizationVersion).toBe('new-build')
    expect(fetchRows.mock.calls[1][3]?.aborted).toBe(true)
  })
  it('retains only a previously completed full sequence during a same-context restart', async () => {
    const { result, pair, rerender } = mount()
    await ready(result)
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.sequence?.rows).toHaveLength(2))
    fetchRows.mockRejectedValueOnce(new PortfolioHubClientError('ANALYTICS_PUBLICATION_CONFLICT', 'Build changed', 409))
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.status).toBe('awaiting-summary'))
    expect(result.current.previous).toBe(true)
    expect(result.current.sequence?.rows).toHaveLength(2)
    const pending = deferred<HubAnalyticsTransactionPage>()
    fetchRows.mockReturnValueOnce(pending.promise)
    rerender({ pair: structuredClone(pair) })
    await waitFor(() => expect(result.current.status).toBe('restarting'))
    expect(result.current.previous).toBe(true)
    await act(async () => pending.resolve(page(1)))
    await ready(result)
    expect(result.current.previous).toBe(false)
    expect(result.current.sequence?.rows).toHaveLength(1)
  })
  it.each(['duplicate', 'cursor-cycle', 'account', 'row-account', 'venue', 'row-venue', 'window', 'partition', 'ineligible', 'out-of-period', 'lost-build'] as const)('rejects %s responses without exposing mixed rows', async (kind) => {
    const { result } = mount()
    await ready(result)
    const wrong = page(2)
    if (kind === 'duplicate') wrong.items[0].id = page(1).items[0].id
    if (kind === 'cursor-cycle') wrong.nextCursor = 'synthetic-opaque-next-page'
    if (kind === 'account') wrong.accountId = 'other-account'
    if (kind === 'row-account') wrong.items[0].accountId = 'other-account'
    if (kind === 'venue') wrong.venue = 'other-venue'
    if (kind === 'row-venue') wrong.items[0].venue = 'other-venue'
    if (kind === 'window') wrong.coverage.requestedEnd = '2026-10-22T00:00:00Z'
    if (kind === 'partition') wrong.items[0].quantityUnit = 'contracts'
    if (kind === 'ineligible') delete wrong.items[0].metrics.calculated_realized_gross_profit
    if (kind === 'out-of-period') wrong.items[0].eventTime = context().selection.window.end
    if (kind === 'lost-build') wrong.coverage.normalizationVersion = null
    fetchRows.mockResolvedValueOnce(wrong)
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.status).toBe(kind === 'lost-build' ? 'awaiting-summary' : 'error'))
    expect(result.current.sequence).toBeNull()
  })
  it('does not retain old account rows after a mapping error', async () => {
    const { result } = mount()
    await ready(result)
    fetchRows.mockRejectedValueOnce(new PortfolioHubClientError('HUB_UNAVAILABLE', 'Unavailable', 503, null, 'different-account'))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.blocked).toBe(true))
    expect(result.current.sequence).toBeNull()
  })
  it.each(['logout', 'user-switch', 'client-switch'] as const)('clears data and ignores a late request after %s', async (kind) => {
    const { result } = mount()
    await ready(result)
    const pending = deferred<HubAnalyticsTransactionPage>()
    fetchRows.mockReturnValueOnce(pending.promise)
    act(() => result.current.loadMore())
    await waitFor(() => expect(fetchRows).toHaveBeenCalledTimes(2))
    act(() => authListener('SIGNED_OUT', kind === 'logout' ? null : session(kind === 'user-switch' ? 'user-2' : 'user-1', kind === 'client-switch' ? 'client-2' : 'client-1')))
    expect(result.current.sequence).toBeNull()
    expect(result.current.blocked).toBe(true)
    await act(async () => pending.resolve(page(2)))
    expect(result.current.sequence).toBeNull()
  })
  it('verifies session identity again after network completion even without an auth event', async () => {
    getSession.mockResolvedValueOnce(sessionResult()).mockResolvedValueOnce(sessionResult(session('user-2')))
    const { result } = mount()
    await waitFor(() => expect(result.current.blocked).toBe(true))
    expect(result.current.sequence).toBeNull()
  })
  it('clears retained rows for forbidden responses', async () => {
    const { result } = mount()
    await ready(result)
    fetchRows.mockRejectedValueOnce(new PortfolioHubClientError('FORBIDDEN', 'Access removed', 403))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.blocked).toBe(true))
    expect(result.current.sequence).toBeNull()
  })
  it('rechecks identity on a failed page before retaining any previous rows', async () => {
    const { result, pair } = mount()
    await ready(result)
    getSession.mockResolvedValueOnce(sessionResult()).mockResolvedValueOnce(sessionResult(session('user-2')))
    fetchRows.mockRejectedValueOnce(new PortfolioHubClientError('HUB_UNAVAILABLE', 'Temporary failure', 503, null, pair.accountId))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.blocked).toBe(true))
    expect(result.current.sequence).toBeNull()
  })
  it('respects a retry-after rate limit and does not send premature retries', async () => {
    fetchRows.mockRejectedValueOnce(new PortfolioHubClientError('HUB_RATE_LIMITED', 'Slow down', 429, Date.now() + 60000))
    const { result } = mount()
    await waitFor(() => expect(result.current.retryAt).not.toBeNull())
    act(() => result.current.retry())
    expect(fetchRows).toHaveBeenCalledOnce()
  })
})
