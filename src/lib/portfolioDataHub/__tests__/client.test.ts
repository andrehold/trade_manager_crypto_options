import { describe, expect, it, vi } from 'vitest'
import {
  fetchPortfolioHubLedger,
  fetchPortfolioHubOverview,
  fetchPortfolioHubPositionSnapshot,
} from '../client'

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
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
})
