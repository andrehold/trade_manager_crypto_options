import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchApprovedVersions, saveUpdateApproval } from '../updatesRepo'

function mockClient(over: { selectData?: unknown[]; selectError?: { message: string } | null; insertError?: { message: string } | null }) {
  const q = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: over.selectData ?? [], error: over.selectError ?? null }),
    insert: vi.fn().mockResolvedValue({ error: over.insertError ?? null }),
  }
  const from = vi.fn().mockReturnValue(q)
  return { client: { from } as unknown as SupabaseClient, from, q }
}

describe('fetchApprovedVersions', () => {
  it('returns the deduped approved version set for the client (insertion order)', async () => {
    const { client, from, q } = mockClient({ selectData: [{ version: 'v2.4.1' }, { version: 'v2.4.1' }, { version: 'v2.3.5' }] })
    const r = await fetchApprovedVersions(client, 'TwoPrime')
    expect(from).toHaveBeenCalledWith('update_approvals')
    expect(q.select).toHaveBeenCalledWith('version')
    expect(q.eq).toHaveBeenCalledWith('client_name', 'TwoPrime')
    expect(r).toEqual({ ok: true, versions: ['v2.4.1', 'v2.3.5'] })
  })
  it('returns an empty set with no rows', async () => {
    const { client } = mockClient({ selectData: [] })
    expect(await fetchApprovedVersions(client, 'TwoPrime')).toEqual({ ok: true, versions: [] })
  })
  it('skips a non-string version', async () => {
    const { client } = mockClient({ selectData: [{ version: 5 }, { version: 'v2.4.1' }] })
    expect(await fetchApprovedVersions(client, 'TwoPrime')).toEqual({ ok: true, versions: ['v2.4.1'] })
  })
  it('returns an error result on query failure', async () => {
    const { client } = mockClient({ selectData: [], selectError: { message: 'boom' } })
    expect(await fetchApprovedVersions(client, 'TwoPrime')).toEqual({ ok: false, error: 'boom' })
  })
})

describe('saveUpdateApproval', () => {
  it('inserts the approval', async () => {
    const { client, q } = mockClient({})
    const r = await saveUpdateApproval(client, 'TwoPrime', 'v2.4.1')
    expect(q.insert).toHaveBeenCalledWith({ client_name: 'TwoPrime', version: 'v2.4.1' })
    expect(r).toEqual({ ok: true })
  })
  it('returns an error result on insert failure', async () => {
    const { client } = mockClient({ insertError: { message: 'denied' } })
    expect(await saveUpdateApproval(client, 'TwoPrime', 'v2.4.1')).toEqual({ ok: false, error: 'denied' })
  })
})
