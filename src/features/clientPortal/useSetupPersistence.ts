import React from 'react'
import { getSupabaseClient, hasSupabaseClient } from '@/lib/supabase'
import { fetchLatestStrategy, saveStrategy as saveStrategyRow } from '@/lib/clientPortal/strategyRepo'
import { fetchLatestAppropriateness, saveAppropriateness as saveApprRow, type AppropriatenessInput } from '@/lib/clientPortal/appropriatenessRepo'
import { fetchLatestRiskLimits, saveRiskLimits as saveRiskLimitsRow } from '@/lib/clientPortal/riskLimitsRepo'
import type { RiskLimits } from '@/features/clientPortal/risk/riskLimits'

type SaveResult = { ok: boolean; error?: string }

export function useSetupPersistence(clientName: string) {
  const [loaded, setLoaded] = React.useState(false)
  const [appropriatenessSigned, setAppropriatenessSigned] = React.useState(false)
  const [selectedStrategy, setSelectedStrategy] = React.useState<string | null>(null)
  const [savedRiskLimits, setSavedRiskLimits] = React.useState<RiskLimits | null>(null)

  React.useEffect(() => {
    if (!hasSupabaseClient()) { setLoaded(true); return }
    let ignore = false
    ;(async () => {
      const supabase = getSupabaseClient()
      const [appr, strat, risk] = await Promise.all([
        fetchLatestAppropriateness(supabase, clientName),
        fetchLatestStrategy(supabase, clientName),
        fetchLatestRiskLimits(supabase, clientName),
      ])
      if (ignore) return
      if (appr.ok && appr.record) setAppropriatenessSigned(true)
      if (strat.ok && strat.module) setSelectedStrategy(strat.module)
      if (risk.ok && risk.limits) setSavedRiskLimits(risk.limits)
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

  const saveRiskLimits = React.useCallback(async (limits: RiskLimits): Promise<SaveResult> => {
    if (!hasSupabaseClient()) return { ok: true }
    const r = await saveRiskLimitsRow(getSupabaseClient(), clientName, limits)
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }, [clientName])

  return { loaded, appropriatenessSigned, selectedStrategy, savedRiskLimits, saveAppropriateness, saveStrategy, saveRiskLimits }
}
