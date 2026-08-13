import { describe, expect, it, vi } from 'vitest'
import summaryFixture from '../__fixtures__/deribit/summary-latest.json'
import positionsFixture from '../__fixtures__/deribit/positions-latest.json'
import ledgerFixture from '../__fixtures__/deribit/ledger-events.json'
import {
  compareDatasetAlignment,
  handlePortfolioDataHubRequest,
} from '../server'
import { parseHubLatestPositionPage, parseHubSummary } from '../normalizers'

const clientId = '038cd955-e117-4596-aaee-b46360dcf138'
const hubAccountId = summaryFixture.account_id
const authUserId = 'ae19949b-8be9-49d6-b1b2-7e5d8c464a99'

const env = {
  VITE_SUPABASE_URL: 'https://project.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  PORTFOLIO_DATA_HUB_BASE_URL: 'http://127.0.0.1:8000',
  PORTFOLIO_DATA_HUB_API_KEY: 'hub-secret-test',
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    client_id: clientId,
    client_name: 'DWF',
    hub_account_id: hubAccountId,
    hub_account_label: 'DWF',
    reporting_currency: null,
    ...overrides,
  }
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://portal.example${path}`, {
    method: 'GET',
    headers: { authorization: 'Bearer client-jwt', ...init.headers },
    ...init,
  })
}

function gatewayFetch(hubBody: unknown, row = profile()) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/auth/v1/user')) {
      expect(new Headers(init?.headers).get('apikey')).toBe('sb_publishable_test')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer client-jwt')
      return response({ id: authUserId })
    }
    if (url.includes('/rest/v1/clients?')) {
      expect(url).toContain('limit=2')
      return response([row])
    }
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer hub-secret-test')
    return response(hubBody)
  })
}

