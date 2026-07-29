import type { SupabaseClient } from '@/lib/supabase'
import type { SupabaseClientScope } from './clientScope'

export type InterventionSource = 'platform' | 'venue'
export type InterventionAction = 'open' | 'modify' | 'close'

export type PositionIntervention = {
  positionId: string
  source: InterventionSource
  action: InterventionAction
  detail?: string | null
  ts: string
}

export type InterventionMap = Map<string, PositionIntervention>

type RawInterventionRow = {
  position_id: string | null
  client_name: string | null
  source: string | null
  action: string | null
  detail: string | null
  ts: string | null
}

const SOURCES: InterventionSource[] = ['platform', 'venue']
const ACTIONS: InterventionAction[] = ['open', 'modify', 'close']

function toSource(raw: string | null): InterventionSource | null {
  return SOURCES.includes(raw as InterventionSource) ? (raw as InterventionSource) : null
}

function toAction(raw: string | null): InterventionAction | null {
  return ACTIONS.includes(raw as InterventionAction) ? (raw as InterventionAction) : null
}

/** Keep the newest intervention per key across two maps (e.g. fetched + optimistic overlay). */
export function mergeInterventionMaps(a: InterventionMap, b: InterventionMap): InterventionMap {
  const merged: InterventionMap = new Map(a)
  for (const [id, iv] of b) {
    const existing = merged.get(id)
    if (!existing || Date.parse(iv.ts) >= Date.parse(existing.ts)) merged.set(id, iv)
  }
  return merged
}

export type FetchInterventionsResult =
  | { ok: true; interventions: InterventionMap }
  | { ok: false; error: string }

export async function fetchPositionInterventions(
  client: SupabaseClient,
  scope: SupabaseClientScope = {},
): Promise<FetchInterventionsResult> {
  const clientName = scope.clientName?.trim()
  const restrictByClient = Boolean(clientName) && !scope.isAdmin

  let query = client
    .from('position_interventions')
    .select('position_id, client_name, source, action, detail, ts')
    .order('ts', { ascending: false })

  if (restrictByClient && clientName) {
    query = query.eq('client_name', clientName)
  }

  const { data, error } = await query
  if (error) return { ok: false, error: error.message }

  const interventions: InterventionMap = new Map()
  for (const row of (data as RawInterventionRow[] | null) ?? []) {
    const positionId = typeof row.position_id === 'string' ? row.position_id : null
    const source = toSource(row.source)
    const action = toAction(row.action)
    if (!positionId || !source || !action || !row.ts) continue
    // Rows arrive newest-first; the first one seen per position is the latest.
    if (interventions.has(positionId)) continue
    interventions.set(positionId, { positionId, source, action, detail: row.detail, ts: row.ts })
  }
  return { ok: true, interventions }
}

export type RecordInterventionParams = {
  positionId: string
  source: InterventionSource
  action: InterventionAction
  detail?: string | null
  clientScope?: SupabaseClientScope
  createdBy?: string | null
}

export type RecordInterventionResult = { ok: true } | { ok: false; error: string }

export async function recordPositionIntervention(
  client: SupabaseClient,
  params: RecordInterventionParams,
): Promise<RecordInterventionResult> {
  const clientName = params.clientScope?.clientName?.trim() ?? null
  const row = {
    position_id: params.positionId,
    client_name: clientName,
    source: params.source,
    action: params.action,
    detail: params.detail ?? null,
    created_by: params.createdBy ?? null,
  }
  const { error } = await client.from('position_interventions').insert(row)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
