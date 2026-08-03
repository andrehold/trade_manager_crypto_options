import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { addMonths, mapRow, fetchLatestAppropriateness, saveAppropriateness } from '../appropriatenessRepo'

describe('addMonths', () => {
  it('adds whole months to an ISO instant', () => {
    expect(addMonths('2026-08-03T00:00:00.000Z', 12)).toBe('2027-08-03T00:00:00.000Z')
  })
})

describe('mapRow', () => {
  it('maps snake_case row to the domain record', () => {
    expect(mapRow({ signed_name: 'R. Quandt', valid_until: '2027-08-03T00:00:00.000Z', ts: '2026-08-03T00:00:00.000Z' }))
      .toEqual({ signedName: 'R. Quandt', validUntil: '2027-08-03T00:00:00.000Z', ts: '2026-08-03T00:00:00.000Z' })
  })
})

function mockClient(over: { selectData?: unknown[]; selectError?: { message: string } | null; insertRow?: unknown; insertError?: { message: string } | null }) {
  const q = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: over.selectData ?? [], error: over.selectError ?? null }),
    insert: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: over.insertRow ?? null, error: over.insertError ?? null }),
  }
  const from = vi.fn().mockReturnValue(q)
  return { client: { from } as unknown as SupabaseClient, from, q }
}

describe('fetchLatestAppropriateness', () => {
  it('returns the latest mapped record', async () => {
    const row = { signed_name: 'R. Quandt', valid_until: '2027-08-03T00:00:00.000Z', ts: '2026-08-03T00:00:00.000Z' }
    const { client, from, q } = mockClient({ selectData: [row] })
    const r = await fetchLatestAppropriateness(client, 'TwoPrime')
    expect(from).toHaveBeenCalledWith('appropriateness_assessments')
    expect(q.eq).toHaveBeenCalledWith('client_name', 'TwoPrime')
    expect(r).toEqual({ ok: true, record: { signedName: 'R. Quandt', validUntil: row.valid_until, ts: row.ts } })
  })
  it('returns null record when none exists', async () => {
    const { client } = mockClient({ selectData: [] })
    expect(await fetchLatestAppropriateness(client, 'TwoPrime')).toEqual({ ok: true, record: null })
  })
  it('returns an error result on failure', async () => {
    const { client } = mockClient({ selectData: [], selectError: { message: 'nope' } })
    expect(await fetchLatestAppropriateness(client, 'TwoPrime')).toEqual({ ok: false, error: 'nope' })
  })
})

describe('saveAppropriateness', () => {
  it('inserts with a 12-month validity and returns the mapped record', async () => {
    const row = { signed_name: 'R. Quandt', valid_until: '2027-08-03T00:00:00.000Z', ts: '2026-08-03T00:00:00.000Z' }
    const { client, q } = mockClient({ insertRow: row })
    const r = await saveAppropriateness(client, 'TwoPrime', { answers: [3, 2], attestations: [true, true, true], signedName: 'R. Quandt' })
    expect(q.insert).toHaveBeenCalledTimes(1)
    const arg = q.insert.mock.calls[0][0] as Record<string, unknown>
    expect(arg.client_name).toBe('TwoPrime')
    expect(arg.signed_name).toBe('R. Quandt')
    expect(arg.answers).toEqual([3, 2])
    expect(typeof arg.valid_until).toBe('string')
    expect(r).toEqual({ ok: true, record: { signedName: 'R. Quandt', validUntil: row.valid_until, ts: row.ts } })
  })
  it('returns an error result on insert failure', async () => {
    const { client } = mockClient({ insertError: { message: 'denied' } })
    const r = await saveAppropriateness(client, 'TwoPrime', { answers: [], attestations: [], signedName: 'X' })
    expect(r).toEqual({ ok: false, error: 'denied' })
  })
})
