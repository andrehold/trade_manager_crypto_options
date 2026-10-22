import React from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabaseClient, hasSupabaseClient } from '@/lib/supabase'
import { PortfolioHubClientError, type HubClientErrorCode } from '@/lib/portfolioDataHub/client'
import {
  analyticsQueryKey, captureAnalyticsPeriod, fetchPortfolioHubAnalyticsSummary, validateAnalyticsPair,
  type AnalyticsFilters, type AnalyticsPair, type AnalyticsPeriodSelection, type AnalyticsWindow,
} from '@/lib/portfolioDataHub/analyticsClient'

export type PortfolioHubAnalyticsState = {
  status: 'disabled' | 'not-configured' | 'loading' | 'ready' | 'pending' | 'unavailable'
  data: AnalyticsPair | null
  refreshing: boolean
  error: string | null
  refreshError: string | null
  errorCode: HubClientErrorCode | null
  retryAt: number | null
  canRetry: boolean
  requestKey: string | null
}
type Identity = { userId: string; clientId: string; accessToken: string }
type Config = { selection: AnalyticsPeriodSelection; window: AnalyticsWindow | null; filters: AnalyticsFilters; error: string | null }
type Entry = { identity: string; accountId: string; query: string; key: string; data: AnalyticsPair }
const CLEAR_DATA_ERRORS = new Set<HubClientErrorCode>([
  'UNAUTHENTICATED', 'CLIENT_NOT_LINKED', 'HUB_ACCOUNT_NOT_CONFIGURED', 'HUB_ACCOUNT_NOT_FOUND',
  'HUB_AUTHORIZATION_FAILED', 'INVALID_RESPONSE', 'HUB_INVALID_RESPONSE',
])

function empty(status: PortfolioHubAnalyticsState['status'], requestKey: string | null = null): PortfolioHubAnalyticsState {
  return { status, data: null, refreshing: false, error: null, refreshError: null, errorCode: null, retryAt: null, canRetry: false, requestKey }
}
function identityFromSession(session: Session | null): Identity {
  if (!session?.user?.id || !session.access_token) throw new PortfolioHubClientError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.')
  const clientId = session.user.app_metadata?.client_id
  if (typeof clientId !== 'string' || !clientId) throw new PortfolioHubClientError('CLIENT_NOT_LINKED', 'Your session is not linked to a portal client.')
  return { userId: session.user.id, clientId, accessToken: session.access_token }
}
const identityKey = (identity: Identity) => JSON.stringify([identity.userId, identity.clientId])
async function readIdentity() {
  const { data, error } = await getSupabaseClient().auth.getSession()
  if (error) throw new PortfolioHubClientError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.')
  return identityFromSession(data.session)
}
function configFor(selection: AnalyticsPeriodSelection, filters: AnalyticsFilters): Config {
  try {
    const window = captureAnalyticsPeriod(selection)
    analyticsQueryKey(window, filters)
    return { selection: { ...selection }, window, filters: { ...filters }, error: null }
  } catch {
    return { selection: { ...selection }, window: null, filters: { ...filters }, error: 'Choose a valid trading period and filters in UTC.' }
  }
}