describe('Portfolio Data Hub server boundary', () => {
  it('rejects requests without a Supabase bearer token before any upstream call', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const result = await handlePortfolioDataHubRequest(
      new Request('https://portal.example/api/portfolio-data-hub/summary'),
      'summary',
      { env, fetch: fetchMock },
    )
    expect(result.status).toBe(401)
    expect(await result.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects non-GET methods', async () => {
    const result = await handlePortfolioDataHubRequest(
      new Request('https://portal.example/api/portfolio-data-hub/summary', { method: 'POST' }),
      'summary',
      { env, fetch: vi.fn() },
    )
    expect(result.status).toBe(405)
    expect(result.headers.get('allow')).toBe('GET')
  })

  it('returns a normalized summary only after auth and the RLS-scoped mapping lookup', async () => {
    const fetchMock = gatewayFetch(summaryFixture)
    const result = await handlePortfolioDataHubRequest(
      request('/api/portfolio-data-hub/summary'),
      'summary',
      { env, fetch: fetchMock },
    )
    expect(result.status).toBe(200)
    expect(result.headers.get('cache-control')).toBe('private, no-store')
    expect(await result.json()).toMatchObject({
      data: {
        accountId: hubAccountId,
        runId: summaryFixture.run_id,
        fetchedAt: summaryFixture.fetched_at,
        quality: summaryFixture.completeness,
      },
    })
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      'https://project.supabase.co/auth/v1/user',
      expect.stringContaining('https://project.supabase.co/rest/v1/clients?'),
      `http://127.0.0.1:8000/api/v1/accounts/${hubAccountId}/summaries/latest`,
    ])
  })

  it('returns a clear unmapped state without calling the Hub', async () => {
    const fetchMock = gatewayFetch({}, profile({ hub_account_id: null }))
    const result = await handlePortfolioDataHubRequest(
      request('/api/portfolio-data-hub/summary'),
      'summary',
      { env, fetch: fetchMock },
    )
    expect(result.status).toBe(409)
    expect(await result.json()).toMatchObject({ error: { code: 'HUB_ACCOUNT_NOT_CONFIGURED' } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('defaults ledger pagination to 50 and forwards only supported filters', async () => {
    const fetchMock = gatewayFetch(ledgerFixture)
    const result = await handlePortfolioDataHubRequest(
      request('/api/portfolio-data-hub/ledger?currency=USDC&event_type=trade&ignored=secret'),
      'ledger',
      { env, fetch: fetchMock },
    )
    expect(result.status).toBe(200)
    const hubUrl = String(fetchMock.mock.calls[2]?.[0])
    expect(hubUrl).toContain('/ledger-events?')
    expect(hubUrl).toContain('limit=50')
    expect(hubUrl).toContain('currency=USDC')
    expect(hubUrl).toContain('event_type=trade')
    expect(hubUrl).not.toContain('ignored')
    const body = await result.json()
    expect(body.data.items[0]).toMatchObject({ accountId: hubAccountId })
  })

  it('rejects invalid pagination before calling the Hub', async () => {
    const fetchMock = gatewayFetch(positionsFixture)
    const result = await handlePortfolioDataHubRequest(
      request('/api/portfolio-data-hub/positions?limit=500'),
      'positions',
      { env, fetch: fetchMock },
    )
    expect(result.status).toBe(400)
    expect(await result.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('pins later position pages to the immutable snapshot and rejects a latest snapshot switch', async () => {
    const firstPage = structuredClone(positionsFixture)
    ;(firstPage as any).next_cursor = 'page-two'
    const laterPage = structuredClone(positionsFixture)
    laterPage.snapshot.id = '22222222-2222-4222-8222-222222222222'
    laterPage.items = laterPage.items.map((item) => ({ ...item, snapshot_id: laterPage.snapshot.id }))
    ;(laterPage as any).next_cursor = null
    const fetchMock = gatewayFetch(firstPage)
    let hubCalls = 0
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/auth/v1/user')) return response({ id: authUserId })
      if (url.includes('/rest/v1/clients?')) return response([profile()])
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer hub-secret-test')
      hubCalls += 1
      return response(hubCalls === 1 ? firstPage : laterPage)
    })
    const initial = await handlePortfolioDataHubRequest(request('/api/portfolio-data-hub/positions?limit=200'), 'positions', { env, fetch: fetchMock })
    const initialBody = await initial.json()
    expect(initialBody.data.snapshot.id).toBe(positionsFixture.snapshot.id)
    const second = await handlePortfolioDataHubRequest(
      request(`/api/portfolio-data-hub/positions?page_token=${initialBody.data.pageToken}&cursor=page-two&limit=200`),
      'positions', { env, fetch: fetchMock },
    )
    expect(second.status).toBe(502)
    expect(String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1]?.[0])).toContain(`/api/v1/accounts/${hubAccountId}/positions/latest?limit=200&cursor=page-two`)
  })

  it('accepts a later page only when latest remains the signed snapshot', async () => {
    const firstPage = structuredClone(positionsFixture)
    ;(firstPage as any).next_cursor = 'page-two'
    const laterPage = structuredClone(positionsFixture)
    laterPage.items = [{ ...laterPage.items[0], id: '22222222-2222-4222-8222-222222222223' }]
    ;(laterPage as any).next_cursor = null
    const fetchMock = gatewayFetch(firstPage)
    let hubCalls = 0
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/auth/v1/user')) return response({ id: authUserId })
      if (url.includes('/rest/v1/clients?')) return response([profile()])
      hubCalls += 1
      return response(hubCalls === 1 ? firstPage : laterPage)
    })
    const initial = await handlePortfolioDataHubRequest(request('/api/portfolio-data-hub/positions?limit=200'), 'positions', { env, fetch: fetchMock })
    const { data } = await initial.json()
    const second = await handlePortfolioDataHubRequest(request(`/api/portfolio-data-hub/positions?page_token=${data.pageToken}&cursor=page-two&limit=200`), 'positions', { env, fetch: fetchMock })
    expect(second.status).toBe(200)
    expect(String(fetchMock.mock.calls[fetchMock.mock.calls.length - 1]?.[0])).toContain(`/api/v1/accounts/${hubAccountId}/positions/latest?limit=200&cursor=page-two`)
  })

  it('rejects a cursor without a server-issued page token', async () => {
    const fetchMock = gatewayFetch(positionsFixture)
    const result = await handlePortfolioDataHubRequest(request('/api/portfolio-data-hub/positions?cursor=page-two'), 'positions', { env, fetch: fetchMock })
    expect(result.status).toBe(400)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects a later position page containing a row from another account', async () => {
    const mismatchedPage = {
      canonical_schema_version: '1.0',
      items: [{ ...positionsFixture.items[0], account_id: '11111111-1111-4111-8111-111111111111' }],
      next_cursor: null,
    }
    const initial = await handlePortfolioDataHubRequest(request('/api/portfolio-data-hub/positions'), 'positions', { env, fetch: gatewayFetch(positionsFixture) })
    const { data } = await initial.json()
    const result = await handlePortfolioDataHubRequest(request(`/api/portfolio-data-hub/positions?page_token=${data.pageToken}&cursor=page-two`), 'positions', { env, fetch: gatewayFetch(mismatchedPage) })
    expect(result.status).toBe(502)
    expect(await result.json()).toMatchObject({ error: { code: 'HUB_INVALID_RESPONSE' } })
  })

  it('rejects a pinned page whose rows name a different snapshot', async () => {
    const initial = await handlePortfolioDataHubRequest(request('/api/portfolio-data-hub/positions'), 'positions', { env, fetch: gatewayFetch(positionsFixture) })
    const { data } = await initial.json()
    const wrongSnapshotPage = {
      canonical_schema_version: '1.0',
      items: [{ ...positionsFixture.items[0], snapshot_id: '22222222-2222-4222-8222-222222222222' }],
      next_cursor: null,
    }
    const result = await handlePortfolioDataHubRequest(
      request(`/api/portfolio-data-hub/positions?page_token=${data.pageToken}&cursor=page-two`),
      'positions', { env, fetch: gatewayFetch(wrongSnapshotPage) },
    )
    expect(result.status).toBe(502)
    expect(await result.json()).toMatchObject({ error: { code: 'HUB_INVALID_RESPONSE' } })
  })

  it('rejects raw or tampered snapshot page lookups before calling the Hub', async () => {
    const fetchMock = gatewayFetch(positionsFixture)
    const raw = await handlePortfolioDataHubRequest(request(`/api/portfolio-data-hub/positions?snapshot_id=${positionsFixture.snapshot.id}`), 'positions', { env, fetch: fetchMock })
    expect(raw.status).toBe(400)
    const initial = await handlePortfolioDataHubRequest(request('/api/portfolio-data-hub/positions'), 'positions', { env, fetch: fetchMock })
    const { data } = await initial.json()
    const tampered = `${data.pageToken.slice(0, -1)}x`
    const forged = await handlePortfolioDataHubRequest(request(`/api/portfolio-data-hub/positions?page_token=${tampered}`), 'positions', { env, fetch: fetchMock })
    expect(forged.status).toBe(400)
  })

  it('rejects a valid token issued for a different mapped Hub account', async () => {
    const otherAccountId = '11111111-1111-4111-8111-111111111111'
    const otherSnapshot = structuredClone(positionsFixture)
    otherSnapshot.snapshot.account_id = otherAccountId
    otherSnapshot.items = otherSnapshot.items.map((item) => ({ ...item, account_id: otherAccountId }))
    const otherInitial = await handlePortfolioDataHubRequest(
      request('/api/portfolio-data-hub/positions'),
      'positions',
      { env, fetch: gatewayFetch(otherSnapshot, profile({ hub_account_id: otherAccountId })) },
    )
    const { data } = await otherInitial.json()
    const fetchMock = gatewayFetch(positionsFixture)
    const result = await handlePortfolioDataHubRequest(
      request(`/api/portfolio-data-hub/positions?page_token=${data.pageToken}&cursor=page-two`),
      'positions', { env, fetch: fetchMock },
    )
    expect(result.status).toBe(400)
    // Auth and RLS mapping resolve first; the signed token blocks the Hub call.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects a valid-looking Hub response for a different mapped account', async () => {
    const wrongAccount = structuredClone(summaryFixture)
    wrongAccount.account_id = '11111111-1111-4111-8111-111111111111'
    const result = await handlePortfolioDataHubRequest(
      request('/api/portfolio-data-hub/summary'),
      'summary',
      { env, fetch: gatewayFetch(wrongAccount) },
    )
    expect(result.status).toBe(502)
    expect(await result.json()).toMatchObject({ error: { code: 'HUB_INVALID_RESPONSE' } })
  })

  it('rejects a mixed-account page even when its first row matches the mapping', async () => {
    const mixedLedger = structuredClone(ledgerFixture)
    mixedLedger.items.push({
      ...mixedLedger.items[0],
      id: '22222222-2222-4222-8222-222222222222',
      account_id: '11111111-1111-4111-8111-111111111111',
    })
    const result = await handlePortfolioDataHubRequest(
      request('/api/portfolio-data-hub/ledger'),
      'ledger',
      { env, fetch: gatewayFetch(mixedLedger) },
    )
    expect(result.status).toBe(502)
    expect(await result.json()).toMatchObject({ error: { code: 'HUB_INVALID_RESPONSE' } })
  })

  it('fails closed when the Hub contract is invalid', async () => {
    const result = await handlePortfolioDataHubRequest(
      request('/api/portfolio-data-hub/positions'),
      'positions',
      { env, fetch: gatewayFetch({ items: [] }) },
    )
    expect(result.status).toBe(502)
    expect(await result.json()).toMatchObject({ error: { code: 'HUB_INVALID_RESPONSE' } })
  })
})

