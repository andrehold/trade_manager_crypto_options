import { describe, expect, it, vi } from 'vitest'
import {
  fetchPortfolioHubLedger,
  fetchPortfolioHubOverview,
  fetchPortfolioHubPositionSnapshot,
  fetchPortfolioHubPerformance,
  fetchPortfolioHubSummaries,
  fetchAdminReportingCurrencies,
} from '../client'

function response(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

describe('Portfolio Data Hub browser client', () => {
  it('uses the current Supabase bearer token and the protected overview route', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ data: { summary: {}, positions: {}, alignment: {} } }))
    await fetchPortfolioHubOverview('current-access-token', fetchMock)
    expect(fetchMock).toHaveBeenCalledWith('/api/portfolio-data-hub/overview', {
      headers: { authorization: 'Bearer current-access-token', accept: 'application/json' },
    })
  })

  it('encodes only the supported ledger query values', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ data: { items: [], nextCursor: null } }))
    await fetchPortfolioHubLedger('current-access-token', { cursor: 'next page', eventType: 'trade', currency: 'USDC', limit: 50 }, fetchMock)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/portfolio-data-hub/ledger?limit=50&cursor=next+page&event_type=trade&currency=USDC')
  })

  it('requests historical summaries for the supplied UTC range', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ data: { items: [], nextCursor: null } }))
    await fetchPortfolioHubSummaries('current-access-token', {
      fetchedFrom: '2026-08-01T00:00:00Z',
      fetchedTo: '2026-09-01T00:00:00Z',
      limit: 200,
    }, fetchMock)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      '/api/portfolio-data-hub/summaries?fetched_from=2026-08-01T00%3A00%3A00Z&fetched_to=2026-09-01T00%3A00%3A00Z&limit=200',
    )
  })

  it('uses the opaque page token, never a raw snapshot identifier, for later position pages', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ data: { items: [], nextCursor: null } }))
    await fetchPortfolioHubPositionSnapshot('current-access-token', 'server-signed-token', { cursor: 'page-two' }, fetchMock)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('page_token=server-signed-token')
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('snapshot_id=')
  })

  it('turns a server unmapped-account response into a typed client error', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({
      error: { code: 'HUB_ACCOUNT_NOT_CONFIGURED', message: 'Portfolio Data Hub is not configured for this client' },
    }, 409))
    await expect(fetchPortfolioHubOverview('current-access-token', fetchMock)).rejects.toMatchObject({
      code: 'HUB_ACCOUNT_NOT_CONFIGURED', status: 409,
    })
  })

  it('calls the admin currency route with an encoded client id and bearer token', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({
      data: { currencies: ['BTC'], reportingCurrency: 'BTC', reportingCurrencySource: 'admin', summary: {} },
    }))
    await fetchAdminReportingCurrencies('038cd955-e117-4596-aaee-b46360dcf138', 'current-access-token', fetchMock)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/portfolio-data-hub/admin/reporting-currencies?client_id=038cd955-e117-4596-aaee-b46360dcf138',
      { headers: { authorization: 'Bearer current-access-token', accept: 'application/json' } },
    )
  })

  it('calls only the performance portal route with bearer auth and an optional matching ETag', async () => {
    const data = { accountId: '00000000-0000-4000-8000-000000000001' }
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ data }, 200, { etag: '"portal-v1"' }))
      .mockResolvedValueOnce(response({ data }, 200, { etag: '"portal-v2"' }))

    await fetchPortfolioHubPerformance('current-access-token', null, fetchMock)
    await fetchPortfolioHubPerformance('current-access-token', '"matching-cache-etag"', fetchMock)

    expect(fetchMock.mock.calls[0]).toEqual([
      '/api/portfolio-data-hub/performance',
      { headers: { authorization: 'Bearer current-access-token', accept: 'application/json' } },
    ])
    expect(fetchMock.mock.calls[1]).toEqual([
      '/api/portfolio-data-hub/performance',
      {
        headers: {
          authorization: 'Bearer current-access-token',
          accept: 'application/json',
          'if-none-match': '"matching-cache-etag"',
        },
      },
    ])
  })

  it('returns not-modified for 304 without attempting to read JSON', async () => {
    const notModified = new Response(null, { status: 304, headers: { etag: '"portal-v1"' } })
    const jsonSpy = vi.spyOn(notModified, 'json')
    const result = await fetchPortfolioHubPerformance(
      'current-access-token',
      '"portal-v1"',
      vi.fn<typeof fetch>().mockResolvedValue(notModified),
    )

    expect(result).toEqual({ status: 'not-modified', etag: '"portal-v1"' })
    expect(jsonSpy).not.toHaveBeenCalled()
  })

  it('returns updated normalized data and its portal ETag', async () => {
    const data = { accountId: '00000000-0000-4000-8000-000000000001' }
    const result = await fetchPortfolioHubPerformance(
      'current-access-token',
      null,
      vi.fn<typeof fetch>().mockResolvedValue(response({ data }, 200, { etag: '"portal-v1"' })),
    )

    expect(result).toEqual({ status: 'updated', data, etag: '"portal-v1"' })
  })

  it('maps permanent performance failures and validates rate-limit Retry-After', async () => {
    const permanent = vi.fn<typeof fetch>().mockResolvedValue(response({
      error: { code: 'HUB_ACCOUNT_NOT_FOUND', message: 'Mapped account not found' },
    }, 502))
    await expect(fetchPortfolioHubPerformance('token', null, permanent)).rejects.toMatchObject({
      code: 'HUB_ACCOUNT_NOT_FOUND',
      status: 502,
      retryAt: null,
    })

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-30T10:00:00Z'))
    const limited = vi.fn<typeof fetch>().mockResolvedValue(response({
      error: { code: 'HUB_RATE_LIMITED', message: 'Try later' },
    }, 503, { 'retry-after': '120' }))
    await expect(fetchPortfolioHubPerformance('token', null, limited)).rejects.toMatchObject({
      code: 'HUB_RATE_LIMITED',
      status: 503,
      retryAt: Date.parse('2026-09-30T10:02:00Z'),
    })

    const invalid = vi.fn<typeof fetch>().mockResolvedValue(response({
      error: { code: 'HUB_RATE_LIMITED', message: 'Try later' },
    }, 503, { 'retry-after': 'not-valid' }))
    await expect(fetchPortfolioHubPerformance('token', null, invalid)).rejects.toMatchObject({
      code: 'HUB_RATE_LIMITED',
      retryAt: null,
    })
    vi.useRealTimers()
  })
})
