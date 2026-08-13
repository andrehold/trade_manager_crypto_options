import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSession = vi.fn()
const setOwnReportingCurrency = vi.fn()
vi.mock('@/lib/supabase', () => ({
  getSupabaseClient: vi.fn(() => ({ auth: { getSession } })),
  hasSupabaseClient: vi.fn(() => true),
}))
vi.mock('@/lib/clientPortal/reportingCurrencyRepo', () => ({ setOwnReportingCurrency: (...args: unknown[]) => setOwnReportingCurrency(...args) }))
vi.mock('@/lib/portfolioDataHub/client', () => ({
  fetchPortfolioHubLedger: vi.fn(), fetchPortfolioHubOverview: vi.fn(), fetchPortfolioHubPositionSnapshot: vi.fn(),
  PortfolioHubClientError: class PortfolioHubClientError extends Error {
    constructor(public code: string, message: string) { super(message) }
  },
}))

import { useReportingCurrencySelection } from '../usePortfolioDataHub'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

describe('useReportingCurrencySelection', () => {
  beforeEach(() => {
    getSession.mockReset()
    getSession.mockResolvedValue({ data: { session: { access_token: 'token-1' } }, error: null })
    setOwnReportingCurrency.mockReset()
  })

  it('persists first and refreshes the Hub overview after a successful save', async () => {
    const refresh = vi.fn()
    setOwnReportingCurrency.mockResolvedValue({ ok: true, selection: { reportingCurrency: 'USDC', reportingCurrencySource: 'client' } })
    const { result } = renderHook(() => useReportingCurrencySelection(refresh))
    await act(async () => { await result.current.save('USDC') })
    expect(setOwnReportingCurrency).toHaveBeenCalledWith(expect.anything(), 'USDC')
    expect(refresh).toHaveBeenCalledOnce()
    expect(result.current.error).toBeNull()
  })

  it('leaves the surrounding overview untouched and returns the RPC failure to the selector', async () => {
    const refresh = vi.fn()
    setOwnReportingCurrency.mockResolvedValue({ ok: false, error: 'RPC denied' })
    const { result } = renderHook(() => useReportingCurrencySelection(refresh))
    await act(async () => { await result.current.save('USDC') })
    expect(refresh).not.toHaveBeenCalled()
    expect(result.current.error).toBe('RPC denied')
  })

  it('ignores duplicate clicks while one RPC is outstanding', async () => {
    const pending = deferred<any>()
    setOwnReportingCurrency.mockReturnValue(pending.promise)
    const { result } = renderHook(() => useReportingCurrencySelection(vi.fn()))
    act(() => { void result.current.save('USDC'); void result.current.save('BTC') })
    await waitFor(() => expect(setOwnReportingCurrency).toHaveBeenCalledTimes(1))
    await act(async () => { pending.resolve({ ok: true, selection: { reportingCurrency: 'USDC', reportingCurrencySource: 'client' } }) })
  })

  it('does not refresh a new session after an old session mutation completes', async () => {
    const pending = deferred<any>()
    const refresh = vi.fn()
    setOwnReportingCurrency.mockReturnValue(pending.promise)
    const { result } = renderHook(() => useReportingCurrencySelection(refresh))
    act(() => { void result.current.save('USDC') })
    await waitFor(() => expect(setOwnReportingCurrency).toHaveBeenCalledOnce())
    getSession.mockResolvedValue({ data: { session: { access_token: 'token-2' } }, error: null })
    await act(async () => { pending.resolve({ ok: true, selection: { reportingCurrency: 'USDC', reportingCurrencySource: 'client' } }) })
    expect(refresh).not.toHaveBeenCalled()
    expect(result.current.error).toMatch(/session changed/i)
  })

  it('does not update after unmount while the RPC is outstanding', async () => {
    const pending = deferred<any>()
    setOwnReportingCurrency.mockReturnValue(pending.promise)
    const refresh = vi.fn()
    const { result, unmount } = renderHook(() => useReportingCurrencySelection(refresh))
    act(() => { void result.current.save('USDC') })
    await waitFor(() => expect(setOwnReportingCurrency).toHaveBeenCalledOnce())
    unmount()
    await act(async () => { pending.resolve({ ok: true, selection: { reportingCurrency: 'USDC', reportingCurrencySource: 'client' } }) })
    expect(refresh).not.toHaveBeenCalled()
  })
})
