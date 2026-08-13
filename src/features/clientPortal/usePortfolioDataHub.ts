import React from 'react'
import {
  fetchPortfolioHubLedger,
  fetchPortfolioHubOverview,
  fetchPortfolioHubPositionSnapshot,
  PortfolioHubClientError,
  type HubLedgerFilters,
  type PortfolioHubOverview,
} from '@/lib/portfolioDataHub/client'
import type { HubLedgerEvent, HubPosition } from '@/lib/portfolioDataHub'
import { getSupabaseClient, hasSupabaseClient } from '@/lib/supabase'
import { setOwnReportingCurrency } from '@/lib/clientPortal/reportingCurrencyRepo'

export type PortfolioHubState =
  | { status: 'not-configured' }
  | { status: 'loading' }
  | { status: 'ready'; overview: PortfolioHubOverview }
  | { status: 'unmapped'; message: string }
  | { status: 'session-expired'; message: string }
  | { status: 'unavailable'; message: string }

function stateFromError(error: unknown): PortfolioHubState {
  if (error instanceof PortfolioHubClientError) {
    if (error.code === 'HUB_ACCOUNT_NOT_CONFIGURED') return { status: 'unmapped', message: error.message }
    if (error.code === 'UNAUTHENTICATED') return { status: 'session-expired', message: error.message }
  }
  return {
    status: 'unavailable',
    message: error instanceof Error ? error.message : 'Portfolio Data Hub is unavailable',
  }
}

async function currentAccessToken(): Promise<string> {
  const { data, error } = await getSupabaseClient().auth.getSession()
  if (error || !data.session?.access_token) {
    throw new PortfolioHubClientError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.')
  }
  return data.session.access_token
}

async function currentSessionIdentity(): Promise<string> {
  const { data, error } = await getSupabaseClient().auth.getSession()
  if (error || !data.session?.access_token) {
    throw new PortfolioHubClientError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.')
  }
  // A normal Supabase token refresh changes access_token without changing the signed-in user.
  // Prefer the stable auth user ID so that only an actual account switch invalidates this save.
  return data.session.user?.id ?? data.session.access_token
}

