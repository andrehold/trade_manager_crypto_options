// @vitest-environment node
import { afterAll, describe, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import Decimal from 'decimal.js'
import { z } from 'zod'
import { createPortfolioDataHubGateway, handlePortfolioDataHubRequest } from '../server'
import { parseHubAnalyticsSummary, parseHubAnalyticsTransactionPage, type HubAnalyticsSummary, type HubAnalyticsTransaction } from '../analyticsNormalizers'
import { compareAnalyticsInstants, type AnalyticsMetricName } from '../analyticsSchemas'
import { fetchPortfolioHubAnalyticsSummary, fetchPortfolioHubAnalyticsTransactions, validateAnalyticsPair, type AnalyticsTransactionFilters, type AnalyticsWindow } from '../analyticsClient'
import { analyticsDrillFilters, rowMatchesDrill, sameAnalyticsBuild } from '@/features/clientPortal/dashboard/analyticsDrillFilters'

// Explicit opt-in only. Credentials stay in environment/memory; reports contain no IDs,
// amounts, transactions, cursors, tokens, URLs with queries, or authentication bodies.
const enabled = process.env.RUN_PORTFOLIO_ANALYTICS_LIVE_TEST === '1'
const portalLogins = [{ email: 'PORTAL_TEST_AUTHORIZED_EMAIL', password: 'PORTAL_TEST_AUTHORIZED_PASSWORD' }]
if (process.env.RUN_PORTFOLIO_ANALYTICS_DEV_CLIENT === '1' && process.env.VITE_DEV_CLIENT_EMAIL && process.env.VITE_DEV_CLIENT_PASSWORD && process.env.VITE_DEV_CLIENT_EMAIL !== process.env.PORTAL_TEST_AUTHORIZED_EMAIL) portalLogins.push({ email: 'VITE_DEV_CLIENT_EMAIL', password: 'VITE_DEV_CLIENT_PASSWORD' })
const D = Decimal.clone({ precision: 80 })
const metrics: AnalyticsMetricName[] = ['calculated_realized_gross_profit', 'fee_expense', 'rebates', 'net_trading_cost', 'net_funding', 'execution_count', 'executed_quantity', 'premium_turnover', 'notional_turnover']
const report: Record<string, unknown> = { readOnly: true, capturedAt: new Date().toISOString(), scope: 'Direct six-account parser/drill checks plus in-process protected portal handlers with real Supabase authentication/RLS; not deployed browser end-to-end' }
const measurements: { resource: string; ms: number; bytes: number; status: number }[] = []
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
function required(name: string): string { const value = process.env[name]; check(value, `${name} is required`); return value }
const base = () => required('PORTFOLIO_DATA_HUB_BASE_URL').replace(/\/$/, '')
const accountsSchema = z.object({ items: z.array(z.object({ id: z.string().uuid(), label: z.string(), venue: z.string(), enabled: z.boolean() })) })
async function measuredFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input)), start = performance.now()
  let response: Response
  try { response = await fetch(input, { ...init, redirect: 'error', signal: init?.signal ?? AbortSignal.timeout(30000) }) }
  catch { throw new Error('Live acceptance network request failed; request details omitted') }
  const bytes = await response.arrayBuffer()
  const resource = url.pathname.endsWith('/summary') ? 'summary' : url.pathname.endsWith('/transactions') ? 'transactions' : url.pathname.endsWith('/accounts') ? 'accounts' : url.pathname.endsWith('/clients') ? 'mapping' : 'auth'
  measurements.push({ resource, ms: Math.round((performance.now() - start) * 100) / 100, bytes: bytes.byteLength, status: response.status })
  return new Response(bytes, { status: response.status, headers: response.headers })
}
async function rawHub(path: string, params: Record<string, string> = {}) {
  const response = await measuredFetch(`${base()}${path}?${new URLSearchParams(params)}`, { headers: { authorization: `Bearer ${required('PORTFOLIO_DATA_HUB_API_KEY')}` }, cache: 'no-store' })
  check(response.ok, `Live Hub request failed (HTTP ${response.status}); body omitted`)
  return response.json() as Promise<unknown>
}
function wire(filters: AnalyticsTransactionFilters) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), String(value)]))
}
async function reconcile(group: HubAnalyticsSummary['groups'][number], metric: AnalyticsMetricName, window: AnalyticsWindow, summary: HubAnalyticsSummary, fetchPage: (filters: AnalyticsTransactionFilters) => Promise<ReturnType<typeof parseHubAnalyticsTransactionPage>>, continuationLimit = 50) {
  const filters = analyticsDrillFilters({ group, metric, window, filters: {} })
  const rows: HubAnalyticsTransaction[] = [], ids = new Set<string>(), cursors = new Set<string>()
  let cursor: string | null = null, first: ReturnType<typeof parseHubAnalyticsTransactionPage> | null = null, pages = 0
  do {
    check(++pages <= 1000, 'Acceptance page bound exceeded')
    const page = await fetchPage({ ...filters, cursor, limit: pages === 1 ? 50 : continuationLimit })
    check(page.accountId === summary.accountId && (page.venue === null || page.venue === summary.venue), 'Detail response identity mismatch')
    check(page.coverage.requestedStart && page.coverage.requestedEnd && compareAnalyticsInstants(page.coverage.requestedStart, filters.start) === 0 && compareAnalyticsInstants(page.coverage.requestedEnd, filters.end) === 0, 'Detail response window mismatch')
    check(sameAnalyticsBuild(page.coverage, summary.coverage, true), 'Build changed between summary and detail; restart acceptance')
    check(page.coverage.derivedAt !== null && page.coverage.normalizationVersion !== null, 'Live build evidence is missing')
    if (first) check(sameAnalyticsBuild(first.coverage, page.coverage, true), 'Build changed during pagination; restart acceptance')
    else first = page
    for (const row of page.items) {
      check((row.accountId === null || row.accountId === summary.accountId) && (row.venue === null || row.venue === summary.venue), 'Row identity mismatch')
      check(!ids.has(row.id) && rowMatchesDrill(row, filters), 'Duplicate, ineligible or incorrectly scoped row')
      ids.add(row.id); rows.push(row)
    }
    cursor = page.nextCursor
    if (cursor !== null) { check(!cursors.has(cursor), 'Repeated detail cursor'); cursors.add(cursor) }
  } while (cursor !== null)
  const cell = group.metrics[metric]
  const available = rows.filter((row) => row.metrics[metric] !== null)
  const missing = rows.filter((row) => row.metrics[metric] === null || Object.prototype.hasOwnProperty.call(row.missingData, metric))
  check(rows.length === cell.eligibleCount && missing.length === cell.missingCount, 'Summary/detail component counts disagree')
  check((cell.value === null) === (available.length === 0), 'Summary/detail availability disagrees')
  if (cell.value !== null) {
    // Acceptance-only summation, never application-side accounting or a displayed total.
    const sum = available.reduce((value, row) => value.plus(row.metrics[metric]!), new D(0))
    check(sum.minus(cell.value).abs().lte('1e-60'), 'Summary/detail exact values disagree')
  }
  return { metric, firstPageLimit: 50, continuationLimit, pages, rows: rows.length, missing: missing.length, nullPartition: group.dimensions.currency === null || group.dimensions.quantityUnit === null, partial: cell.missingCount > 0, bucket: group.dimensions.day ? 'day' : 'period' }
}

