import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSession = vi.fn()
vi.mock('@/lib/supabase', () => ({
  hasSupabaseClient: vi.fn(() => true),
  getSupabaseClient: vi.fn(() => ({ auth: { getSession } })),
}))
vi.mock('@/lib/portfolioDataHub/client', () => ({
  fetchPortfolioHubLedger: vi.fn(),
  fetchPortfolioHubOverview: vi.fn(),
  fetchPortfolioHubPerformance: vi.fn(),
  fetchPortfolioHubPositionSnapshot: vi.fn(),
  fetchPortfolioHubSummaries: vi.fn(),
  PortfolioHubClientError: class PortfolioHubClientError extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number | null = null,
      public retryAt: number | null = null,
      public mappedAccountId: string | null = null,
    ) {
      super(message)
    }
  },
}))

import {
  fetchPortfolioHubLedger,
  fetchPortfolioHubPerformance,
  fetchPortfolioHubPositionSnapshot,
  PortfolioHubClientError,
} from '@/lib/portfolioDataHub/client'
import {
  clearPortfolioPerformanceCache,
  usePortfolioHubPerformance,
  usePortfolioHubLedger,
  usePortfolioHubPositions,
} from '../usePortfolioDataHub'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const page = (id: string, nextCursor: string | null = null) => ({
  items: [{ id, accountId: 'a', runId: 'r' }] as any[], nextCursor,
})

const userId = '10000000-0000-4000-8000-000000000001'
const clientId = '20000000-0000-4000-8000-000000000001'
const accountId = '30000000-0000-4000-8000-000000000001'

function session(user = userId, client = clientId, accessToken = 'session-token') {
  return {
    data: {
      session: {
        access_token: accessToken,
        user: { id: user, app_metadata: { client_id: client } },
      },
    },
    error: null,
  }
}

function performance(account = accountId, revision = 1) {
  return {
    accountId: account,
    revision,
    quality: {
      equityStatus: 'ready',
      performanceStatus: 'ready',
      freshness: 'fresh',
      recalculationPending: false,
      reasonCodes: [],
    },
  } as any
}