/** Fetches the independently-provenanced summary and position datasets together. */
export function usePortfolioDataHub() {
  const [state, setState] = React.useState<PortfolioHubState>(() => (
    hasSupabaseClient() ? { status: 'loading' } : { status: 'not-configured' }
  ))
  const [nonce, setNonce] = React.useState(0)

  React.useEffect(() => {
    if (!hasSupabaseClient()) {
      setState({ status: 'not-configured' })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    void currentAccessToken()
      .then((accessToken) => fetchPortfolioHubOverview(accessToken))
      .then((overview) => { if (!cancelled) setState({ status: 'ready', overview }) })
      .catch((error: unknown) => { if (!cancelled) setState(stateFromError(error)) })
    return () => { cancelled = true }
  }, [nonce])

  return { state, reload: React.useCallback(() => setNonce((value) => value + 1), []) }
}

/**
 * Persists the client's account-level reporting currency before asking the Hub overview to
 * refresh. The returned overview remains the source of truth; this hook never recalculates
 * or locally converts headline values.
 */
export function useReportingCurrencySelection(onSaved: () => void) {
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const mounted = React.useRef(true)
  const request = React.useRef(0)
  const inFlight = React.useRef(false)
  React.useEffect(() => () => { mounted.current = false }, [])

  const save = React.useCallback(async (currency: string | null) => {
    if (inFlight.current) return
    const requestId = ++request.current
    inFlight.current = true
    setSaving(true)
    setError(null)
    try {
      const beforeSession = await currentSessionIdentity()
      const result = await setOwnReportingCurrency(getSupabaseClient(), currency)
      if (!mounted.current || request.current !== requestId) return
      if (!result.ok) {
        setError(result.error)
        return
      }
      // Do not refresh a newly signed-in account based on a mutation submitted under a
      // previous session. The RPC remains safely scoped server-side either way.
      const afterSession = await currentSessionIdentity()
      if (!mounted.current || request.current !== requestId) return
      if (afterSession !== beforeSession) {
        setError('Your session changed before the reporting currency was refreshed. Please try again.')
        return
      }
      onSaved()
    } catch (cause) {
      if (mounted.current && request.current === requestId) {
        setError(cause instanceof Error ? cause.message : 'Could not save reporting currency. Please try again.')
      }
    } finally {
      if (mounted.current && request.current === requestId) setSaving(false)
      if (request.current === requestId) inFlight.current = false
    }
  }, [onSaved])

  return { saving, error, save }
}

type PositionsState = {
  items: HubPosition[]
  nextCursor: string | null
  loadingMore: boolean
  error: string | null
}

/** Extends an overview's initial page using the same immutable position snapshot. */
export function usePortfolioHubPositions(overview: PortfolioHubOverview) {
  const initialItems = overview.positions.items
  const [state, setState] = React.useState<PositionsState>({
    items: initialItems, nextCursor: overview.positions.nextCursor, loadingMore: false, error: null,
  })
  const generation = React.useRef(0)
  const mounted = React.useRef(true)
  React.useEffect(() => () => { mounted.current = false }, [])

  React.useEffect(() => {
    generation.current += 1
    setState({ items: initialItems, nextCursor: overview.positions.nextCursor, loadingMore: false, error: null })
  }, [initialItems, overview.positions.nextCursor, overview.positions.snapshot.id])

  const loadMore = React.useCallback(async () => {
    const cursor = state.nextCursor
    if (!cursor || state.loadingMore) return
    const requestGeneration = generation.current
    setState((current) => ({ ...current, loadingMore: true, error: null }))
    try {
      const accessToken = await currentAccessToken()
      const page = await fetchPortfolioHubPositionSnapshot(accessToken, overview.positions.pageToken, { cursor, limit: 200 })
      if (!mounted.current || generation.current !== requestGeneration) return
      setState((current) => ({
        items: mergeById(current.items, page.items),
        nextCursor: page.nextCursor,
        loadingMore: false,
        error: null,
      }))
    } catch (error) {
      if (mounted.current && generation.current === requestGeneration) {
        setState((current) => ({ ...current, loadingMore: false, error: error instanceof Error ? error.message : 'Could not load more positions' }))
      }
    }
  }, [overview.positions.pageToken, state.loadingMore, state.nextCursor])
  return { ...state, loadMore }
}

type LedgerState = {
  events: HubLedgerEvent[]
  nextCursor: string | null
  loading: boolean
  loadingMore: boolean
  error: string | null
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const seen = new Set(existing.map((item) => item.id))
  return [...existing, ...incoming.filter((item) => !seen.has(item.id))]
}

/** Cursor-paginated ledger. A filter change deliberately starts a new history. */
export function usePortfolioHubLedger(enabled: boolean, filters: HubLedgerFilters) {
  const [state, setState] = React.useState<LedgerState>({
    events: [], nextCursor: null, loading: enabled, loadingMore: false, error: null,
  })
  const filtersKey = `${filters.eventType ?? ''}\u0000${filters.currency ?? ''}\u0000${filters.instrument ?? ''}`
  const generation = React.useRef(0)
  const mounted = React.useRef(true)
  React.useEffect(() => () => { mounted.current = false }, [])

  React.useEffect(() => {
    generation.current += 1
    const requestGeneration = generation.current
    if (!enabled) {
      setState({ events: [], nextCursor: null, loading: false, loadingMore: false, error: null })
      return
    }
    let cancelled = false
    setState({ events: [], nextCursor: null, loading: true, loadingMore: false, error: null })
    void currentAccessToken()
      .then((accessToken) => fetchPortfolioHubLedger(accessToken, { ...filters, limit: 50 }))
      .then((page) => {
        if (!cancelled && mounted.current && generation.current === requestGeneration) setState({ events: page.items, nextCursor: page.nextCursor, loading: false, loadingMore: false, error: null })
      })
      .catch((error: unknown) => {
        if (!cancelled && mounted.current && generation.current === requestGeneration) setState({ events: [], nextCursor: null, loading: false, loadingMore: false, error: error instanceof Error ? error.message : 'Could not load ledger history' })
      })
    return () => { cancelled = true }
    // filtersKey expresses the primitive filter values and avoids refetching on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, filtersKey])

  const loadMore = React.useCallback(async () => {
    if (!enabled || !state.nextCursor || state.loadingMore) return
    const cursor = state.nextCursor
    const requestGeneration = generation.current
    setState((current) => ({ ...current, loadingMore: true, error: null }))
    try {
      const accessToken = await currentAccessToken()
      const page = await fetchPortfolioHubLedger(accessToken, { ...filters, cursor, limit: 50 })
      if (!mounted.current || generation.current !== requestGeneration) return
      setState((current) => ({
        events: mergeById(current.events, page.items),
        nextCursor: page.nextCursor,
        loading: false,
        loadingMore: false,
        error: null,
      }))
    } catch (error) {
      if (mounted.current && generation.current === requestGeneration) {
        setState((current) => ({ ...current, loadingMore: false, error: error instanceof Error ? error.message : 'Could not load more ledger history' }))
      }
    }
  }, [enabled, filters, state.loadingMore, state.nextCursor])

  return { ...state, loadMore }
}
