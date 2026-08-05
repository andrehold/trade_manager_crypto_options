import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchActivationState, saveActivation } from '../activationRepo'

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

describe('fetchActivationState', () => {
  it('returns active true when the latest event is activate', async () => {
    const { client, from, q } = mockClient({ selectData: [{ action: 'activate' }] })
    const r = await fetchActivationState(client, 'TwoPrime')
    expect(from).toHaveBeenCalledWith('activation_events')
    expect(q.eq).toHaveBeenCalledWith('client_name', 'TwoPrime')
    expect(q.order).toHaveBeenCalledWith('ts', { ascending: false })
    expect(q.limit).toHaveBeenCalledWith(1)
    expect(r).toEqual({ ok: true, active: true })
  })
  it('returns active false when the latest event is deactivate', async () => {
    const { client } = mockClient({ selectData: [{ action: 'deactivate' }] })
    expect(await fetchActivationState(client, 'TwoPrime')).toEqual({ ok: true, active: false })
  })
  it('returns active false when there are no events', async () => {
    const { client } = mockClient({ selectData: [] })
    expect(await fetchActivationState(client, 'TwoPrime')).toEqual({ ok: true, active: false })
  })
  it('returns an error result on query failure', async () => {
    const { client } = mockClient({ selectData: [], selectError: { message: 'boom' } })
    expect(await fetchActivationState(client, 'TwoPrime')).toEqual({ ok: false, error: 'boom' })
  })
})

describe('saveActivation', () => {
  it('inserts an activate row', async () => {
    const { client, q } = mockClient({})
    const r = await saveActivation(client, 'TwoPrime', true)
    expect(q.insert).toHaveBeenCalledWith({ client_name: 'TwoPrime', action: 'activate' })
    expect(r).toEqual({ ok: true })
  })
  it('inserts a deactivate row', async () => {
    const { client, q } = mockClient({})
    await saveActivation(client, 'TwoPrime', false)
    expect(q.insert).toHaveBeenCalledWith({ client_name: 'TwoPrime', action: 'deactivate' })
  })
  it('returns an error result on insert failure', async () => {
    const { client } = mockClient({ insertError: { message: 'denied' } })
    expect(await saveActivation(client, 'TwoPrime', true)).toEqual({ ok: false, error: 'denied' })
  })
})
