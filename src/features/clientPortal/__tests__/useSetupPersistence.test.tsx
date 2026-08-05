import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('@/lib/supabase', () => ({ getSupabaseClient: () => ({}), hasSupabaseClient: () => true }))
vi.mock('@/lib/clientPortal/strategyRepo', () => ({
  fetchLatestStrategy: vi.fn(), saveStrategy: vi.fn(),
}))
vi.mock('@/lib/clientPortal/appropriatenessRepo', () => ({
  fetchLatestAppropriateness: vi.fn(), saveAppropriateness: vi.fn(),
}))
vi.mock('@/lib/clientPortal/riskLimitsRepo', () => ({
  fetchLatestRiskLimits: vi.fn(), saveRiskLimits: vi.fn(),
}))

import { fetchLatestStrategy, saveStrategy } from '@/lib/clientPortal/strategyRepo'
import { fetchLatestAppropriateness, saveAppropriateness } from '@/lib/clientPortal/appropriatenessRepo'
import { fetchLatestRiskLimits, saveRiskLimits as saveRiskLimitsRepo } from '@/lib/clientPortal/riskLimitsRepo'
import { DEFAULT_RISK_LIMITS } from '@/features/clientPortal/risk/riskLimits'
import { useSetupPersistence } from '../useSetupPersistence'

const fApp = vi.mocked(fetchLatestAppropriateness)
const fStr = vi.mocked(fetchLatestStrategy)
const fRisk = vi.mocked(fetchLatestRiskLimits)
const sApp = vi.mocked(saveAppropriateness)
const sStr = vi.mocked(saveStrategy)
const sRisk = vi.mocked(saveRiskLimitsRepo)

beforeEach(() => {
  fApp.mockResolvedValue({ ok: true, record: null })
  fStr.mockResolvedValue({ ok: true, module: null })
  fRisk.mockResolvedValue({ ok: true, limits: null })
  sApp.mockResolvedValue({ ok: true, record: { signedName: 'R', validUntil: null, ts: 't' } })
  sStr.mockResolvedValue({ ok: true })
  sRisk.mockResolvedValue({ ok: true })
})

describe('useSetupPersistence', () => {
  it('seeds signed + selected strategy from fetched records', async () => {
    fApp.mockResolvedValue({ ok: true, record: { signedName: 'R', validUntil: null, ts: 't' } })
    fStr.mockResolvedValue({ ok: true, module: 'Obsidian Core Yield' })
    const { result } = renderHook(() => useSetupPersistence('TwoPrime'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.appropriatenessSigned).toBe(true)
    expect(result.current.selectedStrategy).toBe('Obsidian Core Yield')
  })

  it('saveStrategy delegates to the repo and returns its result', async () => {
    const { result } = renderHook(() => useSetupPersistence('TwoPrime'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    const r = await result.current.saveStrategy('Obsidian Core Yield')
    expect(sStr).toHaveBeenCalledWith(expect.anything(), 'TwoPrime', 'Obsidian Core Yield')
    expect(r).toEqual({ ok: true })
  })

  it('surfaces a save error from the repo', async () => {
    sApp.mockResolvedValue({ ok: false, error: 'denied' })
    const { result } = renderHook(() => useSetupPersistence('TwoPrime'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    const r = await result.current.saveAppropriateness({ answers: [], attestations: [], signedName: 'X' })
    expect(r).toEqual({ ok: false, error: 'denied' })
  })

  it('seeds savedRiskLimits from a fetched record', async () => {
    fRisk.mockResolvedValue({ ok: true, limits: DEFAULT_RISK_LIMITS })
    const { result } = renderHook(() => useSetupPersistence('TwoPrime'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.savedRiskLimits).toEqual(DEFAULT_RISK_LIMITS)
  })

  it('saveRiskLimits delegates to the repo and returns its result', async () => {
    const { result } = renderHook(() => useSetupPersistence('TwoPrime'))
    await waitFor(() => expect(result.current.loaded).toBe(true))
    const r = await result.current.saveRiskLimits(DEFAULT_RISK_LIMITS)
    expect(sRisk).toHaveBeenCalledWith(expect.anything(), 'TwoPrime', DEFAULT_RISK_LIMITS)
    expect(r).toEqual({ ok: true })
  })
})
