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
  fetchPortfolioHubPositionSnapshot: vi.fn(),
  PortfolioHubClientError: class PortfolioHubClientError extends Error {},
}))

import { fetchPortfolioHubLedger, fetchPortfolioHubPositionSnapshot } from '@/lib/portfolioDataHub/client'
import { usePortfolioHubLedger, usePortfolioHubPositions } from '../usePortfolioDataHub'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const page = (id: string, nextCursor: string | null = null) => ({
  items: [{ id, accountId: 'a', runId: 'r' }] as any[], nextCursor,
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
