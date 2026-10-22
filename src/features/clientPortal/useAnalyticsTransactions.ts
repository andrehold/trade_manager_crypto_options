import React from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabaseClient, hasSupabaseClient } from '@/lib/supabase'
import { PortfolioHubClientError } from '@/lib/portfolioDataHub/client'
import { compareAnalyticsInstants, type HubAnalyticsTransactionPage, type HubAnalyticsTransaction } from '@/lib/portfolioDataHub'
import { fetchPortfolioHubAnalyticsTransactions, type AnalyticsPair } from '@/lib/portfolioDataHub/analyticsClient'
import type { AnalyticsResultSelection } from './components/analytics/analyticsPresentation'
import { analyticsDrillFilters, rowMatchesDrill, sameAnalyticsBuild } from './dashboard/analyticsDrillFilters'

type Sequence = { rows: HubAnalyticsTransaction[]; page: HubAnalyticsTransactionPage; cursors: Set<string> }
type State = {
  status: 'loading' | 'ready' | 'restarting' | 'awaiting-summary' | 'error'
  sequence: Sequence | null
  previous: boolean
  error: string | null
  retryAt: number | null
  blocked: boolean
}
const blank = (status: State['status'] = 'loading'): State => ({ status, sequence: null, previous: false, error: null, retryAt: null, blocked: false })
const privateErrors = new Set(['UNAUTHENTICATED', 'CLIENT_NOT_LINKED', 'FORBIDDEN', 'HUB_AUTHORIZATION_FAILED', 'HUB_ACCOUNT_NOT_FOUND', 'HUB_ACCOUNT_NOT_CONFIGURED', 'INVALID_RESPONSE', 'HUB_INVALID_RESPONSE'])
function identity(session: Session | null) {
  const client = session?.user.app_metadata?.client_id
  if (!session?.access_token || !session.user.id || typeof client !== 'string' || !client) {
    throw new PortfolioHubClientError('UNAUTHENTICATED', 'Your account context changed. Close these details and sign in again.')
  }
  return { key: JSON.stringify([session.user.id, client]), token: session.access_token }
}
async function readIdentity() {
  const { data, error } = await getSupabaseClient().auth.getSession()
  if (error) throw new PortfolioHubClientError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.')
  return identity(data.session)
}