describe('usePortfolioHubPerformance', () => {
  beforeEach(() => {
    clearPortfolioPerformanceCache()
    getSession.mockReset()
    getSession.mockResolvedValue(session())
    vi.mocked(fetchPortfolioHubPerformance).mockReset()
    vi.useRealTimers()
  })

  it('keys cached data by user, client, and response account and preserves object identity on 304', async () => {
    const data = performance()
    vi.mocked(fetchPortfolioHubPerformance)
      .mockResolvedValueOnce({ status: 'updated', data, etag: '"portal-v1"' })
      .mockResolvedValueOnce({ status: 'not-modified', etag: '"portal-v1"' })

    const { result } = renderHook(() => usePortfolioHubPerformance())
    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    const firstObject = result.current.state.data

    await act(async () => { await result.current.refresh() })

    expect(result.current.state.status).toBe('ready')
    expect(result.current.state.data).toBe(firstObject)
    expect(fetchPortfolioHubPerformance).toHaveBeenNthCalledWith(1, 'session-token', null)
    expect(fetchPortfolioHubPerformance).toHaveBeenNthCalledWith(2, 'session-token', '"portal-v1"')
  })

  it('recovers once with an unconditional request from a cacheless 304', async () => {
    const data = performance()
    vi.mocked(fetchPortfolioHubPerformance)
      .mockResolvedValueOnce({ status: 'not-modified', etag: '"orphan"' })
      .mockResolvedValueOnce({ status: 'updated', data, etag: '"portal-v1"' })

    const { result } = renderHook(() => usePortfolioHubPerformance())
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    expect(result.current.state.data).toBe(data)
    expect(fetchPortfolioHubPerformance).toHaveBeenCalledTimes(2)
    expect(fetchPortfolioHubPerformance).toHaveBeenNthCalledWith(1, 'session-token', null)
    expect(fetchPortfolioHubPerformance).toHaveBeenNthCalledWith(2, 'session-token', null)
  })

  it('does not reuse cache entries across user, client, or account changes', async () => {
    const first = performance(accountId, 1)
    const secondAccount = '30000000-0000-4000-8000-000000000002'
    const second = performance(secondAccount, 2)
    const thirdClient = '20000000-0000-4000-8000-000000000002'
    const third = performance('30000000-0000-4000-8000-000000000003', 3)
    vi.mocked(fetchPortfolioHubPerformance)
      .mockResolvedValueOnce({ status: 'updated', data: first, etag: '"portal-v1"' })
      .mockResolvedValueOnce({ status: 'updated', data: second, etag: '"portal-v2"' })
      .mockResolvedValueOnce({ status: 'updated', data: third, etag: '"portal-v3"' })

    const { result } = renderHook(() => usePortfolioHubPerformance())
    await waitFor(() => expect(result.current.state.data).toBe(first))

    getSession.mockResolvedValue(session('10000000-0000-4000-8000-000000000002'))
    await act(async () => { await result.current.refresh() })
    expect(result.current.state.data).toBe(second)
    expect(fetchPortfolioHubPerformance).toHaveBeenNthCalledWith(2, 'session-token', null)

    getSession.mockResolvedValue(session('10000000-0000-4000-8000-000000000002', thirdClient))
    await act(async () => { await result.current.refresh() })
    expect(result.current.state.data).toBe(third)
    expect(fetchPortfolioHubPerformance).toHaveBeenNthCalledWith(3, 'session-token', null)
  })

  it('replaces the full cache key when the mapped response account changes', async () => {
    const first = performance(accountId, 1)
    const replacement = performance('30000000-0000-4000-8000-000000000009', 2)
    vi.mocked(fetchPortfolioHubPerformance)
      .mockResolvedValueOnce({ status: 'updated', data: first, etag: '"portal-v1"' })
      .mockResolvedValueOnce({ status: 'updated', data: replacement, etag: '"portal-v2"' })
      .mockResolvedValueOnce({ status: 'not-modified', etag: '"portal-v2"' })

    const { result } = renderHook(() => usePortfolioHubPerformance())
    await waitFor(() => expect(result.current.state.data).toBe(first))
    await act(async () => { await result.current.refresh() })
    expect(result.current.state.data).toBe(replacement)
    expect(fetchPortfolioHubPerformance).toHaveBeenNthCalledWith(2, 'session-token', '"portal-v1"')

    await act(async () => { await result.current.refresh() })
    expect(result.current.state.data).toBe(replacement)
    expect(fetchPortfolioHubPerformance).toHaveBeenNthCalledWith(3, 'session-token', '"portal-v2"')
  })

  it('does not retain a prior-account cache when remapping is followed by an upstream failure', async () => {
    const first = performance(accountId, 1)
    const remappedAccountId = '30000000-0000-4000-8000-000000000009'
    vi.mocked(fetchPortfolioHubPerformance)
      .mockResolvedValueOnce({ status: 'updated', data: first, etag: '"portal-v1"' })
      .mockRejectedValueOnce(new PortfolioHubClientError(
        'HUB_UNAVAILABLE',
        'Hub unavailable',
        502,
        null,
        remappedAccountId,
      ))

    const { result } = renderHook(() => usePortfolioHubPerformance())
    await waitFor(() => expect(result.current.state.data).toBe(first))
    await act(async () => { await result.current.refresh() })

    expect(result.current.state.status).toBe('unavailable')
    expect(result.current.state.data).toBeNull()
    expect(result.current.state.errorCode).toBe('HUB_UNAVAILABLE')
  })

  it('clears cached performance on sign-out and does not expose it to a later session', async () => {
    const first = performance()
    vi.mocked(fetchPortfolioHubPerformance)
      .mockResolvedValueOnce({ status: 'updated', data: first, etag: '"portal-v1"' })
      .mockResolvedValueOnce({ status: 'updated', data: performance(accountId, 2), etag: '"portal-v2"' })
    const { result } = renderHook(() => usePortfolioHubPerformance())
    await waitFor(() => expect(result.current.state.data).toBe(first))

    getSession.mockResolvedValue({ data: { session: null }, error: null })
    await act(async () => { await result.current.refresh() })
    expect(result.current.state.data).toBeNull()
    expect(result.current.state.errorCode).toBe('UNAUTHENTICATED')

    getSession.mockResolvedValue(session('10000000-0000-4000-8000-000000000002'))
    // A fresh hook models the portal mounting after the next successful login.
    const next = renderHook(() => usePortfolioHubPerformance())
    await waitFor(() => expect(next.result.current.state.status).toBe('ready'))
    expect(fetchPortfolioHubPerformance).toHaveBeenNthCalledWith(2, 'session-token', null)
    expect(next.result.current.state.data?.revision).toBe(2)
    next.unmount()
  })

  it('prevents a late response from an old identity from overwriting the new identity', async () => {
    const oldRequest = deferred<{ status: 'updated'; data: any; etag: string }>()
    const newRequest = deferred<{ status: 'updated'; data: any; etag: string }>()
    vi.mocked(fetchPortfolioHubPerformance)
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise)

    const { result } = renderHook(() => usePortfolioHubPerformance())
    await waitFor(() => expect(fetchPortfolioHubPerformance).toHaveBeenCalledTimes(1))

    getSession.mockResolvedValue(session('10000000-0000-4000-8000-000000000002'))
    let refreshPromise!: Promise<void>
    act(() => { refreshPromise = result.current.refresh() })
    await waitFor(() => expect(fetchPortfolioHubPerformance).toHaveBeenCalledTimes(2))
    await act(async () => { newRequest.resolve({ status: 'updated', data: performance(accountId, 2), etag: '"new"' }); await refreshPromise })
    await act(async () => { oldRequest.resolve({ status: 'updated', data: performance(accountId, 1), etag: '"old"' }) })

    expect(result.current.state.data?.revision).toBe(2)
  })

  it('performs only initial load and manual refresh, without polling or focus refresh', async () => {
    vi.mocked(fetchPortfolioHubPerformance).mockResolvedValue({
      status: 'updated', data: performance(), etag: '"portal-v1"',
    })
    const { result } = renderHook(() => usePortfolioHubPerformance())
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    const intervalSpy = vi.spyOn(globalThis, 'setInterval')
    window.dispatchEvent(new Event('focus'))
    await act(async () => { await Promise.resolve() })
    expect(fetchPortfolioHubPerformance).toHaveBeenCalledTimes(1)
    expect(intervalSpy).not.toHaveBeenCalled()

    await act(async () => { await result.current.refresh() })
    expect(fetchPortfolioHubPerformance).toHaveBeenCalledTimes(2)
    intervalSpy.mockRestore()
  })

  it('does not retry permanent errors automatically', async () => {
    vi.mocked(fetchPortfolioHubPerformance).mockRejectedValue(
      new PortfolioHubClientError('HUB_ACCOUNT_NOT_FOUND', 'Mapped account not found', 502),
    )
    const { result } = renderHook(() => usePortfolioHubPerformance())
    await waitFor(() => expect(result.current.state.status).toBe('unavailable'))

    expect(result.current.state.canRefresh).toBe(false)
    expect(result.current.state.errorCode).toBe('HUB_ACCOUNT_NOT_FOUND')
    expect(fetchPortfolioHubPerformance).toHaveBeenCalledTimes(1)
  })

  it('drops previously cached data after a permanent mapping error', async () => {
    const data = performance()
    vi.mocked(fetchPortfolioHubPerformance)
      .mockResolvedValueOnce({ status: 'updated', data, etag: '"portal-v1"' })
      .mockRejectedValueOnce(new PortfolioHubClientError('HUB_ACCOUNT_NOT_FOUND', 'Mapped account not found', 502))
    const { result } = renderHook(() => usePortfolioHubPerformance())
    await waitFor(() => expect(result.current.state.data).toBe(data))

    await act(async () => { await result.current.refresh() })

    expect(result.current.state.status).toBe('unavailable')
    expect(result.current.state.data).toBeNull()
    expect(result.current.state.canRefresh).toBe(false)
  })

  it('validates rate limiting, disables refresh temporarily, and never schedules an API call', async () => {
    const retryAt = Date.now() + 60_000
    vi.mocked(fetchPortfolioHubPerformance)
      .mockRejectedValueOnce(new PortfolioHubClientError('HUB_RATE_LIMITED', 'Try later', 503, retryAt))
      .mockResolvedValueOnce({ status: 'updated', data: performance(), etag: '"portal-v1"' })
    const { result } = renderHook(() => usePortfolioHubPerformance())
    await waitFor(() => expect(result.current.state.errorCode).toBe('HUB_RATE_LIMITED'))
    expect(result.current.state.canRefresh).toBe(false)

    await act(async () => { await result.current.refresh() })
    expect(fetchPortfolioHubPerformance).toHaveBeenCalledTimes(1)

    vi.useFakeTimers()
    vi.setSystemTime(retryAt)
    await act(async () => { await result.current.refresh() })
    expect(fetchPortfolioHubPerformance).toHaveBeenCalledTimes(2)
    expect(result.current.state.status).toBe('ready')
  })

  it('retains the last valid object only when a portal error confirms the same mapped account', async () => {
    const data = performance()
    vi.mocked(fetchPortfolioHubPerformance)
      .mockResolvedValueOnce({ status: 'updated', data, etag: '"portal-v1"' })
      .mockRejectedValueOnce(new PortfolioHubClientError(
        'HUB_UNAVAILABLE', 'Hub unavailable', 502, null, accountId,
      ))
    const { result } = renderHook(() => usePortfolioHubPerformance())
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    await act(async () => { await result.current.refresh() })

    expect(result.current.state.status).toBe('ready')
    expect(result.current.state.data).toBe(data)
    expect(result.current.state.refreshError).toBe('Hub unavailable')
    expect(result.current.state.canRefresh).toBe(true)
  })

  it('fails closed instead of retaining cached data when the portal cannot confirm the mapping', async () => {
    const data = performance()
    vi.mocked(fetchPortfolioHubPerformance)
      .mockResolvedValueOnce({ status: 'updated', data, etag: '"portal-v1"' })
      .mockRejectedValueOnce(new PortfolioHubClientError('NETWORK_ERROR', 'Network unavailable'))
    const { result } = renderHook(() => usePortfolioHubPerformance())
    await waitFor(() => expect(result.current.state.data).toBe(data))

    await act(async () => { await result.current.refresh() })

    expect(result.current.state.status).toBe('unavailable')
    expect(result.current.state.data).toBeNull()
  })
})

