import React from 'react'
import { getSupabaseClient, hasSupabaseClient } from '@/lib/supabase'
import { fetchSavedStructures } from '@/lib/positions/fetchSavedStructures'
import type { Position } from '@/utils'

export function useClientPositions(clientName: string | null) {
  const [positions, setPositions] = React.useState<Position[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [nonce, setNonce] = React.useState(0)

  React.useEffect(() => {
    if (!hasSupabaseClient()) { setLoading(false); return }
    let ignore = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const result = await fetchSavedStructures(getSupabaseClient(), { clientName, isAdmin: false })
        if (ignore) return
        if (result.ok) setPositions(result.positions)
        else setError(result.error ?? 'Failed to load positions')
      } catch (e) {
        if (!ignore) setError(e instanceof Error ? e.message : 'Failed to load positions')
      } finally {
        if (!ignore) setLoading(false)
      }
    })()
    return () => { ignore = true }
  }, [clientName, nonce])

  const reload = React.useCallback(() => setNonce((n) => n + 1), [])
  return { positions, loading, error, reload }
}
