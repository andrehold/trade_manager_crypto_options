import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { handlePortfolioDataHubRequest, type HubDataset } from '../server'
import summaryHandler, { config as summaryConfig } from '../../../../api/portfolio-data-hub/analytics/summary'
import transactionsHandler, { config as transactionsConfig } from '../../../../api/portfolio-data-hub/analytics/transactions'

const root = resolve(process.cwd(), 'docs/integrations/2026-10-21-transaction-analytics')
const load = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const synthetic = (name: string) => load(`synthetic/${name}.json`)
const accountId = synthetic('empty').account_id
const otherId = '00000000-0000-4000-8000-000000000099'
const authId = 'ae19949b-8be9-49d6-b1b2-7e5d8c464a99'
const env = {
  VITE_SUPABASE_URL: 'https://project.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  PORTFOLIO_DATA_HUB_BASE_URL: 'http://127.0.0.1:8000',
  PORTFOLIO_DATA_HUB_API_KEY: 'hub-secret-test',
}
const window = { start: '2026-10-01T00:00:00Z', end: '2026-10-21T12:00:00Z' }
const row = { client_id: '038cd955-e117-4596-aaee-b46360dcf138', client_name: 'Synthetic client', hub_account_id: accountId, reporting_currency: null }
const json = (value: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } })

function request(endpoint = 'summary', filters: Record<string, string> = window, init: RequestInit = {}) {
  return new Request(`https://portal.example/api/portfolio-data-hub/analytics/${endpoint}?${new URLSearchParams(filters)}`, {
    headers: { authorization: 'Bearer client-jwt' }, ...init,
  })
}
function fixture(endpoint: string) { return synthetic(endpoint === 'summary' ? 'costs-funding-activity' : 'partial-transactions-page-1') }
function mockGateway(body: unknown, options: { rows?: readonly unknown[]; authStatus?: number; hubStatus?: number; headers?: HeadersInit; network?: boolean; timeout?: boolean } = {}) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input))
    const headers = new Headers(init?.headers)
    if (url.pathname === '/auth/v1/user') {
      expect(headers.get('apikey')).toBe(env.VITE_SUPABASE_PUBLISHABLE_KEY)
      expect(headers.get('authorization')).toBe('Bearer client-jwt')
      return json({ id: authId }, options.authStatus ?? 200)
    }
    if (url.pathname === '/rest/v1/clients') {
      expect(headers.get('authorization')).toBe('Bearer client-jwt')
      expect(url.searchParams.get('limit')).toBe('2')
      expect(url.searchParams.get('select')).not.toContain('service')
      expect(url.searchParams.has('client_id')).toBe(false)
      return json(options.rows ?? [row])
    }
    expect(headers.get('authorization')).toBe('Bearer hub-secret-test')
    expect(url.pathname).toMatch(new RegExp(`/api/v1/accounts/${options.rows ? (options.rows[0] as typeof row)?.hub_account_id : accountId}/analytics/`))
    expect(init?.cache).toBe('no-store')
    expect(init?.redirect).toBe('error')
    if (options.timeout) throw new DOMException('private failure detail', 'AbortError')
    if (options.network) throw new Error('private failure detail')
    return json(body, options.hubStatus ?? 200, options.headers)
  })
}
const dataset = (endpoint: string) => `analytics-${endpoint}` as HubDataset