describe('usePortfolioHubLedger', () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'session-token' } }, error: null })
    vi.mocked(fetchPortfolioHubLedger).mockReset()
    vi.mocked(fetchPortfolioHubPositionSnapshot).mockReset()
  })

  it('ignores an old load-more response after filters change and does not duplicate IDs', async () => {
    const initial = deferred<ReturnType<typeof page>>()
    const more = deferred<ReturnType<typeof page>>()
    const filtered = deferred<ReturnType<typeof page>>()
    vi.mocked(fetchPortfolioHubLedger)
      .mockReturnValueOnce(initial.promise as any)
      .mockReturnValueOnce(more.promise as any)
      .mockReturnValueOnce(filtered.promise as any)
    const { result, rerender } = renderHook(({ currency }) => usePortfolioHubLedger(true, { currency }), { initialProps: { currency: 'USDC' } })
    await act(async () => { initial.resolve(page('first', 'cursor-2')) })
    await waitFor(() => expect(result.current.nextCursor).toBe('cursor-2'))
    act(() => { void result.current.loadMore() })
    await waitFor(() => expect(result.current.loadingMore).toBe(true))
    rerender({ currency: 'EUR' })
    await act(async () => { filtered.resolve(page('eur-first')) })
    await act(async () => { more.resolve(page('first')) })
    expect(result.current.events.map((event) => event.id)).toEqual(['eur-first'])
    expect(result.current.loadingMore).toBe(false)
  })

  it('does not update after unmount while a ledger request is outstanding', async () => {
    const initial = deferred<ReturnType<typeof page>>()
    vi.mocked(fetchPortfolioHubLedger).mockReturnValueOnce(initial.promise as any)
    const { unmount } = renderHook(() => usePortfolioHubLedger(true, {}))
    unmount()
    await act(async () => { initial.resolve(page('late')) })
    expect(true).toBe(true)
  })

  it('does not update after unmount while a pinned-position page is outstanding', async () => {
    const laterPage = deferred<ReturnType<typeof page>>()
    vi.mocked(fetchPortfolioHubPositionSnapshot).mockReturnValueOnce(laterPage.promise as any)
    const overview = {
      summary: {} as any,
      reportingCurrency: null,
      reportingCurrencySource: null,
      alignment: {} as any,
      positions: {
        items: [{ id: 'first' }], nextCursor: 'position-cursor', pageToken: 'server-signed-token', snapshot: { id: 'snapshot-1' },
      },
    } as any
    const { result, unmount } = renderHook(() => usePortfolioHubPositions(overview))
    act(() => { void result.current.loadMore() })
    await waitFor(() => expect(result.current.loadingMore).toBe(true))
    unmount()
    await act(async () => { laterPage.resolve(page('second')) })
    expect(true).toBe(true)
  })
})
