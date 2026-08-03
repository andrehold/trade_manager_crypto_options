import type { SupabaseClient } from '@supabase/supabase-js'

export type FetchStrategyResult = { ok: true; module: string | null } | { ok: false; error: string }
export type SaveStrategyResult = { ok: true } | { ok: false; error: string }

export async function fetchLatestStrategy(supabase: SupabaseClient, clientName: string): Promise<FetchStrategyResult> {
  const { data, error } = await supabase
    .from('strategy_selections')
    .select('module')
    .eq('client_name', clientName)
    .order('ts', { ascending: false })
    .limit(1)
  if (error) return { ok: false, error: error.message }
  const module = data && data.length > 0 ? (data[0] as { module: string }).module : null
  return { ok: true, module }
}

export async function saveStrategy(supabase: SupabaseClient, clientName: string, module: string): Promise<SaveStrategyResult> {
  const { error } = await supabase.from('strategy_selections').insert({ client_name: clientName, module })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
