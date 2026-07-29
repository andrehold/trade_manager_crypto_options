import React from 'react'
import { getSupabaseClient, hasSupabaseClient } from '@/lib/supabase'
import {
  fetchPositionInterventions,
  recordPositionIntervention,
  mergeInterventionMaps,
  type InterventionAction,
  type InterventionMap,
  type PositionIntervention,
} from '@/lib/positions/interventions'

export function usePositionInterventions(clientName: string | null) {
  const [fetched, setFetched] = React.useState<InterventionMap>(new Map())
  const [overlay, setOverlay] = React.useState<InterventionMap>(new Map())
  const [nonce, setNonce] = React.useState(0)

  React.useEffect(() => {
    if (!hasSupabaseClient()) return
    let ignore = false
    ;(async () => {
      const res = await fetchPositionInterventions(getSupabaseClient(), { clientName, isAdmin: false })
      if (!ignore && res.ok) setFetched(res.interventions)
    })()
    return () => { ignore = true }
  }, [clientName, nonce])

  const reload = React.useCallback(() => setNonce((n) => n + 1), [])

  const record = React.useCallback((positionId: string, action: InterventionAction, opts?: { persist?: boolean }) => {
    const iv: PositionIntervention = { positionId, source: 'platform', action, ts: new Date().toISOString() }
    // Optimistic: show the badge immediately, and drive the sample-data mode where there is no write.
    setOverlay((prev) => { const next = new Map(prev); next.set(positionId, iv); return next })

    const shouldPersist = opts?.persist !== false && hasSupabaseClient() && Boolean(clientName)
    if (!shouldPersist) return
    void recordPositionIntervention(getSupabaseClient(), {
      positionId, source: 'platform', action, clientScope: { clientName, isAdmin: false },
    }).then((res) => { if (res.ok) reload() })
  }, [clientName, reload])

  const interventions = React.useMemo(() => mergeInterventionMaps(fetched, overlay), [fetched, overlay])

  return { interventions, record, reload }
}
