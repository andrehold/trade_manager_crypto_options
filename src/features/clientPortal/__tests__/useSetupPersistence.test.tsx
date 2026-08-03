import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('@/lib/supabase', () => ({ getSupabaseClient: () => ({}), hasSupabaseClient: () => true }))
vi.mock('@/lib/clientPortal/strategyRepo', () => ({
  fetchLatestStrategy: vi.fn(), saveStrategy: vi.fn(),
}))
vi.mock('@/lib/clientPortal/appropriatenessRepo', () => ({
  fetchLatestAppropriateness: vi.fn(), saveAppropriateness: vi.fn(),
}))

import { fetchLatestStrategy, saveStrategy } from '@/lib/clientPortal/strategyRepo'
import { fetchLatestAppropriateness, saveAppropriateness } from '@/lib/clientPortal/appropriatenessRepo'
import { useSetupPersistence } from '../useSetupPersistence'

const fApp = vi.mocked(fetchLatestAppropriateness)
const fStr = vi.mocked(fetchLatestStrategy)
const sApp = vi.mocked(saveAppropriateness)
const sStr = vi.mocked(saveStrategy)

beforeEach(() => {
  fApp.mockResolvedValue({ ok: true, record: null })
  fStr.mockResolvedValue({ ok: true, module: null })
  sApp.mockResolvedValue({ ok: true, record: { signedName: 'R', validUntil: null, ts: 't' } })
  sStr.mockResolvedValue({ ok: true })
})

describe('useSetupPersistence', () => {
  it('seeds signed + selected strategy from fetched records', async () => {
    fApp.mockResolvedValue({ ok: true, record: { signedName: 'R', validUntil: null, ts: 't' } })
    fStr.mockResolvedValue({ ok: true, module: 'Range Condor' })
    const { result } = renderHook(() => useSetupPersistence('TwoPrime'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.appropriatenessSigned).toBe(true)
    expect(result.current.selectedStrategy).toBe('Range Condor')
  })

  it('saveStrategy delegates to the repo and returns its result', async () => {
    const { result } = renderHook(() => useSetupPersistence('TwoPrime'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    const r = await result.current.saveStrategy('Range Condor')
    expect(sStr).toHaveBeenCalledWith(expect.anything(), 'TwoPrime', 'Range Condor')
    expect(r).toEqual({ ok: true })
  })

  it('surfaces a save error from the repo', async () => {
    sApp.mockResolvedValue({ ok: false, error: 'denied' })
    const { result } = renderHook(() => useSetupPersistence('TwoPrime'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    const r = await result.current.saveAppropriateness({ answers: [], attestations: [], signedName: 'X' })
    expect(r).toEqual({ ok: false, error: 'denied' })
  })
})
