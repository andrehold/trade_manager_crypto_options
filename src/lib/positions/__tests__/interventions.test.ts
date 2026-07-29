import { describe, it, expect } from 'vitest'
import {
  mergeInterventionMaps,
  fetchPositionInterventions,
  recordPositionIntervention,
  type InterventionMap,
} from '../interventions'

// Minimal chainable Supabase mock: select/order/eq return the (thenable) builder,
// awaiting it resolves the select response; insert resolves its own response.
function makeClient(opts: { selectData?: unknown[]; selectError?: { message: string } | null; insertError?: { message: string } | null } = {}) {
  const calls: { eq: [string, string][]; inserted: unknown[] } = { eq: [], inserted: [] }
  const builder: Record<string, unknown> = {
    select: () => builder,
    order: () => builder,
    eq: (col: string, val: string) => { calls.eq.push([col, val]); return builder },
    insert: (row: unknown) => { calls.inserted.push(row); return Promise.resolve({ error: opts.insertError ?? null }) },
    then: (resolve: (v: unknown) => void) => resolve({ data: opts.selectData ?? [], error: opts.selectError ?? null }),
  }
  return { client: { from: () => builder } as never, calls }
}

describe('mergeInterventionMaps', () => {
  it('keeps the newest intervention per position regardless of argument order', () => {
    const older: InterventionMap = new Map([['p1', { positionId: 'p1', source: 'platform', action: 'modify', ts: '2026-07-29T09:00:00Z' }]])
    const newer: InterventionMap = new Map([['p1', { positionId: 'p1', source: 'venue', action: 'close', ts: '2026-07-29T12:00:00Z' }]])
    expect(mergeInterventionMaps(older, newer).get('p1')?.source).toBe('venue')
    expect(mergeInterventionMaps(newer, older).get('p1')?.source).toBe('venue')
  })
})

describe('fetchPositionInterventions', () => {
  it('reduces rows (newest-first) to the latest per position and filters by client', async () => {
    const { client, calls } = makeClient({
      selectData: [
        { position_id: 'p1', client_name: 'Acme', source: 'venue', action: 'close', detail: null, ts: '2026-07-29T12:00:00Z' },
        { position_id: 'p1', client_name: 'Acme', source: 'platform', action: 'modify', detail: null, ts: '2026-07-29T09:00:00Z' },
        { position_id: 'p2', client_name: 'Acme', source: 'platform', action: 'open', detail: null, ts: '2026-07-29T08:00:00Z' },
      ],
    })
    const res = await fetchPositionInterventions(client, { clientName: 'Acme', isAdmin: false })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.interventions.get('p1')?.source).toBe('venue')
      expect(res.interventions.get('p2')?.action).toBe('open')
    }
    expect(calls.eq).toContainEqual(['client_name', 'Acme'])
  })

  it('returns the error when the query fails', async () => {
    const { client } = makeClient({ selectError: { message: 'boom' } })
    const res = await fetchPositionInterventions(client, { clientName: 'Acme', isAdmin: false })
    expect(res).toEqual({ ok: false, error: 'boom' })
  })
})

describe('recordPositionIntervention', () => {
  it('inserts a nullified row and reports success', async () => {
    const { client, calls } = makeClient()
    const res = await recordPositionIntervention(client, {
      positionId: 'p9', source: 'platform', action: 'modify', clientScope: { clientName: 'Acme', isAdmin: false },
    })
    expect(res).toEqual({ ok: true })
    expect(calls.inserted[0]).toMatchObject({
      position_id: 'p9', client_name: 'Acme', source: 'platform', action: 'modify', detail: null, created_by: null,
    })
  })
})
