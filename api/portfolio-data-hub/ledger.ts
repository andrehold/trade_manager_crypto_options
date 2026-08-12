import { handlePortfolioDataHubRequest } from '../../src/lib/portfolioDataHub/server'

export const config = { runtime: 'edge' }

export default function handler(req: Request): Promise<Response> {
  return handlePortfolioDataHubRequest(req, 'ledger')
}
