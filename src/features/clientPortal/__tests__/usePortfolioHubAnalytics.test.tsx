import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'

const getSession = vi.fn()
let authListener: (event: string, session: Session | null) => void
const unsubscribe = vi.fn()
vi.mock('@/lib/supabase', () => ({
  hasSupabaseClient: vi.fn(() => true),
  getSupabaseClient: () => ({ auth: {
    getSession,
    onAuthStateChange: (callback: typeof authListener) => { authListener = callback; return { data: { subscription: { unsubscribe } } } },
  } }),
}))
vi.mock('@/lib/portfolioDataHub/analyticsClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/portfolioDataHub/analyticsClient')>(),
  fetchPortfolioHubAnalyticsSummary: vi.fn(),
}))
import { fetchPortfolioHubAnalyticsSummary, type AnalyticsSummaryFilters } from '@/lib/portfolioDataHub/analyticsClient'
import { parseHubAnalyticsSummary, type HubAnalyticsSummary } from '@/lib/portfolioDataHub/analyticsNormalizers'
import { PortfolioHubClientError } from '@/lib/portfolioDataHub/client'
import { hasSupabaseClient } from '@/lib/supabase'
import { usePortfolioHubAnalytics } from '../usePortfolioHubAnalytics'
import { PortfolioHubAnalyticsProvider, useDashboardAnalytics } from '../PortfolioHubAnalyticsProvider'

const root = resolve(process.cwd(), 'docs/integrations/2026-10-21-transaction-analytics/synthetic')
const raw = JSON.parse(readFileSync(resolve(root, 'costs-funding-activity.json'), 'utf8'))
const accountId = raw.account_id
const otherAccount = '00000000-0000-4000-8000-000000000099'
const userId = '10000000-0000-4000-8000-000000000001'
const clientId = '20000000-0000-4000-8000-000000000001'
const custom = { kind: 'custom', startDate: '2026-10-01', endDate: '2026-10-21' } as const
function session(user = userId, client = clientId, token = 'session-token'): Session {
  return {
    access_token: token, refresh_token: 'refresh-token', expires_in: 3600, token_type: 'bearer',
    user: { id: user, app_metadata: { client_id: client }, user_metadata: {}, aud: 'authenticated', created_at: '2026-10-01T00:00:00Z' },
  }
}
const sessionResult = (value: Session | null = session()) => ({ data: { session: value }, error: null })
function summary(filters: AnalyticsSummaryFilters, overrides: { accountId?: string; version?: string; status?: 'pending' | 'ready' | 'stale' | 'live' } = {}): HubAnalyticsSummary {
  const value = structuredClone(raw)
  value.account_id = overrides.accountId ?? accountId
  value.group_by = filters.groupBy ?? []
  value.coverage.requested_start = filters.start
  value.coverage.requested_end = filters.end
  value.coverage.normalization_version = overrides.version ?? 'build-1'
  value.coverage.derived_status = overrides.status ?? 'ready'
  if (overrides.status === 'pending') { value.groups = []; value.coverage.derived_at = null; value.coverage.normalization_version = null }
  return parseHubAnalyticsSummary(value)
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { resolve, reject, promise }
}
const fetchSummary = vi.mocked(fetchPortfolioHubAnalyticsSummary)
const useCustom = () => usePortfolioHubAnalytics({ initialPeriod: custom })
async function ready(result: { current: ReturnType<typeof usePortfolioHubAnalytics> }) {
  await waitFor(() => expect(result.current.state.status).toBe('ready'))
}

beforeEach(() => {
  vi.mocked(hasSupabaseClient).mockReturnValue(true)
  getSession.mockReset().mockResolvedValue(sessionResult())
  fetchSummary.mockReset().mockImplementation(async (_token, filters) => summary(filters))
  unsubscribe.mockClear()
  vi.useRealTimers()
})

