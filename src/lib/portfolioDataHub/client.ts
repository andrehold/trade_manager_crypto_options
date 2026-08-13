import type {
  HubLatestPositionPage,
  HubLedgerEvent,
  HubPage,
  HubPosition,
  HubSummary,
} from './index'

/** The intentionally small, browser-safe contract exposed by the portal routes. */
export type PortfolioHubOverview = {
  summary: HubSummary
  positions: HubLatestPositionPage & { pageToken: string }
  reportingCurrency: string | null
  reportingCurrencySource: 'client' | 'admin' | null
  alignment: {
    runAligned: boolean
    mixedAge: boolean
    summaryRunId: string
    positionsRunId: string
    summaryFetchedAt: string
    positionsFetchedAt: string
  }
}

/** Data returned by the trusted-admin currency-discovery endpoint. */
export type AdminReportingCurrencyOptions = {
  currencies: string[]
  reportingCurrency: string | null
  reportingCurrencySource: 'client' | 'admin' | null
  summary: {
    runId: string
    fetchedAt: string
    venueObservedAt: string | null
    quality: 'complete' | 'partial'
    venue: string | null
  }
}

export type HubLedgerFilters = {
  eventType?: string
  currency?: string
  instrument?: string
}

export type HubClientErrorCode =
  | 'UNAUTHENTICATED'
  | 'HUB_ACCOUNT_NOT_CONFIGURED'
  | 'CLIENT_NOT_LINKED'
  | 'INVALID_QUERY'
  | 'UPSTREAM_TIMEOUT'
  | 'SUPABASE_UNAVAILABLE'
  | 'HUB_UNAVAILABLE'
  | 'HUB_INVALID_RESPONSE'
  | 'SERVER_MISCONFIGURED'
  | 'FORBIDDEN'
  | 'CLIENT_NOT_FOUND'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'

export class PortfolioHubClientError extends Error {
  constructor(
    public readonly code: HubClientErrorCode,
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message)
  }
}

type ApiEnvelope<T> = { data: T }
type ApiErrorEnvelope = { error: { code?: unknown; message?: unknown } }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function apiErrorCode(value: unknown): HubClientErrorCode {
  const codes: HubClientErrorCode[] = [
    'UNAUTHENTICATED', 'HUB_ACCOUNT_NOT_CONFIGURED', 'CLIENT_NOT_LINKED', 'INVALID_QUERY',
    'UPSTREAM_TIMEOUT', 'SUPABASE_UNAVAILABLE', 'HUB_UNAVAILABLE', 'HUB_INVALID_RESPONSE',
    'SERVER_MISCONFIGURED', 'FORBIDDEN', 'CLIENT_NOT_FOUND',
  ]
  return typeof value === 'string' && codes.includes(value as HubClientErrorCode)
    ? value as HubClientErrorCode
    : 'INVALID_RESPONSE'
}

async function readResponse<T>(response: Response): Promise<T> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new PortfolioHubClientError('INVALID_RESPONSE', 'The portfolio service returned an invalid response', response.status)
  }
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body.error) ? body as ApiErrorEnvelope : null
    const message = typeof error?.error.message === 'string'
      ? error.error.message
      : 'The portfolio service could not load this data'
    throw new PortfolioHubClientError(apiErrorCode(error?.error.code), message, response.status)
  }
  if (!isRecord(body) || !('data' in body)) {
    throw new PortfolioHubClientError('INVALID_RESPONSE', 'The portfolio service returned an invalid response', response.status)
  }
  return (body as ApiEnvelope<T>).data
}

/**
 * Calls only the portal's protected server routes. The Hub API key never
 * enters the browser; the current Supabase access token scopes the request.
 */
export async function requestPortfolioHub<T>(
  path: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  let response: Response
  try {
    response = await fetchImpl(path, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    })
  } catch (error) {
    throw new PortfolioHubClientError(
      'NETWORK_ERROR',
      error instanceof Error ? error.message : 'The portfolio service is unavailable',
    )
  }
  return readResponse<T>(response)
}

export function fetchPortfolioHubOverview(accessToken: string, fetchImpl?: typeof fetch) {
  return requestPortfolioHub<PortfolioHubOverview>('/api/portfolio-data-hub/overview', accessToken, fetchImpl)
}

/**
 * Reads currencies only after the server has verified `app_metadata.role`.
 * The response intentionally omits the Hub account ID.
 */
export function fetchAdminReportingCurrencies(
  clientId: string,
  accessToken: string,
  fetchImpl?: typeof fetch,
) {
  const query = new URLSearchParams({ client_id: clientId })
  return requestPortfolioHub<AdminReportingCurrencyOptions>(
    `/api/portfolio-data-hub/admin/reporting-currencies?${query}`,
    accessToken,
    fetchImpl,
  )
}

/** Reads a page from the immutable snapshot selected by the initial overview. */
export function fetchPortfolioHubPositionSnapshot(
  accessToken: string,
  pageToken: string,
  options: { cursor?: string | null; limit?: number; instrument?: string } = {},
  fetchImpl?: typeof fetch,
) {
  const query = new URLSearchParams({ page_token: pageToken, limit: String(options.limit ?? 200) })
  if (options.cursor) query.set('cursor', options.cursor)
  if (options.instrument) query.set('instrument', options.instrument)
  return requestPortfolioHub<HubPage<HubPosition>>(
    `/api/portfolio-data-hub/positions?${query}`,
    accessToken,
    fetchImpl,
  )
}

export function fetchPortfolioHubLedger(
  accessToken: string,
  options: HubLedgerFilters & { cursor?: string | null; limit?: number } = {},
  fetchImpl?: typeof fetch,
) {
  const query = new URLSearchParams({ limit: String(options.limit ?? 50) })
  if (options.cursor) query.set('cursor', options.cursor)
  if (options.eventType) query.set('event_type', options.eventType)
  if (options.currency) query.set('currency', options.currency)
  if (options.instrument) query.set('instrument', options.instrument)
  return requestPortfolioHub<HubPage<HubLedgerEvent>>(
    `/api/portfolio-data-hub/ledger?${query}`,
    accessToken,
    fetchImpl,
  )
}
