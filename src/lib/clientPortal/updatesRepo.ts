import type { SupabaseClient } from '@supabase/supabase-js'

export type FetchApprovedVersionsResult = { ok: true; versions: string[] } | { ok: false; error: string }
export type SaveUpdateApprovalResult = { ok: true } | { ok: false; error: string }

export async function fetchApprovedVersions(supabase: SupabaseClient, clientName: string): Promise<FetchApprovedVersionsResult> {
  const { data, error } = await supabase
    .from('update_approvals')
    .select('version')
    .eq('client_name', clientName)
  if (error) return { ok: false, error: error.message }
  const rows = (data ?? []) as { version: unknown }[]
  const versions = Array.from(new Set(rows.map((r) => r.version).filter((v): v is string => typeof v === 'string')))
  return { ok: true, versions }
}

export async function saveUpdateApproval(supabase: SupabaseClient, clientName: string, version: string): Promise<SaveUpdateApprovalResult> {
  const { error } = await supabase.from('update_approvals').insert({ client_name: clientName, version })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
