import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuditEvent, AuditType, AuditActor } from '@/features/clientPortal/audit'

export type FetchAuditResult = { ok: true; events: AuditEvent[] } | { ok: false; error: string }
export type SaveAuditResult = { ok: true } | { ok: false; error: string }

// Validating map of an untyped row. Returns null on a malformed row so callers drop it from the list.
export function mapAuditRow(row: unknown): AuditEvent | null {
  if (typeof row !== 'object' || row === null) return null
  const o = row as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.type !== 'string' || typeof o.detail !== 'string' || typeof o.ts !== 'string') return null
  const actor: AuditActor = o.actor === 'system' ? 'system' : 'client'
  return { id: o.id, ts: o.ts, actor, type: o.type as AuditType, detail: o.detail }
}

export async function fetchAuditEvents(supabase: SupabaseClient, clientName: string): Promise<FetchAuditResult> {
  const { data, error } = await supabase
    .from('audit_events')
    .select('id, type, detail, actor, ts')
    .eq('client_name', clientName)
    .order('ts', { ascending: false })
  if (error) return { ok: false, error: error.message }
  const events = (data ?? []).map(mapAuditRow).filter((e): e is AuditEvent => e !== null)
  return { ok: true, events }
}

export async function saveAuditEvent(supabase: SupabaseClient, clientName: string, event: AuditEvent): Promise<SaveAuditResult> {
  const { error } = await supabase.from('audit_events').insert({
    client_name: clientName, type: event.type, detail: event.detail, actor: event.actor, ts: event.ts,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
