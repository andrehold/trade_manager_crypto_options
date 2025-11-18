import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

type LookupResult = { ok: true; clientId: string | null } | { ok: false; error: string }

async function lookupClientId(
  client: SupabaseClient,
  clientName: string,
): Promise<LookupResult> {
  const { data, error } = await client
    .from('clients')
    .select('client_id')
    .eq('client_name', clientName)
    .maybeSingle()

  if (error) {
    return { ok: false, error: error.message }
  }

  const clientId = (data?.client_id as string | undefined) ?? null
  return { ok: true, clientId }
}

type EnsureResult = { ok: true; clientId: string } | { ok: false; error: string }

function isUniqueViolation(error: PostgrestError): boolean {
  return error.code === '23505'
}

export async function ensureClientRecord(
  client: SupabaseClient,
  clientName: string,
): Promise<EnsureResult> {
  const normalized = clientName.trim()
  if (!normalized) {
    return { ok: false, error: 'Client name is required.' }
  }

  const existing = await lookupClientId(client, normalized)
  if (!existing.ok) {
    return { ok: false, error: existing.error }
  }
  if (existing.clientId) {
    return { ok: true, clientId: existing.clientId }
  }

  const { data, error } = await client
    .from('clients')
    .insert({ client_name: normalized })
    .select('client_id')
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      const retry = await lookupClientId(client, normalized)
      if (!retry.ok) {
        return { ok: false, error: retry.error }
      }
      if (retry.clientId) {
        return { ok: true, clientId: retry.clientId }
      }
    }
    return { ok: false, error: error.message }
  }

  const clientId = (data?.client_id as string | undefined) ?? null
  if (!clientId) {
    return { ok: false, error: 'Failed to resolve client id after insert.' }
  }

  return { ok: true, clientId }
}