// Always persist only the explicitly selected safe report shape, even on a failed run.
afterAll(() => {
  if (!enabled) return
  const summaries: Record<string, unknown> = {}
  for (const resource of [...new Set(measurements.map((point) => point.resource))]) {
    const points = measurements.filter((point) => point.resource === resource)
    const times = points.map((point) => point.ms).sort((a, b) => a - b)
    summaries[resource] = { requests: points.length, maxBytes: Math.max(...points.map((point) => point.bytes)), maxMs: times[times.length - 1], p95Ms: times[Math.ceil(times.length * .95) - 1], successfulRequests: points.filter((point) => point.status === 200).length }
  }
  report.measurements = summaries
  const path = process.env.PORTFOLIO_ANALYTICS_REPORT_PATH
  if (path) writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
})

describe.skipIf(!enabled)('transaction analytics release live acceptance', () => {
  it('parses all six discovered accounts and reconciles selected period/day/metric scopes through complete 50-row pagination', async () => {
    const accounts = accountsSchema.parse(await rawHub('/api/v1/data/accounts')).items.filter((account) => account.enabled && ['deribit', 'coincall', 'paradex'].includes(account.venue))
    check(accounts.length === 6, 'Enabled supported account inventory differs from six-account release scope')
    const reports: unknown[] = []
    report.accounts = reports
    for (const account of accounts) {
      const prefix = `/api/v1/accounts/${account.id}/analytics/summary`
      const unbounded = parseHubAnalyticsSummary(await rawHub(prefix))
      check(unbounded.coverage.availableStart, 'No observed history available for captured-period acceptance')
      const window = { start: unbounded.coverage.availableStart, end: new Date().toISOString() }
      const totals = parseHubAnalyticsSummary(await rawHub(prefix, window))
      const daily = parseHubAnalyticsSummary(await rawHub(prefix, { ...window, group_by: 'day', metric: 'calculated_realized_gross_profit' }))
      validateAnalyticsPair(totals, daily, window, {})
      check(totals.venue === account.venue && totals.accountId === account.id && totals.coverage.derivedStatus === 'ready', 'Discovered account/build identity mismatch or results not ready')
      const dayAll = parseHubAnalyticsSummary(await rawHub(prefix, { ...window, group_by: 'day' }))
      check(sameAnalyticsBuild(totals.coverage, dayAll.coverage, true), 'Build changed during release validation')
      const samples: unknown[] = []
      const result = { account: account.label, venue: account.venue, status: 'in-progress', historyComplete: totals.coverage.historyComplete, buildEvidence: totals.coverage.derivedAt !== null && totals.coverage.normalizationVersion !== null, nullDenominations: totals.groups.filter((group) => group.dimensions.denomination === null).length, samples, ineligible: [] as string[] }
      reports.push(result)
      const fetchPage = async (filters: AnalyticsTransactionFilters) => parseHubAnalyticsTransactionPage(await rawHub(`/api/v1/accounts/${account.id}/analytics/transactions`, wire(filters)))
      for (const metric of metrics) {
        // Prefer partial/null partitions, then a day near the page boundary to bound read load.
        const candidates = dayAll.groups.filter((group) => group.dimensions.denomination !== null && (group.metrics[metric]?.eligibleCount ?? 0) > 0)
        candidates.sort((a, b) => {
          const priority = (g: typeof a) => Number(g.metrics[metric].missingCount > 0) * 4 + Number(g.dimensions.currency === null || g.dimensions.quantityUnit === null) * 2
          return priority(b) - priority(a) || Math.abs(a.metrics[metric].eligibleCount - 51) - Math.abs(b.metrics[metric].eligibleCount - 51)
        })
        if (candidates.length === 0) { result.ineligible.push(metric); continue }
        samples.push(await reconcile(candidates[0], metric, window, dayAll, fetchPage))
      }
      // Full observed-history reconciliation is covered by the supplied smoke.
      // Also test an actual user-selectable one-day custom period through our parsers.
      const day = daily.groups.filter((group) => group.dimensions.denomination !== null && (group.metrics.calculated_realized_gross_profit?.eligibleCount ?? 0) > 0).sort((a, b) => Math.abs(a.metrics.calculated_realized_gross_profit.eligibleCount - 51) - Math.abs(b.metrics.calculated_realized_gross_profit.eligibleCount - 51))[0]
      check(day, 'No eligible daily profit partition for custom-period acceptance')
      const dayFilters = analyticsDrillFilters({ group: day, metric: 'calculated_realized_gross_profit', window, filters: {} })
      const periodWindow = { start: dayFilters.start, end: dayFilters.end }
      const periodSummary = parseHubAnalyticsSummary(await rawHub(prefix, periodWindow))
      check(sameAnalyticsBuild(totals.coverage, periodSummary.coverage, true), 'Build changed before custom-period validation')
      const period = periodSummary.groups.find((group) => group.dimensions.currency === day.dimensions.currency && group.dimensions.denomination === day.dimensions.denomination && group.dimensions.quantityUnit === day.dimensions.quantityUnit)
      check(period, 'Selected period partition disappeared')
      samples.push(await reconcile(period, 'calculated_realized_gross_profit', periodWindow, periodSummary, fetchPage))
      result.status = 'passed'
      const progressPath = process.env.PORTFOLIO_ANALYTICS_REPORT_PATH
      if (progressPath) writeFileSync(progressPath, `${JSON.stringify(report, null, 2)}\n`)
    }
    report.directStatus = 'passed'
  }, 900000)

  it.each(portalLogins)('uses real portal sign-in, RLS mapping, protected handlers and browser parsers without snapshot prerequisites ($email)', async (credentials) => {
    const email = required(credentials.email), password = required(credentials.password)
    const supabase = (process.env.SUPABASE_URL ?? required('VITE_SUPABASE_URL')).replace(/\/$/, '')
    const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? required('VITE_SUPABASE_PUBLISHABLE_KEY')
    const login = await measuredFetch(`${supabase}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
    check(login.ok, `Portal test sign-in failed (HTTP ${login.status}); response omitted`)
    const auth = await login.json() as { access_token?: unknown }
    check(typeof auth.access_token === 'string', 'Portal sign-in did not return a session')
    const token = auth.access_token
    const gateway = createPortfolioDataHubGateway({ env: process.env, fetch: measuredFetch })
    const context = await gateway.resolveContext(new Request('https://portal-validation.invalid/', { headers: { authorization: `Bearer ${token}` } }))
    const source = await gateway.analyticsSummary(context, new URL('https://portal-validation.invalid/'))
    check(source.coverage.availableStart, 'Mapped portal account has no observed history')
    const window = { start: source.coverage.availableStart, end: new Date().toISOString() }
    const portalFetch: typeof fetch = async (input, init) => {
      const path = String(input)
      check(path.startsWith('/api/portfolio-data-hub/analytics/'), 'Acceptance client requested a non-analytics route')
      const response = await handlePortfolioDataHubRequest(new Request(`https://portal-validation.invalid${path}`, init), path.includes('/transactions?') ? 'analytics-transactions' : 'analytics-summary', { env: process.env, fetch: measuredFetch })
      check(response.headers.get('cache-control') === 'private, no-store', 'Protected handler cache contract changed')
      return response
    }
    const totals = await fetchPortfolioHubAnalyticsSummary(token, window, portalFetch)
    const daily = await fetchPortfolioHubAnalyticsSummary(token, { ...window, groupBy: ['day'], metric: 'calculated_realized_gross_profit' }, portalFetch)
    validateAnalyticsPair(totals, daily, window, {})
    check(totals.accountId === context.hubAccountId, 'Portal mapping identity mismatch')
    const group = daily.groups.find((group) => group.dimensions.denomination !== null && (group.metrics.calculated_realized_gross_profit?.eligibleCount ?? 0) > 0)
    check(group, 'Mapped portal account has no eligible daily gross-profit cell')
    const sample = await reconcile(group, 'calculated_realized_gross_profit', window, daily, (filters) => fetchPortfolioHubAnalyticsTransactions(token, filters, portalFetch))
    const unauthenticated = await handlePortfolioDataHubRequest(new Request('https://portal-validation.invalid/api/portfolio-data-hub/analytics/summary'), 'analytics-summary', { env: process.env, fetch: measuredFetch })
    check(unauthenticated.status === 401, 'Protected analytics accepted missing session')
    const portalAccounts = (report.portalAccounts ??= []) as unknown[]
    portalAccounts.push({ status: 'passed', account: context.hubAccountLabel ?? 'Mapped test client', venue: totals.venue, authenticatedRlsMapping: true, snapshotRequests: 0, sample })
  }, 180000)
})
