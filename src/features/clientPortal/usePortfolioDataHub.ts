import React from 'react'
import {
  fetchPortfolioHubLedger,
  fetchPortfolioHubOverview,
  fetchPortfolioHubPerformance,
  fetchPortfolioHubPositionSnapshot,
  fetchPortfolioHubSummaries,
  PortfolioHubClientError,
  type HubLedgerFilters,
  type HubClientErrorCode,
  type PortfolioHubOverview,
} from '@/lib/portfolioDataHub/client'
import type { HubLedgerEvent, HubPerformance, HubPosition, HubSummary } from '@/lib/portfolioDataHub'
import { getSupabaseClient, hasSupabaseClient } from '@/lib/supabase'
import { setOwnReportingCurrency } from '@/lib/clientPortal/reportingCurrencyRepo'

export type PortfolioHubState =
  | { status: 'not-configured' }
  | { status: 'loading' }
  | { status: 'ready'; overview: PortfolioHubOverview; history: HubSummary[]; historyError: string | null }
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

type PerformanceIdentity = {
  userId: string
  clientId: string
  accessToken: string
}

type PerformanceCacheEntry = Pick<PerformanceIdentity, 'userId' | 'clientId'> & {
  accountId: string
  data: HubPerformance
  etag: string | null
}

export type PortfolioHubPerformanceState = {
  status: 'not-configured' | 'loading' | 'ready' | 'unavailable'
  data: HubPerformance | null
  refreshing: boolean
  refreshError: string | null
  errorCode: HubClientErrorCode | null
  retryAt: number | null
  canRefresh: boolean
}

const performanceCache = new Map<string, PerformanceCacheEntry>()

function performanceIdentityKey(identity: Pick<PerformanceIdentity, 'userId' | 'clientId'>): string {
  return `${identity.userId}\u0000${identity.clientId}`
}

function performanceCacheKey(entry: Pick<PerformanceCacheEntry, 'userId' | 'clientId' | 'accountId'>): string {
  return `${performanceIdentityKey(entry)}\u0000${entry.accountId}`
}

function cachedPerformance(identity: PerformanceIdentity): PerformanceCacheEntry | null {
  const prefix = `${performanceIdentityKey(identity)}\u0000`
  for (const [key, entry] of performanceCache) {
    if (key.startsWith(prefix)) return entry
  }
  return null
}

function evictPerformanceIdentity(identityKey: string): void {
  const prefix = `${identityKey}\u0000`
  for (const key of performanceCache.keys()) {
    if (key.startsWith(prefix)) performanceCache.delete(key)
  }
}

export function clearPortfolioPerformanceCache(): void {
  performanceCache.clear()
}

async function currentPerformanceIdentity(): Promise<PerformanceIdentity> {
  const { data, error } = await getSupabaseClient().auth.getSession()
  const session = data.session
  if (error || !session?.access_token || !session.user?.id) {
    throw new PortfolioHubClientError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.')
  }
  const clientId = session.user.app_metadata?.client_id
  if (typeof clientId !== 'string' || clientId.length === 0) {
    throw new PortfolioHubClientError('CLIENT_NOT_LINKED', 'Your session is not linked to a portal client.')
  }
  return { userId: session.user.id, clientId, accessToken: session.access_token }
}

const PERMANENT_PERFORMANCE_ERRORS = new Set<HubClientErrorCode>([
  'UNAUTHENTICATED',
  'CLIENT_NOT_LINKED',
  'HUB_ACCOUNT_NOT_CONFIGURED',
  'HUB_AUTHORIZATION_FAILED',
  'HUB_ACCOUNT_NOT_FOUND',
  'HUB_INVALID_RESPONSE',
  'INVALID_RESPONSE',
  'FORBIDDEN',
])

function validRetryAt(error: PortfolioHubClientError): number | null {
  const now = Date.now()
  return error.code === 'HUB_RATE_LIMITED'
    && error.retryAt !== null
    && Number.isFinite(error.retryAt)
    && error.retryAt > now
    && error.retryAt <= now + 86_400_000
    ? error.retryAt
    : null
}

const initialPerformanceState = (): PortfolioHubPerformanceState => ({
  status: hasSupabaseClient() ? 'loading' : 'not-configured',
  data: null,
  refreshing: false,
  refreshError: null,
  errorCode: null,
  retryAt: null,
  canRefresh: hasSupabaseClient(),
})

