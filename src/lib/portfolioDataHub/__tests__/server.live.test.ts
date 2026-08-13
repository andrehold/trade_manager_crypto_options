// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { createPortfolioDataHubGateway } from '../server'

const runLive = process.env.RUN_PORTFOLIO_DATA_HUB_LIVE_TEST === '1'

describe.skipIf(!runLive)('Portfolio Data Hub direct contract/parser smoke (not portal end-to-end)', () => {
  it('parses real summary, positions, and first 50 ledger events', async () => {
    const hubAccountId = process.env.PORTFOLIO_DATA_HUB_TEST_ACCOUNT_ID
    if (!hubAccountId) throw new Error('PORTFOLIO_DATA_HUB_TEST_ACCOUNT_ID is required')

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith('/auth/v1/user')) {
        return new Response(JSON.stringify({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }))
      }
      if (url.includes('/rest/v1/clients?')) {
        return new Response(JSON.stringify([{
          client_id: '038cd955-e117-4596-aaee-b46360dcf138',
          client_name: 'DWF',
          hub_account_id: hubAccountId,
          hub_account_label: 'DWF',
          reporting_currency: null,
        }]))
      }
      return fetch(input, init)
    }

    const gateway = createPortfolioDataHubGateway({ env: process.env, fetch: fetchImpl })
    const request = new Request('https://portal.example/api/portfolio-data-hub/overview', {
      headers: { authorization: 'Bearer live-test-placeholder' },
    })
    const context = await gateway.resolveContext(request)
    const [summary, positions, ledger] = await Promise.all([
      gateway.summary(context),
      gateway.latestPositions(context, new URL('https://portal.example/?limit=200')),
      gateway.ledger(context, new URL('https://portal.example/?limit=50')),
    ])

    expect(summary.accountId).toBe(hubAccountId)
    expect(summary.components.length).toBeGreaterThan(0)
    expect(positions.snapshot.accountId).toBe(hubAccountId)
    expect(positions.items.length).toBeLessThanOrEqual(200)
    expect(ledger.items.length).toBeLessThanOrEqual(50)
    expect(ledger.items.every((event) => event.accountId === hubAccountId)).toBe(true)
  })
})
