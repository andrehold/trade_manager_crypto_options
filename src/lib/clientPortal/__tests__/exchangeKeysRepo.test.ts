import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  parseEventRow, deriveActiveKeys, fetchActiveKeys, addExchangeKey, revokeExchangeKey,
  type ExchangeKeyEvent,
} from '../exchangeKeysRepo'

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

function ev(over: Partial<ExchangeKeyEvent> & { keyRef: string; action: 'add' | 'revoke'; ts: string }): ExchangeKeyEvent {
  return { venue: 'Deribit', label: 'main', fingerprint: null, scopes: 'trade,read', noWithdrawal: true, ...over }
}

describe('parseEventRow', () => {
  it('maps a well-formed add row', () => {
    expect(parseEventRow({ key_ref: 'r1', action: 'add', venue: 'Deribit', label: 'main', fingerprint: 'ab12cd', scopes: 'trade,read', no_withdrawal: true, ts: 't1' }))
      .toEqual({ keyRef: 'r1', action: 'add', venue: 'Deribit', label: 'main', fingerprint: 'ab12cd', scopes: 'trade,read', noWithdrawal: true, ts: 't1' })
  })
  it('returns null when key_ref/ts missing or action invalid', () => {
    expect(parseEventRow({ action: 'add', ts: 't' })).toBeNull()
    expect(parseEventRow({ key_ref: 'r', action: 'add' })).toBeNull()
    expect(parseEventRow({ key_ref: 'r', action: 'nope', ts: 't' })).toBeNull()
    expect(parseEventRow(null)).toBeNull()
  })
  it('coerces non-string metadata to null', () => {
    const r = parseEventRow({ key_ref: 'r', action: 'revoke', ts: 't', venue: 5, no_withdrawal: 'yes' })
    expect(r).toEqual({ keyRef: 'r', action: 'revoke', venue: null, label: null, fingerprint: null, scopes: null, noWithdrawal: null, ts: 't' })
  })
})

describe('deriveActiveKeys', () => {
  it('an add yields one active key', () => {
    const keys = deriveActiveKeys([ev({ keyRef: 'a', action: 'add', ts: '1' })])
    expect(keys.map((k) => k.keyRef)).toEqual(['a'])
  })
  it('an add then revoke of the same key_ref yields none', () => {
    const keys = deriveActiveKeys([ev({ keyRef: 'a', action: 'add', ts: '1' }), ev({ keyRef: 'a', action: 'revoke', ts: '2' })])
    expect(keys).toEqual([])
  })
  it('a revoke with no prior add is ignored', () => {
    expect(deriveActiveKeys([ev({ keyRef: 'a', action: 'revoke', ts: '1' })])).toEqual([])
  })
  it('two distinct key_refs are independent', () => {
    const keys = deriveActiveKeys([ev({ keyRef: 'a', action: 'add', ts: '1' }), ev({ keyRef: 'b', action: 'add', ts: '2' }), ev({ keyRef: 'a', action: 'revoke', ts: '3' })])
    expect(keys.map((k) => k.keyRef)).toEqual(['b'])
  })
  it('a re-add after revoke is active again', () => {
    const keys = deriveActiveKeys([ev({ keyRef: 'a', action: 'add', ts: '1' }), ev({ keyRef: 'a', action: 'revoke', ts: '2' }), ev({ keyRef: 'a', action: 'add', ts: '3', label: 'again' })])
    expect(keys.map((k) => k.keyRef)).toEqual(['a'])
    expect(keys[0].label).toBe('again')
  })
  it('folds in ts order regardless of input order', () => {
    const keys = deriveActiveKeys([ev({ keyRef: 'a', action: 'revoke', ts: '2' }), ev({ keyRef: 'a', action: 'add', ts: '1' })])
    expect(keys).toEqual([])
  })
})

describe('fetchActiveKeys', () => {
  it('folds the client rows to the active set', async () => {
    const { client, from, q } = mockClient({ selectData: [
      { key_ref: 'a', action: 'add', venue: 'Deribit', label: 'main', fingerprint: null, scopes: 'trade,read', no_withdrawal: true, ts: '1' },
      { key_ref: 'a', action: 'revoke', ts: '2' },
      { key_ref: 'b', action: 'add', venue: 'Coincall', label: 'cc', fingerprint: null, scopes: 'trade,read', no_withdrawal: true, ts: '3' },
    ] })
    const r = await fetchActiveKeys(client, 'TwoPrime')
    expect(from).toHaveBeenCalledWith('exchange_key_events')
    expect(q.eq).toHaveBeenCalledWith('client_name', 'TwoPrime')
    expect(q.order).toHaveBeenCalledWith('ts', { ascending: true })
    expect(r).toEqual({ ok: true, keys: [{ keyRef: 'b', venue: 'Coincall', label: 'cc', fingerprint: null, scopes: 'trade,read', noWithdrawal: true, ts: '3' }] })
  })
  it('drops a malformed row rather than erroring', async () => {
    const { client } = mockClient({ selectData: [{ nonsense: true }, { key_ref: 'a', action: 'add', venue: 'Deribit', label: 'm', fingerprint: null, scopes: 'trade,read', no_withdrawal: true, ts: '1' }] })
    const r = await fetchActiveKeys(client, 'TwoPrime')
    expect(r).toEqual({ ok: true, keys: [{ keyRef: 'a', venue: 'Deribit', label: 'm', fingerprint: null, scopes: 'trade,read', noWithdrawal: true, ts: '1' }] })
  })
  it('returns an error result on query failure', async () => {
    const { client } = mockClient({ selectData: [], selectError: { message: 'boom' } })
    expect(await fetchActiveKeys(client, 'TwoPrime')).toEqual({ ok: false, error: 'boom' })
  })
})

describe('addExchangeKey', () => {
  it('inserts an add row with metadata + fixed scopes and returns the keyRef', async () => {
    const { client, q } = mockClient({})
    const r = await addExchangeKey(client, 'TwoPrime', { venue: 'Deribit', label: 'main', fingerprint: 'ab12cd', noWithdrawal: true })
    expect(r.ok).toBe(true)
    const keyRef = r.ok ? r.keyRef : ''
    expect(typeof keyRef).toBe('string')
    expect(keyRef.length).toBeGreaterThan(0)
    expect(q.insert).toHaveBeenCalledWith({
      client_name: 'TwoPrime', key_ref: keyRef, action: 'add',
      venue: 'Deribit', label: 'main', fingerprint: 'ab12cd', scopes: 'trade,read', no_withdrawal: true,
    })
  })
  it('returns an error result on insert failure', async () => {
    const { client } = mockClient({ insertError: { message: 'denied' } })
    expect(await addExchangeKey(client, 'TwoPrime', { venue: 'Deribit', label: 'x', fingerprint: null, noWithdrawal: true })).toEqual({ ok: false, error: 'denied' })
  })
})

describe('revokeExchangeKey', () => {
  it('inserts a revoke row for the key_ref', async () => {
    const { client, q } = mockClient({})
    const r = await revokeExchangeKey(client, 'TwoPrime', 'r1')
    expect(q.insert).toHaveBeenCalledWith({ client_name: 'TwoPrime', key_ref: 'r1', action: 'revoke' })
    expect(r).toEqual({ ok: true })
  })
  it('returns an error result on insert failure', async () => {
    const { client } = mockClient({ insertError: { message: 'denied' } })
    expect(await revokeExchangeKey(client, 'TwoPrime', 'r1')).toEqual({ ok: false, error: 'denied' })
  })
})
