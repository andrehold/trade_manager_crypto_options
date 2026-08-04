import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_RISK_LIMITS } from '@/features/clientPortal/risk/riskLimits'
import { parseRiskLimits, fetchLatestRiskLimits, saveRiskLimits } from '../riskLimitsRepo'

function mockClient(over: { selectData?: unknown[]; selectError?: { message: string } | null; insertError?: { message: string } | null }) {
  const q = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: over.selectData ?? [], error: over.selectError ?? null }),
    insert: vi.fn().mockResolvedValue({ error: over.insertError ?? null }),
  }
  const from = vi.fn().mockReturnValue(q)
  return { client: { from } as unknown as SupabaseClient, from, q }
}

describe('parseRiskLimits', () => {
  it('round-trips a fully valid blob to RiskLimits', () => {
    expect(parseRiskLimits({ ...DEFAULT_RISK_LIMITS })).toEqual(DEFAULT_RISK_LIMITS)
  })
  it('ignores unknown extra keys', () => {
    expect(parseRiskLimits({ ...DEFAULT_RISK_LIMITS, bogus: 1 })).toEqual(DEFAULT_RISK_LIMITS)
  })
  it('returns null when a scalar field is missing', () => {
    const { capitalTvlBtc, ...rest } = DEFAULT_RISK_LIMITS
    expect(parseRiskLimits(rest)).toBeNull()
  })
  it('returns null when a scalar field is the wrong type', () => {
    expect(parseRiskLimits({ ...DEFAULT_RISK_LIMITS, netDeltaMaxPct: 'x' })).toBeNull()
  })
  it('returns null when autoRoll is not a boolean', () => {
    expect(parseRiskLimits({ ...DEFAULT_RISK_LIMITS, autoRoll: 'yes' })).toBeNull()
  })
  it('returns null when a band is malformed', () => {
    expect(parseRiskLimits({ ...DEFAULT_RISK_LIMITS, vega: { min: 0 } })).toBeNull()
  })
  it('returns null for non-object input', () => {
    expect(parseRiskLimits(null)).toBeNull()
    expect(parseRiskLimits('nope')).toBeNull()
  })
})

describe('fetchLatestRiskLimits', () => {
  it('returns the parsed latest limits scoped + ordered by the client', async () => {
    const { client, from, q } = mockClient({ selectData: [{ limits: { ...DEFAULT_RISK_LIMITS } }] })
    const r = await fetchLatestRiskLimits(client, 'TwoPrime')
    expect(from).toHaveBeenCalledWith('risk_limit_selections')
    expect(q.eq).toHaveBeenCalledWith('client_name', 'TwoPrime')
    expect(q.order).toHaveBeenCalledWith('ts', { ascending: false })
    expect(q.limit).toHaveBeenCalledWith(1)
    expect(r).toEqual({ ok: true, limits: DEFAULT_RISK_LIMITS })
  })
  it('returns null limits when there is no row', async () => {
    const { client } = mockClient({ selectData: [] })
    expect(await fetchLatestRiskLimits(client, 'TwoPrime')).toEqual({ ok: true, limits: null })
  })
  it('returns null limits (not an error) when the stored blob is malformed', async () => {
    const { client } = mockClient({ selectData: [{ limits: { autoRoll: 'yes' } }] })
    expect(await fetchLatestRiskLimits(client, 'TwoPrime')).toEqual({ ok: true, limits: null })
  })
  it('returns an error result on query failure', async () => {
    const { client } = mockClient({ selectData: [], selectError: { message: 'boom' } })
    expect(await fetchLatestRiskLimits(client, 'TwoPrime')).toEqual({ ok: false, error: 'boom' })
  })
})

describe('saveRiskLimits', () => {
  it('inserts the snapshot and returns ok', async () => {
    const { client, q } = mockClient({})
    const r = await saveRiskLimits(client, 'TwoPrime', DEFAULT_RISK_LIMITS)
    expect(q.insert).toHaveBeenCalledWith({ client_name: 'TwoPrime', limits: DEFAULT_RISK_LIMITS })
    expect(r).toEqual({ ok: true })
  })
  it('returns an error result on insert failure', async () => {
    const { client } = mockClient({ insertError: { message: 'denied' } })
    expect(await saveRiskLimits(client, 'TwoPrime', DEFAULT_RISK_LIMITS)).toEqual({ ok: false, error: 'denied' })
  })
})
