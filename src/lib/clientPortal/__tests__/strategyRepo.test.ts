import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchLatestStrategy, saveStrategy } from '../strategyRepo'

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

describe('fetchLatestStrategy', () => {
  it('returns the latest module scoped + ordered by the client', async () => {
    const { client, from, q } = mockClient({ selectData: [{ module: 'Range Condor' }] })
    const r = await fetchLatestStrategy(client, 'TwoPrime')
    expect(from).toHaveBeenCalledWith('strategy_selections')
    expect(q.eq).toHaveBeenCalledWith('client_name', 'TwoPrime')
    expect(q.order).toHaveBeenCalledWith('ts', { ascending: false })
    expect(q.limit).toHaveBeenCalledWith(1)
    expect(r).toEqual({ ok: true, module: 'Range Condor' })
  })
  it('returns null when there is no selection', async () => {
    const { client } = mockClient({ selectData: [] })
    expect(await fetchLatestStrategy(client, 'TwoPrime')).toEqual({ ok: true, module: null })
  })
  it('returns an error result on query failure', async () => {
    const { client } = mockClient({ selectData: [], selectError: { message: 'boom' } })
    expect(await fetchLatestStrategy(client, 'TwoPrime')).toEqual({ ok: false, error: 'boom' })
  })
})

describe('saveStrategy', () => {
  it('inserts the selection and returns ok', async () => {
    const { client, q } = mockClient({})
    const r = await saveStrategy(client, 'TwoPrime', 'Range Condor')
    expect(q.insert).toHaveBeenCalledWith({ client_name: 'TwoPrime', module: 'Range Condor' })
    expect(r).toEqual({ ok: true })
  })
  it('returns an error result on insert failure', async () => {
    const { client } = mockClient({ insertError: { message: 'denied' } })
    expect(await saveStrategy(client, 'TwoPrime', 'X')).toEqual({ ok: false, error: 'denied' })
  })
})