/** Mounted-only state: initial load, explicit changes and refresh; no focus fetch or polling. */
export function usePortfolioHubAnalytics(options: {
  enabled?: boolean
  accountIdHint?: string
  initialPeriod?: AnalyticsPeriodSelection
} = {}) {
  const enabled = options.enabled ?? true
  const configured = hasSupabaseClient()
  const [config, setConfig] = React.useState<Config>(() => configFor(options.initialPeriod ?? { kind: 'month-to-date' }, {}))
  const query = config.window && config.error === null ? analyticsQueryKey(config.window, config.filters) : null
  const [state, setState] = React.useState<PortfolioHubAnalyticsState>(() => empty(!enabled ? 'disabled' : configured ? 'loading' : 'not-configured', query))
  const [revision, setRevision] = React.useState(0)
  const generation = React.useRef(0)
  const controller = React.useRef<AbortController | null>(null)
  const cache = React.useRef<Entry | null>(null)
  const activeIdentity = React.useRef<string | null>(null)
  const priorHint = React.useRef<string | undefined>(undefined)

  const invalidate = React.useCallback(() => {
    generation.current += 1
    controller.current?.abort()
    cache.current = null
  }, [])

  // An independently observed mapping is an invalidation hint, never authority
  // for routing and never a prerequisite for analytics to load.
  React.useEffect(() => {
    if (options.accountIdHint === undefined || priorHint.current === options.accountIdHint) return
    const changed = priorHint.current !== undefined
    priorHint.current = options.accountIdHint
    if (changed || (cache.current && cache.current.accountId !== options.accountIdHint)) {
      invalidate()
      setState(empty('loading', query))
      setRevision((value) => value + 1)
    }
  }, [options.accountIdHint, invalidate, query])

  React.useEffect(() => {
    if (!configured) return
    const { data } = getSupabaseClient().auth.onAuthStateChange((_event, session) => {
      let next: string | null = null
      try { next = identityKey(identityFromSession(session)) } catch { /* logout or missing client claim */ }
      if (next === activeIdentity.current) return
      invalidate()
      activeIdentity.current = next
      setState(empty(next === null ? 'unavailable' : 'loading', query))
      // No Supabase calls inside the synchronous auth callback.
      setRevision((value) => value + 1)
    })
    return () => data.subscription.unsubscribe()
  }, [configured, invalidate, query])

  React.useEffect(() => {
    const requestGeneration = ++generation.current
    const abort = new AbortController()
    controller.current = abort
    const current = () => generation.current === requestGeneration && !abort.signal.aborted
    if (!enabled || !configured || !config.window || query === null) {
      cache.current = null
      const next = empty(!enabled ? 'disabled' : !configured ? 'not-configured' : 'unavailable', query)
      if (config.error) { next.error = config.error; next.errorCode = 'ANALYTICS_INVALID_QUERY' }
      setState(next)
      return () => { abort.abort(); generation.current += 1 }
    }
    const window = config.window
    const filters = config.filters
    setState((previous) => previous.requestKey === query && previous.data
      ? { ...previous, refreshing: true, error: null, refreshError: null, errorCode: null, retryAt: null, canRetry: false }
      : { ...empty('loading', query), refreshing: true })

    void (async () => {
      let userKey: string | null = null
      try {
        const identity = await readIdentity()
        if (!current()) return
        userKey = identityKey(identity)
        if (activeIdentity.current !== userKey) {
          cache.current = null
          activeIdentity.current = userKey
          setState({ ...empty('loading', query), refreshing: true })
        }
        if (cache.current && (cache.current.identity !== userKey || cache.current.query !== query)) cache.current = null

        const observeAccount = (accountId: string | null) => {
          if (!current() || accountId === null) return
          if (cache.current && cache.current.accountId !== accountId) {
            cache.current = null
            setState({ ...empty('loading', query), refreshing: true })
          }
        }
        for (let attempt = 0; attempt < 2; attempt++) {
          if (!current()) return
          try {
            const requests = [
              fetchPortfolioHubAnalyticsSummary(identity.accessToken, { ...filters, ...window }, undefined, abort.signal),
              fetchPortfolioHubAnalyticsSummary(identity.accessToken, { ...filters, ...window, groupBy: ['day'], metric: 'calculated_realized_gross_profit' }, undefined, abort.signal),
            ].map((promise) => promise.then((summary) => {
              observeAccount(summary.accountId)
              return summary
            }, (error: unknown) => {
              observeAccount(error instanceof PortfolioHubClientError ? error.mappedAccountId : null)
              throw error
            }))
            const results = await Promise.allSettled(requests)
            if (!current()) return
            const failures = results.filter((result) => result.status === 'rejected')
            if (failures.length) {
              const chosen = failures.find((result) => result.reason instanceof PortfolioHubClientError && CLEAR_DATA_ERRORS.has(result.reason.code))
                ?? failures.find((result) => !(result.reason instanceof PortfolioHubClientError)
                || result.reason.code !== 'ANALYTICS_PUBLICATION_CONFLICT') ?? failures[0]
              const error: unknown = chosen.reason
              if (error instanceof PortfolioHubClientError) {
                const account = error.mappedAccountId
                const confirmed = account !== null && results.every((result) => result.status === 'fulfilled'
                  ? result.value.accountId === account
                  : result.reason instanceof PortfolioHubClientError && result.reason.mappedAccountId === account)
                throw new PortfolioHubClientError(error.code, error.message, error.status, error.retryAt, confirmed ? account : null)
              }
              throw error
            }
            const [totals, daily] = results.map((result) => (result as PromiseFulfilledResult<Awaited<typeof requests[number]>>).value)
            let pair: AnalyticsPair
            try { pair = validateAnalyticsPair(totals, daily, window, filters) } catch (error) {
              if (error instanceof PortfolioHubClientError && totals.accountId === daily.accountId) {
                throw new PortfolioHubClientError(error.code, error.message, error.status, error.retryAt, totals.accountId)
              }
              throw error
            }
            const latestIdentity = await readIdentity()
            if (!current()) return
            if (identityKey(latestIdentity) !== userKey) {
              invalidate()
              activeIdentity.current = identityKey(latestIdentity)
              setState(empty('loading', query))
              setRevision((value) => value + 1)
              return
            }
            cache.current = { identity: userKey, accountId: pair.accountId, query, key: JSON.stringify([userKey, pair.accountId, query]), data: pair }
            setState({ ...empty(pair.totals.coverage.derivedStatus === 'pending' ? 'pending' : 'ready', query), data: pair, canRetry: true })
            return
          } catch (error) {
            if (!current()) return
            if (attempt === 0 && error instanceof PortfolioHubClientError && error.code === 'ANALYTICS_PUBLICATION_CONFLICT') continue
            throw error
          }
        }
      } catch (error) {
        if (!current()) return
        let failure = error
        if (userKey !== null) {
          try {
            const latest = await readIdentity()
            if (!current()) return
            if (identityKey(latest) !== userKey) {
              invalidate()
              activeIdentity.current = identityKey(latest)
              setState(empty('loading', query))
              setRevision((value) => value + 1)
              return
            }
          } catch (identityError) { failure = identityError }
        }
        if (!current()) return
        const clientError = failure instanceof PortfolioHubClientError ? failure : null
        const retryAt = clientError?.code === 'HUB_RATE_LIMITED' ? clientError.retryAt : null
        const permanent = clientError !== null && CLEAR_DATA_ERRORS.has(clientError.code)
        const saved = cache.current
        const retained = !permanent && saved?.key === JSON.stringify([userKey, clientError?.mappedAccountId, query]) ? saved : null
        if (!retained) cache.current = null
        const message = clientError?.message ?? 'Trading analytics is unavailable. Please try again.'
        setState({
          ...empty(retained ? (retained.data.totals.coverage.derivedStatus === 'pending' ? 'pending' : 'ready') : 'unavailable', query),
          data: retained?.data ?? null,
          error: retained ? null : message, refreshError: retained ? message : null,
          errorCode: clientError?.code ?? 'NETWORK_ERROR', retryAt,
          canRetry: clientError?.code !== 'UNAUTHENTICATED' && (retryAt === null || retryAt <= Date.now()),
        })
      }
    })()
    return () => { abort.abort(); generation.current += 1 }
  }, [config, configured, enabled, invalidate, query, revision])

  React.useEffect(() => {
    if (state.retryAt === null || state.retryAt <= Date.now()) return
    const timer = setTimeout(() => setState((previous) => previous.retryAt === state.retryAt
      ? { ...previous, retryAt: null, canRetry: true } : previous), state.retryAt - Date.now())
    return () => clearTimeout(timer)
  }, [state.retryAt])

  const setPeriod = React.useCallback((selection: AnalyticsPeriodSelection) => {
    invalidate()
    setState(empty('loading'))
    setConfig(configFor(selection, config.filters))
  }, [config.filters, invalidate])
  const setFilters = React.useCallback((filters: AnalyticsFilters) => {
    invalidate()
    setState(empty('loading'))
    // Filter changes keep the captured period, including its original end.
    try {
      if (!config.window) throw new Error('Invalid period')
      analyticsQueryKey(config.window, filters)
      setConfig({ ...config, filters: { ...filters }, error: null })
    } catch { setConfig({ ...config, filters: { ...filters }, error: 'Choose valid analytics filters.' }) }
  }, [config, invalidate])
  const retry = React.useCallback(() => {
    if (!enabled || state.refreshing || (state.retryAt !== null && state.retryAt > Date.now())) return
    setRevision((value) => value + 1)
  }, [enabled, state.refreshing, state.retryAt])
  const refresh = React.useCallback(() => {
    if (!enabled || state.refreshing || (state.retryAt !== null && state.retryAt > Date.now())) return
    if (config.selection.kind === 'custom') retry()
    else {
      const next = configFor(config.selection, config.filters)
      if (next.window && analyticsQueryKey(next.window, next.filters) === query) retry()
      else {
        invalidate()
        setState(empty('loading'))
        setConfig(next)
      }
    }
  }, [enabled, state.refreshing, state.retryAt, config, query, retry, invalidate])

  const mappingChanged = options.accountIdHint !== undefined && options.accountIdHint !== priorHint.current
    && state.data !== null && state.data.accountId !== options.accountIdHint
  const visibleState = !enabled ? empty('disabled') : state.requestKey !== query || mappingChanged ? empty('loading', query) : state
  return { state: visibleState, period: config.selection, window: config.window, filters: config.filters, setPeriod, setFilters, refresh, retry }
}