describe('mixed-age provenance', () => {
  it('labels independently published summary and positions runs as mixed age', () => {
    const summary = parseHubSummary(summaryFixture)
    const independentlyPublishedPositions = structuredClone(positionsFixture)
    independentlyPublishedPositions.snapshot.run_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const positions = parseHubLatestPositionPage(independentlyPublishedPositions)
    const alignment = compareDatasetAlignment(summary, positions)
    expect(alignment).toMatchObject({
      runAligned: false,
      mixedAge: true,
      summaryRunId: summary.runId,
      positionsRunId: positions.snapshot.runId,
      summaryFetchedAt: summary.fetchedAt,
      positionsFetchedAt: positions.snapshot.fetchedAt,
    })
  })

  it('returns configured reporting currency without converting summary components', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/auth/v1/user')) return response({ id: authUserId })
      if (url.includes('/rest/v1/clients?')) return response([profile({ reporting_currency: 'USDC', reporting_currency_source: 'client' })])
      return response(url.includes('summaries') ? summaryFixture : positionsFixture)
    })
    const result = await handlePortfolioDataHubRequest(request('/api/portfolio-data-hub/overview'), 'overview', { env, fetch: fetchMock })
    expect(await result.json()).toMatchObject({ data: { reportingCurrency: 'USDC', reportingCurrencySource: 'client', summary: { components: [{ currency: summaryFixture.components[0].currency, equity: summaryFixture.components[0].equity }] } } })
  })
})