/** On-demand only. Cursor recovery waits for a fresh summary before restarting page one. */
export function useAnalyticsTransactions(selection: AnalyticsResultSelection, pair: AnalyticsPair, refreshSummary: () => void) {
  const scope = React.useMemo(() => {
    try { return { filters: analyticsDrillFilters(selection), error: null } }
    catch (error) { return { filters: null, error: error instanceof Error ? error.message : 'Cannot scope these transaction details.' } }
  }, [selection])
  const key = JSON.stringify([pair.accountId, scope.filters])
  const [state, setState] = React.useState<State>(() => blank())
  const [revision, setRevision] = React.useState(0)
  const stateRef = React.useRef(state)
  const sequence = React.useRef<Sequence | null>(null)
  const completed = React.useRef<Sequence | null>(null)
  const activeIdentity = React.useRef<string | null>(null)
  const blocked = React.useRef(false)
  const generation = React.useRef(0)
  const abort = React.useRef<AbortController | null>(null)
  const busy = React.useRef(false)
  const restartCount = React.useRef(0)
  const summaryRef = React.useRef(pair)
  const waitingPair = React.useRef<AnalyticsPair | null>(null)
  const contextKey = React.useRef<string | null>(null)
  const refreshRef = React.useRef(refreshSummary)
  refreshRef.current = refreshSummary
  stateRef.current = state

  const publish = React.useCallback((next: State) => { stateRef.current = next; setState(next) }, [])
  const invalidate = React.useCallback(() => {
    generation.current++
    abort.current?.abort()
    busy.current = false
  }, [])

  const load = React.useCallback(async (first: boolean) => {
    if (busy.current || blocked.current || !scope.filters) return
    busy.current = true
    const requestGeneration = ++generation.current
    const controller = new AbortController()
    abort.current = controller
    const current = () => requestGeneration === generation.current && !controller.signal.aborted
    const prior = first ? null : sequence.current
    let requestIdentity: string | null = null
    publish({ ...blank(first && restartCount.current ? 'restarting' : 'loading'), sequence: prior ?? completed.current, previous: !prior && completed.current !== null })
    try {
      const user = await readIdentity()
      if (!current()) return
      if (activeIdentity.current !== null && activeIdentity.current !== user.key) throw new PortfolioHubClientError('UNAUTHENTICATED', 'Your account context changed. Close and reopen transaction details.')
      activeIdentity.current = user.key
      requestIdentity = user.key
      const cursor = prior?.page.nextCursor ?? null
      const page = await fetchPortfolioHubAnalyticsTransactions(user.token, { ...scope.filters, cursor }, undefined, controller.signal)
      if (!current()) return
      const latestUser = await readIdentity()
      if (!current()) return
      if (latestUser.key !== user.key) throw new PortfolioHubClientError('UNAUTHENTICATED', 'Your account context changed. Close and reopen transaction details.')
      const anchor = summaryRef.current
      const invalid = () => new PortfolioHubClientError('INVALID_RESPONSE', 'Transaction details did not match the requested account, period, filters or row identities.')
      if (page.accountId !== anchor.accountId || (anchor.totals.venue !== null && page.venue !== null && page.venue !== anchor.totals.venue)) throw invalid()
      if (prior && page.venue !== prior.page.venue) throw invalid()
      if (page.coverage.requestedStart === null || page.coverage.requestedEnd === null
        || compareAnalyticsInstants(page.coverage.requestedStart, scope.filters.start) !== 0
        || compareAnalyticsInstants(page.coverage.requestedEnd, scope.filters.end) !== 0) throw invalid()
      const ids = new Set(prior?.rows.map((row) => row.id))
      for (const row of page.items) {
        if ((row.accountId !== null && row.accountId !== page.accountId)
          || (row.venue !== null && ((page.venue !== null && row.venue !== page.venue) || (anchor.totals.venue !== null && row.venue !== anchor.totals.venue)))
          || ids.has(row.id) || !rowMatchesDrill(row, scope.filters)) throw invalid()
        ids.add(row.id)
      }
      const cursors = new Set(prior?.cursors)
      if (cursor !== null) cursors.add(cursor)
      if (page.nextCursor !== null && cursors.has(page.nextCursor)) throw invalid()
      if (!sameAnalyticsBuild(page.coverage, anchor.totals.coverage)
        || (prior && !sameAnalyticsBuild(page.coverage, prior.page.coverage, true))) {
        throw new PortfolioHubClientError('ANALYTICS_PUBLICATION_CONFLICT', 'The transaction build changed. Refreshing the selected summary and restarting details.', 409, null, page.accountId)
      }
      const next = { rows: [...(prior?.rows ?? []), ...page.items], page, cursors }
      sequence.current = next
      if (page.nextCursor === null) completed.current = next
      publish({ ...blank('ready'), sequence: next })
    } catch (error) {
      if (!current()) return
      let failure = error instanceof PortfolioHubClientError ? error : new PortfolioHubClientError('NETWORK_ERROR', 'Transaction details are unavailable. Please try again.')
      if (requestIdentity !== null) {
        try {
          const latestUser = await readIdentity()
          if (latestUser.key !== requestIdentity) failure = new PortfolioHubClientError('UNAUTHENTICATED', 'Your account context changed. Close and reopen transaction details.')
        } catch (identityError) {
          failure = identityError instanceof PortfolioHubClientError ? identityError : new PortfolioHubClientError('UNAUTHENTICATED', 'Your session could not be verified. Please sign in again.')
        }
      }
      if (!current()) return
      if (failure.mappedAccountId !== null && failure.mappedAccountId !== summaryRef.current.accountId) {
        blocked.current = true
        sequence.current = completed.current = null
        publish({ ...blank('error'), blocked: true, error: 'The mapped account changed. Close these details and refresh trading results.' })
      } else if (failure.code === 'ANALYTICS_INVALID_CURSOR' || failure.code === 'ANALYTICS_PUBLICATION_CONFLICT') {
        // Never retain a partial sequence through a rebuild, including when recovery fails.
        sequence.current = null
        const saved = completed.current
        if (restartCount.current++ === 0) {
          waitingPair.current = summaryRef.current
          publish({ ...blank('awaiting-summary'), sequence: saved, previous: saved !== null })
          refreshRef.current()
        } else {
          publish({ ...blank('error'), sequence: saved, previous: saved !== null, error: 'Transaction results changed again. Retry to start a new sequence; no pages from different builds were combined.' })
        }
      } else {
        const clear = privateErrors.has(failure.code)
        if (clear) { sequence.current = completed.current = null; blocked.current = true }
        // Retention requires positive account evidence on errors, as on summary refresh.
        const retained = !clear && failure.mappedAccountId === summaryRef.current.accountId ? sequence.current ?? completed.current : null
        if (!retained) sequence.current = completed.current = null
        publish({ ...blank('error'), sequence: retained, previous: retained !== null && retained === completed.current,
          error: failure.message, retryAt: failure.retryAt, blocked: blocked.current })
      }
    } finally { if (current()) busy.current = false }
  }, [scope, publish])

  React.useEffect(() => {
    invalidate()
    if (contextKey.current !== key) {
      completed.current = null
      activeIdentity.current = null
    }
    contextKey.current = key
    sequence.current = null
    waitingPair.current = null
    blocked.current = false
    restartCount.current = 0
    summaryRef.current = pair
    if (scope.error || !hasSupabaseClient()) {
      blocked.current = true
      publish({ ...blank('error'), blocked: true, error: scope.error ?? 'Transaction details require a configured, signed-in portal session.' })
      return
    }
    void load(true)
    return invalidate
    // A summary replacement is handled separately without resetting the recovery budget.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, revision, load, invalidate, publish])

  React.useEffect(() => {
    if (!hasSupabaseClient()) return
    const { data } = getSupabaseClient().auth.onAuthStateChange((_event, session) => {
      let next: string | null = null
      try { next = identity(session).key } catch { /* logout */ }
      if (next !== null && (activeIdentity.current === null || next === activeIdentity.current)) return
      invalidate()
      blocked.current = true
      sequence.current = completed.current = null
      publish({ ...blank('error'), blocked: true, error: 'Your account context changed. Close and reopen transaction details.' })
    })
    return () => data.subscription.unsubscribe()
  }, [invalidate, publish])

  React.useEffect(() => {
    if (pair === summaryRef.current || blocked.current) return
    const previous = summaryRef.current
    summaryRef.current = pair
    if (waitingPair.current !== null || !sameAnalyticsBuild(previous.totals.coverage, pair.totals.coverage, true)) {
      invalidate()
      sequence.current = null
      if (waitingPair.current === null && restartCount.current++ > 0) {
        publish({ ...blank('error'), error: 'The summary changed again. Retry transaction details to start a new sequence.' })
        return
      }
      waitingPair.current = null
      void load(true)
    }
  }, [pair, invalidate, load, publish])

  React.useEffect(() => {
    if (state.retryAt === null || state.retryAt <= Date.now()) return
    const timer = setTimeout(() => publish({ ...stateRef.current, retryAt: null }), state.retryAt - Date.now())
    return () => clearTimeout(timer)
  }, [state.retryAt, publish])

  const retry = () => { if (!blocked.current && !busy.current && (stateRef.current.retryAt === null || stateRef.current.retryAt <= Date.now())) setRevision((value) => value + 1) }
  return { ...(contextKey.current === key ? state : blank()), filters: scope.filters, loadMore: () => {
    if (stateRef.current.status === 'ready' && sequence.current?.page.nextCursor != null) void load(false)
  }, retry }
}