/** Initial load plus explicit refresh only; there is no polling or focus-triggered fetch. */
export function usePortfolioHubPerformance() {
  const [state, setState] = React.useState<PortfolioHubPerformanceState>(initialPerformanceState)
  const mounted = React.useRef(true)
  const generation = React.useRef(0)
  const activeIdentity = React.useRef<string | null>(null)
  const inFlightIdentity = React.useRef<string | null>(null)

  React.useEffect(() => () => {
    mounted.current = false
    generation.current += 1
    if (activeIdentity.current) evictPerformanceIdentity(activeIdentity.current)
    activeIdentity.current = null
  }, [])

  const load = React.useCallback(async () => {
    if (!hasSupabaseClient()) {
      if (activeIdentity.current) evictPerformanceIdentity(activeIdentity.current)
      activeIdentity.current = null
      if (mounted.current) setState(initialPerformanceState())
      return
    }

    let identity: PerformanceIdentity
    try {
      identity = await currentPerformanceIdentity()
    } catch (error) {
      generation.current += 1
      if (activeIdentity.current) evictPerformanceIdentity(activeIdentity.current)
      activeIdentity.current = null
      inFlightIdentity.current = null
      if (!mounted.current) return
      const clientError = error instanceof PortfolioHubClientError ? error : null
      setState({
        status: 'unavailable',
        data: null,
        refreshing: false,
        refreshError: error instanceof Error ? error.message : 'Portfolio performance is unavailable',
        errorCode: clientError?.code ?? 'NETWORK_ERROR',
        retryAt: null,
        canRefresh: false,
      })
      return
    }

    if (!mounted.current) return

    const identityKey = performanceIdentityKey(identity)
    if (activeIdentity.current !== identityKey) {
      generation.current += 1
      if (activeIdentity.current) evictPerformanceIdentity(activeIdentity.current)
      activeIdentity.current = identityKey
      setState(initialPerformanceState())
    }
    if (inFlightIdentity.current === identityKey) return

    const requestGeneration = ++generation.current
    inFlightIdentity.current = identityKey
    const cached = cachedPerformance(identity)
    if (mounted.current) {
      setState(cached
        ? {
            status: 'ready', data: cached.data, refreshing: true, refreshError: null,
            errorCode: null, retryAt: null, canRefresh: false,
          }
        : {
            status: 'loading', data: null, refreshing: true, refreshError: null,
            errorCode: null, retryAt: null, canRefresh: false,
          })
    }

    try {
      let result = await fetchPortfolioHubPerformance(identity.accessToken, cached?.etag ?? null)
      if (result.status === 'not-modified' && cached === null) {
        result = await fetchPortfolioHubPerformance(identity.accessToken, null)
      }
      if (
        !mounted.current
        || generation.current !== requestGeneration
        || activeIdentity.current !== identityKey
      ) return

      if (result.status === 'not-modified') {
        if (cached === null) throw new PortfolioHubClientError(
          'INVALID_RESPONSE',
          'Portfolio performance could not recover from an empty conditional response.',
        )
        const preserved = { ...cached, etag: result.etag ?? cached.etag }
        performanceCache.set(performanceCacheKey(preserved), preserved)
        setState({
          status: 'ready', data: cached.data, refreshing: false, refreshError: null,
          errorCode: null, retryAt: null, canRefresh: true,
        })
        return
      }

      evictPerformanceIdentity(identityKey)
      const entry: PerformanceCacheEntry = {
        userId: identity.userId,
        clientId: identity.clientId,
        accountId: result.data.accountId,
        data: result.data,
        etag: result.etag,
      }
      performanceCache.set(performanceCacheKey(entry), entry)
      setState({
        status: 'ready', data: result.data, refreshing: false, refreshError: null,
        errorCode: null, retryAt: null, canRefresh: true,
      })
    } catch (error) {
      if (
        !mounted.current
        || generation.current !== requestGeneration
        || activeIdentity.current !== identityKey
      ) return
      const clientError = error instanceof PortfolioHubClientError ? error : null
      const retryAt = clientError ? validRetryAt(clientError) : null
      const latest = cachedPerformance(identity)
      const message = error instanceof Error ? error.message : 'Portfolio performance is unavailable'
      const permanent = clientError ? PERMANENT_PERFORMANCE_ERRORS.has(clientError.code) : false
      const currentAccountConfirmed = latest !== null
        && clientError?.mappedAccountId === latest.accountId
      const retained = !permanent && currentAccountConfirmed ? latest : null
      if (retained === null) evictPerformanceIdentity(identityKey)
      setState({
        status: retained ? 'ready' : 'unavailable',
        data: retained?.data ?? null,
        refreshing: false,
        refreshError: message,
        errorCode: clientError?.code ?? 'NETWORK_ERROR',
        retryAt,
        canRefresh: !permanent && retryAt === null,
      })
    } finally {
      if (inFlightIdentity.current === identityKey) inFlightIdentity.current = null
    }
  }, [])

  React.useEffect(() => { void load() }, [load])

  React.useEffect(() => {
    if (state.retryAt === null) return
    const delay = state.retryAt - Date.now()
    if (delay <= 0) {
      setState((current) => ({ ...current, retryAt: null, canRefresh: true }))
      return
    }
    const timeout = setTimeout(() => {
      setState((current) => (
        current.retryAt === state.retryAt
          ? { ...current, retryAt: null, canRefresh: true }
          : current
      ))
    }, delay)
    return () => clearTimeout(timeout)
  }, [state.retryAt])

  const refresh = React.useCallback(async () => {
    if (state.retryAt !== null && Date.now() < state.retryAt) return
    if (!state.canRefresh && state.retryAt === null && !state.refreshing) return
    await load()
  }, [load, state.canRefresh, state.refreshing, state.retryAt])

  return { state, refresh }
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
      .then(async (accessToken) => {
        const fetchedTo = new Date()
        const fetchedFrom = new Date(fetchedTo)
        fetchedFrom.setUTCDate(fetchedFrom.getUTCDate() - 30)
        const [overview, historyResult] = await Promise.all([
          fetchPortfolioHubOverview(accessToken),
          fetchPortfolioHubSummaries(accessToken, {
            fetchedFrom: fetchedFrom.toISOString(),
            fetchedTo: fetchedTo.toISOString(),
            limit: 200,
          }).then(
            (page) => ({ history: page.items, error: null }),
            (error: unknown) => ({
              history: [] as HubSummary[],
              error: error instanceof Error ? error.message : 'Historical summaries are unavailable',
            }),
          ),
        ])
        return { overview, historyResult }
      })
      .then(({ overview, historyResult }) => {
        if (!cancelled) setState({ status: 'ready', overview, history: historyResult.history, historyError: historyResult.error })
      })
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
        setError('Your session changed before the account currency was refreshed. Please try again.')
        return
      }
      onSaved()
    } catch (cause) {
      if (mounted.current && request.current === requestId) {
        setError(cause instanceof Error ? cause.message : 'Could not save account currency. Please try again.')
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