describe('admin reporting-currency discovery', () => {
  it('rejects a normal client before any clients or Hub data is read', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith('/auth/v1/user')) return response({ id: authUserId, app_metadata: { role: 'client' } })
      throw new Error('should not be called')
    })
    const result = await handlePortfolioDataHubRequest(
      request(`/api/portfolio-data-hub/admin/reporting-currencies?client_id=${clientId}`),
      'admin-reporting-currencies', { env, fetch: fetchMock },
    )
    expect(result.status).toBe(403)
    expect(await result.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses the caller JWT/RLS target lookup, returns sorted unique currencies, and hides Hub mapping IDs', async () => {
    const multiCurrency = structuredClone(summaryFixture)
    multiCurrency.components = [
      ...multiCurrency.components,
      { ...multiCurrency.components[0], currency: 'eur' },
      { ...multiCurrency.components[0], currency: 'BTC' },
    ]
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/auth/v1/user')) return response({ id: authUserId, app_metadata: { role: 'admin' } })
      if (url.includes('/rest/v1/clients?')) {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer client-jwt')
        expect(url).toContain(`client_id=eq.${clientId}`)
        expect(url).toContain('limit=2')
        return response([profile({ reporting_currency: 'BTC', reporting_currency_source: 'admin' })])
      }
      return response(multiCurrency)
    })
    const result = await handlePortfolioDataHubRequest(
      request(`/api/portfolio-data-hub/admin/reporting-currencies?client_id=${clientId}`),
      'admin-reporting-currencies', { env, fetch: fetchMock },
    )
    expect(result.status).toBe(200)
    const body = await result.json()
    expect(body).toMatchObject({
      data: { currencies: ['BTC', 'EUR'], reportingCurrency: 'BTC', reportingCurrencySource: 'admin' },
    })
    expect(JSON.stringify(body)).not.toContain('hubAccountId')
    expect(JSON.stringify(body)).not.toContain('hub_account_id')
  })

  it('fails closed when the trusted admin cannot read the exact target through RLS', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/auth/v1/user')) return response({ id: authUserId, app_metadata: { role: 'admin' } })
      if (url.includes('/rest/v1/clients?')) return response([])
      throw new Error('Hub must not be called')
    })
    const result = await handlePortfolioDataHubRequest(
      request(`/api/portfolio-data-hub/admin/reporting-currencies?client_id=${clientId}`),
      'admin-reporting-currencies', { env, fetch: fetchMock },
    )
    expect(result.status).toBe(404)
    expect(await result.json()).toMatchObject({ error: { code: 'CLIENT_NOT_FOUND' } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects a Hub summary returned for a different account', async () => {
    const wrongAccount = structuredClone(summaryFixture)
    wrongAccount.account_id = '11111111-1111-4111-8111-111111111111'
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/auth/v1/user')) return response({ id: authUserId, app_metadata: { role: 'admin' } })
      if (url.includes('/rest/v1/clients?')) return response([profile()])
      return response(wrongAccount)
    })
    const result = await handlePortfolioDataHubRequest(
      request(`/api/portfolio-data-hub/admin/reporting-currencies?client_id=${clientId}`),
      'admin-reporting-currencies', { env, fetch: fetchMock },
    )
    expect(result.status).toBe(502)
    expect(await result.json()).toMatchObject({ error: { code: 'HUB_INVALID_RESPONSE' } })
  })
})
