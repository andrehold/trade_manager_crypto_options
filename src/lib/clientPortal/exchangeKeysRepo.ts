import type { SupabaseClient } from '@supabase/supabase-js'

export type ExchangeKeyEvent = {
  keyRef: string
  action: 'add' | 'revoke'
  venue: string | null
  label: string | null
  fingerprint: string | null
  scopes: string | null
  noWithdrawal: boolean | null
  ts: string
}

export type ExchangeKey = {
  keyRef: string
  venue: string | null
  label: string | null
  fingerprint: string | null
  scopes: string | null
  noWithdrawal: boolean | null
  ts: string
}

export type AddKeyInput = { venue: string; label: string; fingerprint: string | null; noWithdrawal: boolean }

export type FetchKeysResult = { ok: true; keys: ExchangeKey[] } | { ok: false; error: string }
export type AddKeyResult = { ok: true; keyRef: string } | { ok: false; error: string }
export type RevokeKeyResult = { ok: true } | { ok: false; error: string }

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

// Validating map of an untyped row. Returns null on a malformed/legacy row so callers can drop it
// from the fold rather than crash.
export function parseEventRow(row: unknown): ExchangeKeyEvent | null {
  if (typeof row !== 'object' || row === null) return null
  const o = row as Record<string, unknown>
  if (typeof o.key_ref !== 'string') return null
  if (typeof o.ts !== 'string') return null
  if (o.action !== 'add' && o.action !== 'revoke') return null
  return {
    keyRef: o.key_ref,
    action: o.action,
    venue: asString(o.venue),
    label: asString(o.label),
    fingerprint: asString(o.fingerprint),
    scopes: asString(o.scopes),
    noWithdrawal: typeof o.no_withdrawal === 'boolean' ? o.no_withdrawal : null,
    ts: o.ts,
  }
}

// Folds an event stream to the current active-key set: process events in ts order, latest action per
// key_ref wins, keep only key_refs whose latest action is 'add', carrying that add's metadata.
export function deriveActiveKeys(events: ExchangeKeyEvent[]): ExchangeKey[] {
  const ordered = [...events].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
  const latestByRef = new Map<string, ExchangeKeyEvent>()
  for (const e of ordered) latestByRef.set(e.keyRef, e)
  const active: ExchangeKey[] = []
  for (const e of latestByRef.values()) {
    if (e.action !== 'add') continue
    active.push({ keyRef: e.keyRef, venue: e.venue, label: e.label, fingerprint: e.fingerprint, scopes: e.scopes, noWithdrawal: e.noWithdrawal, ts: e.ts })
  }
  active.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
  return active
}

export async function fetchActiveKeys(supabase: SupabaseClient, clientName: string): Promise<FetchKeysResult> {
  const { data, error } = await supabase
    .from('exchange_key_events')
    .select('key_ref, action, venue, label, fingerprint, scopes, no_withdrawal, ts')
    .eq('client_name', clientName)
    .order('ts', { ascending: true })
  if (error) return { ok: false, error: error.message }
  const events = (data ?? []).map(parseEventRow).filter((e): e is ExchangeKeyEvent => e !== null)
  return { ok: true, keys: deriveActiveKeys(events) }
}

export async function addExchangeKey(supabase: SupabaseClient, clientName: string, input: AddKeyInput): Promise<AddKeyResult> {
  const keyRef = crypto.randomUUID()
  const { error } = await supabase.from('exchange_key_events').insert({
    client_name: clientName, key_ref: keyRef, action: 'add',
    venue: input.venue, label: input.label, fingerprint: input.fingerprint,
    scopes: 'trade,read', no_withdrawal: input.noWithdrawal,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, keyRef }
}

export async function revokeExchangeKey(supabase: SupabaseClient, clientName: string, keyRef: string): Promise<RevokeKeyResult> {
  const { error } = await supabase.from('exchange_key_events').insert({
    client_name: clientName, key_ref: keyRef, action: 'revoke',
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