describe('protected analytics routes', () => {
  it('exposes only GET edge handlers', async () => {
    expect(summaryConfig.runtime).toBe('edge')
    expect(transactionsConfig.runtime).toBe('edge')
    for (const handler of [summaryHandler, transactionsHandler]) {
      const response = await handler(request('summary', {}, { method: 'POST' }))
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe('GET')
      expect(response.headers.get('cache-control')).toBe('private, no-store')
    }
  })

  it.each(['summary', 'transactions'])('authenticates and resolves the mapped account for %s without requesting snapshots', async (endpoint) => {
    const fetch = mockGateway(fixture(endpoint))
    const response = await handlePortfolioDataHubRequest(request(endpoint), dataset(endpoint), { env, fetch })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(fetch).toHaveBeenCalledTimes(3)
    expect((await response.json()).data.accountId).toBe(accountId)
    expect(String(fetch.mock.calls[2][0])).toContain(`/accounts/${accountId}/analytics/${endpoint}`)
  })

  it('does not filter analytics to the reporting currency or require it to be selected', async () => {
    for (const currency of [null, 'BTC']) {
      const fetch = mockGateway(fixture('summary'), { rows: [{ ...row, reporting_currency: currency }] })
      expect((await handlePortfolioDataHubRequest(request(), 'analytics-summary', { env, fetch })).status).toBe(200)
      expect(new URL(String(fetch.mock.calls[2][0])).searchParams.has('currency')).toBe(false)
    }
  })

  it.each(['summary', 'transactions'])('rejects unauthenticated %s without any upstream call', async (endpoint) => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const response = await handlePortfolioDataHubRequest(new Request(`https://portal.example/analytics/${endpoint}`), dataset(endpoint), { env, fetch })
    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHENTICATED')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid session', { authStatus: 401 }, 401, 1],
    ['unlinked client', { rows: [] }, 403, 2],
    ['ambiguous mapping', { rows: [row, row] }, 403, 2],
    ['unconfigured account', { rows: [{ ...row, hub_account_id: null }] }, 409, 2],
  ] as const)('blocks %s before a Hub request', async (_name, options, status, count) => {
    const fetch = mockGateway(fixture('summary'), options)
    const response = await handlePortfolioDataHubRequest(request(), 'analytics-summary', { env, fetch })
    expect(response.status).toBe(status)
    expect(fetch).toHaveBeenCalledTimes(count)
  })

  it('rejects account selection, unsupported and duplicate inputs before forwarding', async () => {
    for (const query of ['account_id=other', 'hub_account_id=other', 'client_id=other', 'currency=USD&currency=USDC', 'metric=typo', 'currency=USD&currency_is_null=true', 'start=2026-10-01T00:00:00']) {
      const fetch = mockGateway(fixture('summary'))
      const req = new Request(`https://portal.example/analytics/summary?${query}`, { headers: { authorization: 'Bearer client-jwt' } })
      const response = await handlePortfolioDataHubRequest(req, 'analytics-summary', { env, fetch })
      expect(response.status).toBe(400)
      expect((await response.json()).error.code).toBe('ANALYTICS_INVALID_QUERY')
      expect(fetch).toHaveBeenCalledTimes(2)
    }
  })

  it('forwards exact null filters, grouping, category and metric without snapshot requests', async () => {
    const raw = synthetic('multiple-partitions')
    raw.group_by = ['day', 'month', 'instrument', 'category', 'currency']
    const filters = { ...window, group_by: 'day,month,instrument,category,currency', metric: 'calculated_realized_gross_profit', category: 'delivery', instrument_is_null: 'true', currency_is_null: 'true', quantity_unit_is_null: 'true', denomination: 'unknown' }
    const fetch = mockGateway(raw)
    const response = await handlePortfolioDataHubRequest(request('summary', filters), 'analytics-summary', { env, fetch })
    expect(response.status).toBe(200)
    expect(Object.fromEntries(new URL(String(fetch.mock.calls[2][0])).searchParams)).toEqual(filters)
    const data = (await response.json()).data
    expect(data.groups).toHaveLength(5)
    expect(data.groups[4].dimensions.quantityUnit).toBeNull()
  })

  it('preserves opaque cursors, exact units and boundary limits and defaults to 50', async () => {
    for (const limit of [undefined, '1', '200']) {
      const filters: Record<string, string> = { ...window, cursor: ' opaque+/=:?&', currency: 'USDT', denomination: 'USDT', quantity_unit: 'BTC_face_value', metric: 'calculated_realized_gross_profit', instrument_is_null: 'false' }
      if (limit) filters.limit = limit
      const fetch = mockGateway(fixture('transactions'))
      const response = await handlePortfolioDataHubRequest(request('transactions', filters), 'analytics-transactions', { env, fetch })
      expect(response.status).toBe(200)
      const search = new URL(String(fetch.mock.calls[2][0])).searchParams
      expect(Object.fromEntries(search)).toEqual({ ...filters, limit: limit ?? '50' })
      expect((await response.json()).data.nextCursor).toBe('synthetic-opaque-next-page')
    }
  })

  it('resolves each request against its current RLS mapping rather than caching the first account', async () => {
    for (const id of [accountId, otherId]) {
      const raw = fixture('summary'); raw.account_id = id
      const fetch = mockGateway(raw, { rows: [{ ...row, hub_account_id: id }] })
      const response = await handlePortfolioDataHubRequest(request(), 'analytics-summary', { env, fetch })
      expect(response.status).toBe(200)
      expect((await response.json()).data.accountId).toBe(id)
    }
  })

  it.each(['summary', 'transactions'])('rejects wrong envelope account on %s', async (endpoint) => {
    const raw = fixture(endpoint); raw.account_id = otherId
    const response = await handlePortfolioDataHubRequest(request(endpoint), dataset(endpoint), { env, fetch: mockGateway(raw) })
    expect(response.status).toBe(502)
    expect((await response.json()).error.code).toBe('HUB_INVALID_RESPONSE')
  })

  it.each(['account', 'venue', 'missing envelope venue'])('rejects mixed detail %s identity', async (kind) => {
    const raw = fixture('transactions')
    if (kind === 'account') raw.items[0].account_id = otherId
    else if (kind === 'venue') raw.items[0].venue = 'deribit'
    else { delete raw.venue; raw.items.push({ ...raw.items[0], id: otherId, venue: 'deribit' }) }
    const response = await handlePortfolioDataHubRequest(request('transactions'), 'analytics-transactions', { env, fetch: mockGateway(raw) })
    expect(response.status).toBe(502)
    expect((await response.json()).error.code).toBe('HUB_INVALID_RESPONSE')
  })

  it('accepts explicitly absent row identity when the envelope is mapped', async () => {
    const raw = fixture('transactions'); raw.items[0].account_id = null; raw.items[0].venue = null
    const response = await handlePortfolioDataHubRequest(request('transactions'), 'analytics-transactions', { env, fetch: mockGateway(raw) })
    expect(response.status).toBe(200)
  })

  it.each(['start', 'end', 'grouping', 'numeric amount', 'spoofed normalized identity'])('rejects unsupported response %s', async (kind) => {
    const raw = fixture('summary')
    if (kind === 'start') raw.coverage.requested_start = null
    else if (kind === 'end') raw.coverage.requested_end = '2026-10-22T00:00:00Z'
    else if (kind === 'grouping') raw.group_by = ['day']
    else if (kind === 'numeric amount') raw.groups[0].metrics.execution_count.value = 2
    else { raw.account_id = otherId; raw.accountId = accountId }
    const response = await handlePortfolioDataHubRequest(request(), 'analytics-summary', { env, fetch: mockGateway(raw) })
    expect(response.status).toBe(502)
    expect((await response.json()).error.code).toBe('HUB_INVALID_RESPONSE')
  })

  it('accepts the same requested instant returned in UTC and preserves long decimals', async () => {
    const filters = { start: '2026-10-01T02:00:00+02:00', end: window.end }
    const response = await handlePortfolioDataHubRequest(request('summary', filters), 'analytics-summary', { env, fetch: mockGateway(fixture('summary')) })
    expect(response.status).toBe(200)
    expect((await response.json()).data.groups[0].metrics.executed_quantity.value).toBe('0.020000000000000001')
  })

  it('accepts open bounds without inventing a period and tolerates unrelated additive fields', async () => {
    const raw = fixture('summary')
    raw.coverage.requested_start = null
    raw.coverage.requested_end = null
    raw.items = 'a future additive summary field'
    const response = await handlePortfolioDataHubRequest(request('summary', {}), 'analytics-summary', { env, fetch: mockGateway(raw) })
    expect(response.status).toBe(200)
    expect((await response.json()).data.coverage.requestedStart).toBeNull()
  })

  it('rejects a malformed success response without returning its body', async () => {
    const response = await handlePortfolioDataHubRequest(request(), 'analytics-summary', { env, fetch: mockGateway('private unsupported response') })
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('private unsupported response')
  })

  it.each([
    [400, 'ANALYTICS_INVALID_QUERY', 400], [401, 'HUB_AUTHORIZATION_FAILED', 401],
    [403, 'HUB_AUTHORIZATION_FAILED', 403], [404, 'HUB_ACCOUNT_NOT_FOUND', 404],
    [409, 'ANALYTICS_PUBLICATION_CONFLICT', 409], [422, 'ANALYTICS_INVALID_QUERY', 422],
    [429, 'HUB_RATE_LIMITED', 429], [408, 'UPSTREAM_TIMEOUT', 504], [504, 'UPSTREAM_TIMEOUT', 504],
    [500, 'HUB_UNAVAILABLE', 502], [502, 'HUB_UNAVAILABLE', 502], [503, 'HUB_UNAVAILABLE', 503],
  ] as const)('maps upstream %s to safe %s with status %s', async (status, code, expectedStatus) => {
    for (const endpoint of ['summary', 'transactions']) {
      const fetch = mockGateway({ detail: 'private upstream body hub-secret-test' }, { hubStatus: status, headers: { 'retry-after': '30' } })
      const response = await handlePortfolioDataHubRequest(request(endpoint), dataset(endpoint), { env, fetch })
      expect(response.status).toBe(expectedStatus)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      const text = await response.text()
      expect(JSON.parse(text).error.code).toBe(code)
      expect(text).not.toContain('private upstream')
      expect(text).not.toContain('hub-secret-test')
      expect(fetch).toHaveBeenCalledTimes(3)
      expect(response.headers.get('retry-after')).toBe(status === 429 ? '30' : null)
    }
  })

  it.each(['Invalid pagination cursor.', 'Invalid pagination cursor or changed filters.'])('distinguishes recognized cursor error %s from a generic 400', async (detail) => {
    const response = await handlePortfolioDataHubRequest(request('transactions', { ...window, cursor: 'opaque' }), 'analytics-transactions', { env, fetch: mockGateway({ detail }, { hubStatus: 400 }) })
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('ANALYTICS_INVALID_CURSOR')
  })

  it('never classifies a generic 400 with cursor, or cursor text on an initial request, as a cursor retry', async () => {
    for (const [filters, detail] of [[{ ...window, cursor: 'opaque' }, 'Invalid other filter'], [window, 'Invalid pagination cursor.']] as const) {
      const response = await handlePortfolioDataHubRequest(request('transactions', filters), 'analytics-transactions', { env, fetch: mockGateway({ detail }, { hubStatus: 400 }) })
      expect((await response.json()).error.code).toBe('ANALYTICS_INVALID_QUERY')
    }
  })

  it('drops unsafe Retry-After values', async () => {
    const response = await handlePortfolioDataHubRequest(request(), 'analytics-summary', { env, fetch: mockGateway({}, { hubStatus: 429, headers: { 'retry-after': 'private-invalid' } }) })
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBeNull()
  })

  it.each(['network', 'timeout'] as const)('maps %s failures without leaking diagnostics', async (kind) => {
    const response = await handlePortfolioDataHubRequest(request(), 'analytics-summary', { env, fetch: mockGateway({}, { [kind]: true }) })
    expect(response.status).toBe(kind === 'timeout' ? 504 : 502)
    const text = await response.text()
    expect(text).not.toContain('private failure detail')
    expect(JSON.parse(text).error.code).toBe(kind === 'timeout' ? 'UPSTREAM_TIMEOUT' : 'HUB_UNAVAILABLE')
  })
})
