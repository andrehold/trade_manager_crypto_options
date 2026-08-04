import type { SupabaseClient } from '@supabase/supabase-js'
import type { RiskLimits, Band } from '@/features/clientPortal/risk/riskLimits'

export type FetchRiskLimitsResult = { ok: true; limits: RiskLimits | null } | { ok: false; error: string }
export type SaveRiskLimitsResult = { ok: true } | { ok: false; error: string }

const NUMBER_FIELDS = [
  'capitalTvlBtc', 'maxConcurrent', 'expiryMinDte', 'expiryMaxDte',
  'gammaFloor', 'gammaCap', 'thetaFloor',
  'stressLossMaxPct', 'netDeltaMaxPct', 'drawdownReducePct', 'drawdownStopPct',
] as const

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function parseBand(v: unknown): Band | null {
  if (typeof v !== 'object' || v === null) return null
  const b = v as Record<string, unknown>
  if (!isFiniteNumber(b.min) || !isFiniteNumber(b.max)) return null
  return { min: b.min, max: b.max }
}

// Validating parse of an untyped jsonb blob. Returns a fully typed RiskLimits (copying only
// the known fields) or null on any missing / wrong-typed field, so callers can fall back to
// defaults instead of trusting malformed or legacy-shaped data.
export function parseRiskLimits(blob: unknown): RiskLimits | null {
  if (typeof blob !== 'object' || blob === null) return null
  const o = blob as Record<string, unknown>
  for (const k of NUMBER_FIELDS) if (!isFiniteNumber(o[k])) return null
  if (typeof o.autoRoll !== 'boolean') return null
  const deltaLongGamma = parseBand(o.deltaLongGamma)
  const deltaShortGamma = parseBand(o.deltaShortGamma)
  const vega = parseBand(o.vega)
  if (!deltaLongGamma || !deltaShortGamma || !vega) return null
  return {
    capitalTvlBtc: o.capitalTvlBtc as number,
    maxConcurrent: o.maxConcurrent as number,
    expiryMinDte: o.expiryMinDte as number,
    expiryMaxDte: o.expiryMaxDte as number,
    autoRoll: o.autoRoll,
    deltaLongGamma,
    deltaShortGamma,
    gammaFloor: o.gammaFloor as number,
    gammaCap: o.gammaCap as number,
    vega,
    thetaFloor: o.thetaFloor as number,
    stressLossMaxPct: o.stressLossMaxPct as number,
    netDeltaMaxPct: o.netDeltaMaxPct as number,
    drawdownReducePct: o.drawdownReducePct as number,
    drawdownStopPct: o.drawdownStopPct as number,
  }
}

export async function fetchLatestRiskLimits(supabase: SupabaseClient, clientName: string): Promise<FetchRiskLimitsResult> {
  const { data, error } = await supabase
    .from('risk_limit_selections')
    .select('limits')
    .eq('client_name', clientName)
    .order('ts', { ascending: false })
    .limit(1)
  if (error) return { ok: false, error: error.message }
  const rows = (data ?? []) as { limits: unknown }[]
  const limits = rows.length > 0 ? parseRiskLimits(rows[0].limits) : null
  return { ok: true, limits }
}

export async function saveRiskLimits(supabase: SupabaseClient, clientName: string, limits: RiskLimits): Promise<SaveRiskLimitsResult> {
  const { error } = await supabase.from('risk_limit_selections').insert({ client_name: clientName, limits })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