describe('mounted analytics state', () => {
  it('loads totals and daily profit for exactly one captured default month-to-date period', async () => {
    const { result } = renderHook(() => usePortfolioHubAnalytics())
    await ready(result)
    expect(fetchSummary).toHaveBeenCalledTimes(2)
    const totals = fetchSummary.mock.calls[0][1]
    const daily = fetchSummary.mock.calls[1][1]
    expect(totals.start).toMatch(/T00:00:00\.000Z$/)
    expect(daily).toEqual({ ...totals, groupBy: ['day'], metric: 'calculated_realized_gross_profit' })
    expect(totals).not.toHaveProperty('currency')
    expect(totals).not.toHaveProperty('metric')
    expect(totals).not.toHaveProperty('category')
    expect(result.current.state.data?.window).toEqual({ start: totals.start, end: totals.end })
  })

  it('publishes the pair atomically after both responses complete', async () => {
    const totals = deferred<HubAnalyticsSummary>(), daily = deferred<HubAnalyticsSummary>()
    fetchSummary.mockImplementation((_token, filters) => filters.groupBy ? daily.promise : totals.promise)
    const { result } = renderHook(useCustom)
    await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(2))
    await act(async () => totals.resolve(summary(fetchSummary.mock.calls[0][1])))
    expect(result.current.state.data).toBeNull()
    await act(async () => daily.resolve(summary(fetchSummary.mock.calls[1][1])))
    await ready(result)
  })

  it('retains a complete identical context while refreshing and marks a confirmed-account refresh failure', async () => {
    const { result } = renderHook(useCustom)
    await ready(result)
    const prior = result.current.state.data
    const failure = deferred<HubAnalyticsSummary>()
    fetchSummary.mockReturnValue(failure.promise)
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.state.refreshing).toBe(true))
    expect(result.current.state.data).toBe(prior)
    await act(async () => failure.reject(new PortfolioHubClientError('HUB_UNAVAILABLE', 'Temporary outage', 503, null, accountId)))
    await waitFor(() => expect(result.current.state.refreshError).toBe('Temporary outage'))
    expect(result.current.state.data).toBe(prior)
    expect(result.current.state.status).toBe('ready')
  })

  it('discards cached results when refresh failure cannot confirm the mapping', async () => {
    const { result } = renderHook(useCustom)
    await ready(result)
    fetchSummary.mockRejectedValue(new PortfolioHubClientError('NETWORK_ERROR', 'Network failed'))
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.state.status).toBe('unavailable'))
    expect(result.current.state.data).toBeNull()
  })

  it('prioritizes authorization failure over a simultaneous recoverable failure', async () => {
    const { result } = renderHook(useCustom)
    await ready(result)
    fetchSummary.mockImplementation(async (_token, filters) => {
      throw new PortfolioHubClientError(filters.groupBy ? 'HUB_AUTHORIZATION_FAILED' : 'HUB_UNAVAILABLE', 'Request failed', 403, null, accountId)
    })
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.state.errorCode).toBe('HUB_AUTHORIZATION_FAILED'))
    expect(result.current.state.data).toBeNull()
    expect(fetchSummary).toHaveBeenCalledTimes(4)
  })

  it('never retains a previous period or filters under new labels and ignores late generations', async () => {
    const oldTotals = deferred<HubAnalyticsSummary>(), oldDaily = deferred<HubAnalyticsSummary>()
    fetchSummary.mockImplementation((_token, filters) => filters.currency === 'USDC'
      ? Promise.resolve(summary(filters)) : filters.groupBy ? oldDaily.promise : oldTotals.promise)
    const { result } = renderHook(useCustom)
    await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(2))
    act(() => result.current.setFilters({ currency: 'USDC' }))
    expect(result.current.state.data).toBeNull()
    await ready(result)
    const next = result.current.state.data
    expect(next?.filters).toEqual({ currency: 'USDC' })
    await act(async () => { oldTotals.resolve(summary(fetchSummary.mock.calls[0][1])); oldDaily.resolve(summary(fetchSummary.mock.calls[1][1])) })
    expect(result.current.state.data).toBe(next)
    const wait = deferred<HubAnalyticsSummary>()
    fetchSummary.mockReturnValue(wait.promise)
    act(() => result.current.setPeriod({ kind: 'custom', startDate: '2026-10-02', endDate: '2026-10-03' }))
    expect(result.current.state.data).toBeNull()
    expect(result.current.window?.start).toBe('2026-10-02T00:00:00.000Z')
  })

  it('keeps the exact period when changing filters and rejects invalid custom dates without fetching', async () => {
    const { result } = renderHook(useCustom)
    await ready(result)
    const window = result.current.window
    act(() => result.current.setFilters({ quantityUnitIsNull: true }))
    await ready(result)
    expect(result.current.window).toEqual(window)
    const count = fetchSummary.mock.calls.length
    act(() => result.current.setPeriod({ kind: 'custom', startDate: '2026-02-30', endDate: '2026-10-21' }))
    await waitFor(() => expect(result.current.state.errorCode).toBe('ANALYTICS_INVALID_QUERY'))
    expect(result.current.state.data).toBeNull()
    expect(fetchSummary).toHaveBeenCalledTimes(count)
  })

  it('advances relative periods only on manual refresh; retry preserves the captured end', async () => {
    const { result } = renderHook(() => usePortfolioHubAnalytics())
    await ready(result)
    const before = result.current.window
    act(() => result.current.retry())
    await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(4))
    await ready(result)
    expect(result.current.window).toEqual(before)
    act(() => result.current.refresh())
    await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(6))
    await ready(result)
    expect(result.current.window?.end).not.toBe(before?.end)
  })

  it.each(['metadata mismatch', 'upstream conflict'])('retries the entire pair once for %s and commits only the consistent replacement', async (kind) => {
    let call = 0
    fetchSummary.mockImplementation(async (_token, filters) => {
      call++
      if (kind === 'upstream conflict' && call === 1) throw new PortfolioHubClientError('ANALYTICS_PUBLICATION_CONFLICT', 'Publication crossed read', 409, null, accountId)
      return summary(filters, { version: call <= 2 ? (filters.groupBy ? 'build-2' : 'build-1') : 'build-3' })
    })
    const { result } = renderHook(useCustom)
    await ready(result)
    expect(fetchSummary).toHaveBeenCalledTimes(4)
    expect(result.current.state.data?.totals.coverage.normalizationVersion).toBe('build-3')
    expect(result.current.state.data?.daily.coverage.normalizationVersion).toBe('build-3')
  })

  it('stops after a second conflict and exposes a manual retry', async () => {
    fetchSummary.mockImplementation(async (_token, filters) => summary(filters, { version: filters.groupBy ? 'build-2' : 'build-1' }))
    const { result } = renderHook(useCustom)
    await waitFor(() => expect(result.current.state.status).toBe('unavailable'))
    expect(fetchSummary).toHaveBeenCalledTimes(4)
    expect(result.current.state.errorCode).toBe('ANALYTICS_PUBLICATION_CONFLICT')
    expect(result.current.state.canRetry).toBe(true)
    fetchSummary.mockImplementation(async (_token, filters) => summary(filters))
    act(() => result.current.retry())
    await ready(result)
    expect(fetchSummary).toHaveBeenCalledTimes(6)
  })

  it.each(['ANALYTICS_INVALID_QUERY', 'HUB_AUTHORIZATION_FAILED', 'HUB_UNAVAILABLE'] as const)('does not automatically retry %s', async (code) => {
    fetchSummary.mockRejectedValue(new PortfolioHubClientError(code, 'Unavailable', 400, null, accountId))
    const { result } = renderHook(useCustom)
    await waitFor(() => expect(result.current.state.status).toBe('unavailable'))
    expect(fetchSummary).toHaveBeenCalledTimes(2)
  })

  it('keeps pending separate and exposes missing build evidence without substitutes', async () => {
    fetchSummary.mockImplementation(async (_token, filters) => summary(filters, { status: 'pending' }))
    const { result } = renderHook(useCustom)
    await waitFor(() => expect(result.current.state.status).toBe('pending'))
    expect(result.current.state.data?.totals.groups).toEqual([])
    expect(result.current.state.data?.consistencyLimitations).toHaveLength(2)
    expect(fetchSummary).toHaveBeenCalledTimes(2)
  })

  it.each(['stale', 'live'] as const)('preserves the %s processing qualification independently from available metrics', async (status) => {
    fetchSummary.mockImplementation(async (_token, filters) => summary(filters, { status }))
    const { result } = renderHook(useCustom)
    await ready(result)
    expect(result.current.state.data?.totals.coverage.derivedStatus).toBe(status)
    expect(result.current.state.data?.totals.groups[0].metrics.executed_quantity.value).toBe('0.020000000000000001')
  })

  it('clears on logout and rejects late responses, even if the session is restored as another user', async () => {
    const { result } = renderHook(useCustom)
    await ready(result)
    const late = deferred<HubAnalyticsSummary>()
    fetchSummary.mockReturnValue(late.promise)
    act(() => result.current.retry())
    await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(4))
    getSession.mockResolvedValue(sessionResult(null))
    act(() => authListener('SIGNED_OUT', null))
    await waitFor(() => expect(result.current.state.errorCode).toBe('UNAUTHENTICATED'))
    expect(result.current.state.data).toBeNull()
    getSession.mockResolvedValue(sessionResult(session('different-user')))
    fetchSummary.mockImplementation(async (_token, filters) => summary(filters, { accountId: otherAccount }))
    act(() => authListener('SIGNED_IN', session('different-user')))
    await ready(result)
    await act(async () => late.resolve(summary(fetchSummary.mock.calls[0][1])))
    expect(result.current.state.data?.accountId).toBe(otherAccount)
  })

  it('clears on a client-claim switch without requiring a user switch', async () => {
    const { result } = renderHook(useCustom)
    await ready(result)
    getSession.mockResolvedValue(sessionResult(session(userId, 'different-client')))
    fetchSummary.mockImplementation(async (_token, filters) => summary(filters, { accountId: otherAccount }))
    act(() => authListener('USER_UPDATED', session(userId, 'different-client')))
    expect(result.current.state.data).toBeNull()
    await ready(result)
    expect(result.current.state.data?.accountId).toBe(otherAccount)
  })

  it('ignores a late getSession resolution from before an auth switch', async () => {
    const firstSession = deferred<ReturnType<typeof sessionResult>>()
    getSession.mockReturnValueOnce(firstSession.promise)
    const { result } = renderHook(useCustom)
    getSession.mockResolvedValue(sessionResult(session('different-user')))
    act(() => authListener('SIGNED_IN', session('different-user')))
    await ready(result)
    await act(async () => firstSession.resolve(sessionResult()))
    expect(fetchSummary).toHaveBeenCalledTimes(2)
  })

  it('keeps token refreshes from triggering a load or losing an identical user/client context', async () => {
    const { result } = renderHook(useCustom)
    await ready(result)
    const data = result.current.state.data
    getSession.mockResolvedValue(sessionResult(session(userId, clientId, 'new-token')))
    act(() => authListener('TOKEN_REFRESHED', session(userId, clientId, 'new-token')))
    expect(fetchSummary).toHaveBeenCalledTimes(2)
    expect(result.current.state.data).toBe(data)
    act(() => result.current.retry())
    await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(4))
    expect(fetchSummary.mock.calls[2][0]).toBe('new-token')
  })

  it('discards a cached account when a failed refresh confirms a remapping', async () => {
    const { result } = renderHook(useCustom)
    await ready(result)
    fetchSummary.mockRejectedValue(new PortfolioHubClientError('HUB_UNAVAILABLE', 'New mapping unavailable', 503, null, otherAccount))
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.state.status).toBe('unavailable'))
    expect(result.current.state.data).toBeNull()
  })

  it('uses mapping hints only to invalidate and can recover before an overview is available', async () => {
    const { result, rerender } = renderHook(({ hint }) => usePortfolioHubAnalytics({ initialPeriod: custom, accountIdHint: hint }), { initialProps: { hint: accountId } })
    await ready(result)
    fetchSummary.mockImplementation(async (_token, filters) => summary(filters, { accountId: otherAccount }))
    rerender({ hint: otherAccount })
    await waitFor(() => expect(result.current.state.data?.accountId).toBe(otherAccount))
  })

  it('disables fetching outside the dashboard and clears values on unmount without persistent cache', async () => {
    const { result, rerender, unmount } = renderHook(({ enabled }) => usePortfolioHubAnalytics({ initialPeriod: custom, enabled }), { initialProps: { enabled: false } })
    expect(result.current.state.status).toBe('disabled')
    expect(fetchSummary).not.toHaveBeenCalled()
    rerender({ enabled: true })
    await ready(result)
    const signal = fetchSummary.mock.calls[0][3]!
    unmount()
    expect(signal.aborted).toBe(true)
    expect(unsubscribe).toHaveBeenCalled()
    fetchSummary.mockClear()
    const next = renderHook(useCustom)
    expect(next.result.current.state.data).toBeNull()
    await ready(next.result)
    expect(fetchSummary).toHaveBeenCalledTimes(2)
  })

  it('does not fetch when Supabase is unconfigured', () => {
    vi.mocked(hasSupabaseClient).mockReturnValue(false)
    const { result } = renderHook(useCustom)
    expect(result.current.state.status).toBe('not-configured')
    expect(fetchSummary).not.toHaveBeenCalled()
  })

  it('clears a completed period before a filter error and recovers when corrected', async () => {
    const { result } = renderHook(useCustom)
    await ready(result)
    const window = result.current.window
    act(() => result.current.setFilters({ currency: 'USD', currencyIsNull: true }))
    await waitFor(() => expect(result.current.state.errorCode).toBe('ANALYTICS_INVALID_QUERY'))
    expect(result.current.state.data).toBeNull()
    expect(fetchSummary).toHaveBeenCalledTimes(2)
    act(() => result.current.setFilters({ currency: 'USD' }))
    await ready(result)
    expect(result.current.window).toEqual(window)
    expect(fetchSummary).toHaveBeenCalledTimes(4)
  })

  it('keeps prior complete results qualified after a second publication conflict during refresh', async () => {
    const { result } = renderHook(useCustom)
    await ready(result)
    const previous = result.current.state.data
    fetchSummary.mockImplementation(async (_token, filters) => summary(filters, { version: filters.groupBy ? 'build-2' : 'build-1' }))
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.state.refreshError).not.toBeNull())
    expect(result.current.state.data).toBe(previous)
    expect(result.current.state.errorCode).toBe('ANALYTICS_PUBLICATION_CONFLICT')
    expect(fetchSummary).toHaveBeenCalledTimes(6)
  })

  it('checks identity again on failure before retaining data, even without an auth callback', async () => {
    const { result } = renderHook(useCustom)
    await ready(result)
    const fail = deferred<HubAnalyticsSummary>()
    fetchSummary.mockReturnValue(fail.promise)
    act(() => result.current.retry())
    await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(4))
    getSession.mockResolvedValue(sessionResult(session('different-user')))
    fetchSummary.mockImplementation(async (_token, filters) => summary(filters, { accountId: otherAccount }))
    await act(async () => fail.reject(new PortfolioHubClientError('HUB_UNAVAILABLE', 'Old request failed', 503, null, accountId)))
    await waitFor(() => expect(result.current.state.data?.accountId).toBe(otherAccount))
    expect(result.current.state.refreshError).toBeNull()
  })

  it('honors rate-limit cooldowns without polling or focus-triggered requests', async () => {
    const { result } = renderHook(useCustom)
    await ready(result)
    vi.useFakeTimers()
    const retryAt = Date.now() + 1000
    fetchSummary.mockRejectedValue(new PortfolioHubClientError('HUB_RATE_LIMITED', 'Rate limited', 429, retryAt, accountId))
    await act(async () => result.current.retry())
    expect(result.current.state.canRetry).toBe(false)
    const count = fetchSummary.mock.calls.length
    act(() => result.current.refresh())
    act(() => window.dispatchEvent(new Event('focus')))
    expect(fetchSummary).toHaveBeenCalledTimes(count)
    await act(async () => vi.advanceTimersByTime(10_000))
    expect(result.current.state.canRetry).toBe(true)
    expect(fetchSummary).toHaveBeenCalledTimes(count)
    vi.useRealTimers()
  })

  it('loads in StrictMode without publishing the cleaned-up request generation', async () => {
    const { result } = renderHook(useCustom, { wrapper: ({ children }) => <React.StrictMode>{children}</React.StrictMode> })
    await ready(result)
    expect(result.current.state.data?.accountId).toBe(accountId)
  })

  it('mounts independently of any snapshot/lifetime hook and never requests detail data', async () => {
    const { result } = renderHook(() => useDashboardAnalytics(), {
      wrapper: ({ children }) => <PortfolioHubAnalyticsProvider enabled>{children}</PortfolioHubAnalyticsProvider>,
    })
    await ready(result)
    expect(fetchSummary).toHaveBeenCalledTimes(2)
  })
})
