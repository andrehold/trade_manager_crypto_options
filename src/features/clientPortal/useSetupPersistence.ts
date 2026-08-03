import React from 'react'
import { getSupabaseClient, hasSupabaseClient } from '@/lib/supabase'
import { fetchLatestStrategy, saveStrategy as saveStrategyRow } from '@/lib/clientPortal/strategyRepo'
import { fetchLatestAppropriateness, saveAppropriateness as saveApprRow, type AppropriatenessInput } from '@/lib/clientPortal/appropriatenessRepo'

type SaveResult = { ok: boolean; error?: string }

export function useSetupPersistence(clientName: string) {
  const [loaded, setLoaded] = React.useState(false)
  const [appropriatenessSigned, setAppropriatenessSigned] = React.useState(false)
  const [selectedStrategy, setSelectedStrategy] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!hasSupabaseClient()) { setLoaded(true); return }
    let ignore = false
    ;(async () => {
      const supabase = getSupabaseClient()
      const [appr, strat] = await Promise.all([
        fetchLatestAppropriateness(supabase, clientName),
        fetchLatestStrategy(supabase, clientName),
      ])
      if (ignore) return
      if (appr.ok && appr.record) setAppropriatenessSigned(true)
      if (strat.ok && strat.module) setSelectedStrategy(strat.module)
      setLoaded(true)
    })()
    return () => { ignore = true }
  }, [clientName])

  const saveAppropriateness = React.useCallback(async (input: AppropriatenessInput): Promise<SaveResult> => {
    if (!hasSupabaseClient()) return { ok: true }
    const r = await saveApprRow(getSupabaseClient(), clientName, input)
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }, [clientName])

  const saveStrategy = React.useCallback(async (module: string): Promise<SaveResult> => {
    if (!hasSupabaseClient()) return { ok: true }
    const r = await saveStrategyRow(getSupabaseClient(), clientName, module)
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }, [clientName])

  return { loaded, appropriatenessSigned, selectedStrategy, saveAppropriateness, saveStrategy }
}
