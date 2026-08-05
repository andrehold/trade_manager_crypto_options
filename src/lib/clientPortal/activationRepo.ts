import type { SupabaseClient } from '@supabase/supabase-js'

export type FetchActivationResult = { ok: true; active: boolean } | { ok: false; error: string }
export type SaveActivationResult = { ok: true } | { ok: false; error: string }

export async function fetchActivationState(supabase: SupabaseClient, clientName: string): Promise<FetchActivationResult> {
  const { data, error } = await supabase
    .from('activation_events')
    .select('action')
    .eq('client_name', clientName)
    .order('ts', { ascending: false })
    .limit(1)
  if (error) return { ok: false, error: error.message }
  const rows = (data ?? []) as { action: string }[]
  return { ok: true, active: rows.length > 0 && rows[0].action === 'activate' }
}

export async function saveActivation(supabase: SupabaseClient, clientName: string, active: boolean): Promise<SaveActivationResult> {
  const { error } = await supabase.from('activation_events').insert({ client_name: clientName, action: active ? 'activate' : 'deactivate' })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
