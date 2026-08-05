import React from 'react'
import { getSupabaseClient, hasSupabaseClient } from '@/lib/supabase'
import { fetchLatestStrategy, saveStrategy as saveStrategyRow } from '@/lib/clientPortal/strategyRepo'
import { fetchLatestAppropriateness, saveAppropriateness as saveApprRow, type AppropriatenessInput } from '@/lib/clientPortal/appropriatenessRepo'
import { fetchLatestRiskLimits, saveRiskLimits as saveRiskLimitsRow } from '@/lib/clientPortal/riskLimitsRepo'
import { fetchActiveKeys, addExchangeKey as addKeyRow, revokeExchangeKey as revokeKeyRow, type ExchangeKey, type AddKeyInput } from '@/lib/clientPortal/exchangeKeysRepo'
import type { RiskLimits } from '@/features/clientPortal/risk/riskLimits'

type SaveResult = { ok: boolean; error?: string }

export function useSetupPersistence(clientName: string) {
  const [loaded, setLoaded] = React.useState(false)
  const [appropriatenessSigned, setAppropriatenessSigned] = React.useState(false)
  const [selectedStrategy, setSelectedStrategy] = React.useState<string | null>(null)
  const [savedRiskLimits, setSavedRiskLimits] = React.useState<RiskLimits | null>(null)
  const [activeKeys, setActiveKeys] = React.useState<ExchangeKey[]>([])

  React.useEffect(() => {
    if (!hasSupabaseClient()) { setLoaded(true); return }
    let ignore = false
    ;(async () => {
      const supabase = getSupabaseClient()
      const [appr, strat, risk, keys] = await Promise.all([
        fetchLatestAppropriateness(supabase, clientName),
        fetchLatestStrategy(supabase, clientName),
        fetchLatestRiskLimits(supabase, clientName),
        fetchActiveKeys(supabase, clientName),
      ])
      if (ignore) return
      if (appr.ok && appr.record) setAppropriatenessSigned(true)
      if (strat.ok && strat.module) setSelectedStrategy(strat.module)
      if (risk.ok && risk.limits) setSavedRiskLimits(risk.limits)
      if (keys.ok) setActiveKeys(keys.keys)
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

  const addExchangeKey = React.useCallback(async (input: AddKeyInput): Promise<{ ok: boolean; error?: string; keyRef?: string }> => {
    if (!hasSupabaseClient()) return { ok: true, keyRef: crypto.randomUUID() }
    const r = await addKeyRow(getSupabaseClient(), clientName, input)
    return r.ok ? { ok: true, keyRef: r.keyRef } : { ok: false, error: r.error }
  }, [clientName])

  const revokeExchangeKey = React.useCallback(async (keyRef: string): Promise<SaveResult> => {
    if (!hasSupabaseClient()) return { ok: true }
    const r = await revokeKeyRow(getSupabaseClient(), clientName, keyRef)
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }, [clientName])

  return { loaded, appropriatenessSigned, selectedStrategy, savedRiskLimits, activeKeys, saveAppropriateness, saveStrategy, saveRiskLimits, addExchangeKey, revokeExchangeKey }
}
