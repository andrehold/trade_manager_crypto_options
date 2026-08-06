import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mapAuditRow, fetchAuditEvents, saveAuditEvent } from '../auditRepo'
import type { AuditEvent } from '@/features/clientPortal/audit'

function mockClient(over: { selectData?: unknown[]; selectError?: { message: string } | null; insertError?: { message: string } | null }) {
  const q = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: over.selectData ?? [], error: over.selectError ?? null }),
    insert: vi.fn().mockResolvedValue({ error: over.insertError ?? null }),
  }
  const from = vi.fn().mockReturnValue(q)
  return { client: { from } as unknown as SupabaseClient, from, q }
}

describe('mapAuditRow', () => {
  it('maps a well-formed row', () => {
    expect(mapAuditRow({ id: 'a1', type: 'UPDATE', detail: 'approved v2.4.1', actor: 'client', ts: 't1' }))
      .toEqual({ id: 'a1', ts: 't1', actor: 'client', type: 'UPDATE', detail: 'approved v2.4.1' })
  })
  it('coerces actor: system stays system, anything else becomes client', () => {
    expect(mapAuditRow({ id: 'a', type: 'EXECUTION', detail: 'd', actor: 'system', ts: 't' })?.actor).toBe('system')
    expect(mapAuditRow({ id: 'a', type: 'X', detail: 'd', actor: 'weird', ts: 't' })?.actor).toBe('client')
    expect(mapAuditRow({ id: 'a', type: 'X', detail: 'd', ts: 't' })?.actor).toBe('client')
  })
  it('returns null when a required string field is missing or wrong-typed', () => {
    expect(mapAuditRow({ type: 'X', detail: 'd', actor: 'client', ts: 't' })).toBeNull()
    expect(mapAuditRow({ id: 'a', detail: 'd', actor: 'client', ts: 't' })).toBeNull()
    expect(mapAuditRow({ id: 'a', type: 'X', actor: 'client', ts: 't' })).toBeNull()
    expect(mapAuditRow({ id: 'a', type: 'X', detail: 'd', actor: 'client', ts: 5 })).toBeNull()
    expect(mapAuditRow(null)).toBeNull()
  })
})

describe('fetchAuditEvents', () => {
  it('returns the mapped events ordered by the client, dropping malformed rows', async () => {
    const { client, from, q } = mockClient({ selectData: [
      { id: 'a1', type: 'UPDATE', detail: 'd1', actor: 'client', ts: '2' },
      { nonsense: true },
      { id: 'a2', type: 'ACTIVATION', detail: 'd2', actor: 'client', ts: '1' },
    ] })
    const r = await fetchAuditEvents(client, 'TwoPrime')
    expect(from).toHaveBeenCalledWith('audit_events')
    expect(q.eq).toHaveBeenCalledWith('client_name', 'TwoPrime')
    expect(q.order).toHaveBeenCalledWith('ts', { ascending: false })
    expect(r).toEqual({ ok: true, events: [
      { id: 'a1', ts: '2', actor: 'client', type: 'UPDATE', detail: 'd1' },
      { id: 'a2', ts: '1', actor: 'client', type: 'ACTIVATION', detail: 'd2' },
    ] })
  })
  it('returns an error result on query failure', async () => {
    const { client } = mockClient({ selectData: [], selectError: { message: 'boom' } })
    expect(await fetchAuditEvents(client, 'TwoPrime')).toEqual({ ok: false, error: 'boom' })
  })
})

describe('saveAuditEvent', () => {
  const EV: AuditEvent = { id: 'evt-1-abc', ts: '2026-08-01T00:00:00Z', actor: 'client', type: 'UPDATE', detail: 'approved v2.4.1' }
  it('inserts the event fields (not the client id)', async () => {
    const { client, q } = mockClient({})
    const r = await saveAuditEvent(client, 'TwoPrime', EV)
    expect(q.insert).toHaveBeenCalledWith({ client_name: 'TwoPrime', type: 'UPDATE', detail: 'approved v2.4.1', actor: 'client', ts: '2026-08-01T00:00:00Z' })
    expect(r).toEqual({ ok: true })
  })
  it('returns an error result on insert failure', async () => {
    const { client } = mockClient({ insertError: { message: 'denied' } })
    expect(await saveAuditEvent(client, 'TwoPrime', EV)).toEqual({ ok: false, error: 'denied' })
  })
})
