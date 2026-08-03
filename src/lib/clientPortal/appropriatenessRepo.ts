import type { SupabaseClient } from '@supabase/supabase-js'

export type AppropriatenessRecord = { signedName: string | null; validUntil: string | null; ts: string }
export type AppropriatenessInput = { answers: unknown; attestations: unknown; signedName: string }
export type FetchApprResult = { ok: true; record: AppropriatenessRecord | null } | { ok: false; error: string }
export type SaveApprResult = { ok: true; record: AppropriatenessRecord } | { ok: false; error: string }

export function addMonths(iso: string, months: number): string {
  const d = new Date(iso)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString()
}

export function mapRow(row: { signed_name: string | null; valid_until: string | null; ts: string }): AppropriatenessRecord {
  return { signedName: row.signed_name, validUntil: row.valid_until, ts: row.ts }
}

export async function fetchLatestAppropriateness(supabase: SupabaseClient, clientName: string): Promise<FetchApprResult> {
  const { data, error } = await supabase
    .from('appropriateness_assessments')
    .select('signed_name, valid_until, ts')
    .eq('client_name', clientName)
    .order('ts', { ascending: false })
    .limit(1)
  if (error) return { ok: false, error: error.message }
  const rows = (data ?? []) as { signed_name: string | null; valid_until: string | null; ts: string }[]
  return { ok: true, record: rows.length > 0 ? mapRow(rows[0]) : null }
}

export async function saveAppropriateness(
  supabase: SupabaseClient,
  clientName: string,
  input: AppropriatenessInput,
): Promise<SaveApprResult> {
  const validUntil = addMonths(new Date().toISOString(), 12)
  const { data, error } = await supabase
    .from('appropriateness_assessments')
    .insert({
      client_name: clientName,
      answers: input.answers,
      attestations: input.attestations,
      signed_name: input.signedName,
      valid_until: validUntil,
    })
    .select('signed_name, valid_until, ts')
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, record: mapRow(data as { signed_name: string | null; valid_until: string | null; ts: string }) }
}
