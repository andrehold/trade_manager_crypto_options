import { handlePortfolioDataHubRequest } from '../../../src/lib/portfolioDataHub/server'

export const config = { runtime: 'edge' }

/**
 * Admin-only currency discovery for a selected portal client. The server
 * validates the Supabase JWT and Hub mapping; no Hub credential is exposed.
 */
export default function handler(req: Request): Promise<Response> {
  return handlePortfolioDataHubRequest(req, 'admin-reporting-currencies')
}
