import { ZodError } from 'zod'
import {
  parseHubLatestPositionPage,
  parseHubLedgerEventPage,
  parseHubPerformance,
  parseHubSummary,
  parseHubSummaryPage,
  type HubLatestPositionPage,
  type HubPage,
  type HubLedgerEvent,
  type HubPosition,
  type HubPerformance,
  type HubSummary,
} from './index'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DEFAULT_TIMEOUT_MS = 10_000

type RuntimeEnv = Record<string, string | undefined>

export const PERFORMANCE_NORMALIZER_VERSION = '1'

export type HubDataset = 'summary' | 'summaries' | 'positions' | 'ledger' | 'performance'

export type HubRouteErrorCode =
  | 'METHOD_NOT_ALLOWED'
  | 'UNAUTHENTICATED'
  | 'CLIENT_NOT_LINKED'
  | 'HUB_ACCOUNT_NOT_CONFIGURED'
  | 'INVALID_QUERY'
  | 'UPSTREAM_TIMEOUT'
  | 'SUPABASE_UNAVAILABLE'
  | 'HUB_UNAVAILABLE'
  | 'HUB_INVALID_RESPONSE'
  | 'HUB_AUTHORIZATION_FAILED'
  | 'HUB_ACCOUNT_NOT_FOUND'
  | 'HUB_RATE_LIMITED'
  | 'SERVER_MISCONFIGURED'
  | 'FORBIDDEN'
  | 'CLIENT_NOT_FOUND'

export class HubRouteError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: HubRouteErrorCode,
    message: string,
    public readonly cause?: unknown,
    public readonly upstreamStatusClass: 'none' | '4xx' | '5xx' | 'network' | 'timeout' = 'none',
    public readonly responseHeaders: HeadersInit = {},
  ) {
    super(message)
  }
}

export interface HubRequestContext {
  authUserId: string
  clientId: string
  clientName: string
  hubAccountId: string
  hubAccountLabel: string | null
  reportingCurrency: string | null
  reportingCurrencySource: 'client' | 'admin' | null
}

/** Browser-safe data for the admin currency selector. It deliberately omits Hub routing IDs. */
export interface AdminReportingCurrencyOptions {
  currencies: string[]
  reportingCurrency: string | null
  reportingCurrencySource: 'client' | 'admin' | null
  summary: Pick<HubSummary, 'runId' | 'fetchedAt' | 'venueObservedAt' | 'quality' | 'venue'>
}

export interface DatasetAlignment {
  runAligned: boolean
  mixedAge: boolean
  summaryRunId: string
  positionsRunId: string
  summaryFetchedAt: string
  positionsFetchedAt: string
}

/** A page token is server-signed so a client can only page the snapshot selected for its own Hub account. */
type SnapshotPageToken = { version: 1; accountId: string; snapshotId: string }
type PerformanceConditionalToken = {
  version: 1
  authUserId: string
  clientId: string
  hubAccountId: string
  upstreamEtag: string
  normalizerVersion: string
}
type HubPositionRoutePage = (HubLatestPositionPage | HubPage<HubPosition>) & { pageToken: string }
type HubPerformanceRouteResult =
  | { status: 'updated'; data: HubPerformance; etag: string | null }
  | { status: 'not-modified'; etag: string }

type ServerConfig = {
  supabaseUrl: string
  supabasePublishableKey: string
  hubBaseUrl: string
  hubApiKey: string
  timeoutMs: number
}

type PortalClientRow = {
  client_id: string
  client_name: string
  hub_account_id: string | null
  hub_account_label: string | null
  reporting_currency: string | null
  reporting_currency_source: string | null
}

type SupabaseAuthUser = {
  id: string
  app_metadata?: Record<string, unknown> | null
}

export type GatewayDependencies = {
  env?: RuntimeEnv
  fetch?: typeof globalThis.fetch
  logger?: (event: HubSafeLogEvent) => void
  correlationId?: () => string
  now?: () => number
}

export type HubSafeLogEvent = {
  correlationId: string
  route: 'performance'
  portalErrorCode: HubRouteErrorCode
  upstreamStatusClass: 'none' | '4xx' | '5xx' | 'network' | 'timeout'
  latencyMs: number
}

function requiredEnv(env: RuntimeEnv, names: string[]): string {
  for (const name of names) {
    const value = env[name]?.trim()
    if (value) return value
  }
  throw new HubRouteError(500, 'SERVER_MISCONFIGURED', `Missing server configuration: ${names.join(' or ')}`)
}

function normalizedBaseUrl(value: string, name: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new HubRouteError(500, 'SERVER_MISCONFIGURED', `${name} must be an absolute URL`)
  }
  const localHttp = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !localHttp) {
    throw new HubRouteError(500, 'SERVER_MISCONFIGURED', `${name} must use HTTPS except on loopback`)
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new HubRouteError(500, 'SERVER_MISCONFIGURED', `${name} must not contain credentials, query, or fragment`)
  }
  return url.toString().replace(/\/$/, '')
}

function readConfig(env: RuntimeEnv): ServerConfig {
  const rawTimeout = env.PORTFOLIO_DATA_HUB_TIMEOUT_MS?.trim()
  const timeoutMs = rawTimeout ? Number(rawTimeout) : DEFAULT_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30_000) {
    throw new HubRouteError(500, 'SERVER_MISCONFIGURED', 'PORTFOLIO_DATA_HUB_TIMEOUT_MS must be 500-30000')
  }
  return {
    supabaseUrl: normalizedBaseUrl(
      requiredEnv(env, ['SUPABASE_URL', 'VITE_SUPABASE_URL']),
      'SUPABASE_URL',
    ),
    supabasePublishableKey: requiredEnv(env, [
      'SUPABASE_PUBLISHABLE_KEY',
      'VITE_SUPABASE_PUBLISHABLE_KEY',
    ]),
    hubBaseUrl: normalizedBaseUrl(
      requiredEnv(env, ['PORTFOLIO_DATA_HUB_BASE_URL']),
      'PORTFOLIO_DATA_HUB_BASE_URL',
    ),
    hubApiKey: requiredEnv(env, ['PORTFOLIO_DATA_HUB_API_KEY']),
    timeoutMs,
  }
}

function bearerToken(req: Request): string {
  const authorization = req.headers.get('authorization') ?? ''
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization)
  if (!match?.[1]) {
    throw new HubRouteError(401, 'UNAUTHENTICATED', 'A Supabase bearer token is required')
  }
  return match[1]
}

async function fetchWithTimeout(
  fetchImpl: typeof globalThis.fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new HubRouteError(504, 'UPSTREAM_TIMEOUT', 'An upstream request timed out', error, 'timeout')
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function json(data: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'private, no-store',
  })
  new Headers(extraHeaders).forEach((value, name) => headers.set(name, value))
  return new Response(JSON.stringify(data), {
    status,
    headers,
  })
}

function methodGuard(req: Request): Response | null {
  if (req.method === 'GET') return null
  return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } }, 405, { allow: 'GET' })
}

function safeLimit(value: string | null, fallback: number): number {
  if (value === null) return fallback
  if (!/^\d+$/.test(value)) {
    throw new HubRouteError(400, 'INVALID_QUERY', 'limit must be an integer from 1 to 200')
  }
  const limit = Number(value)
  if (limit < 1 || limit > 200) {
    throw new HubRouteError(400, 'INVALID_QUERY', 'limit must be an integer from 1 to 200')
  }
  return limit
}

function safeOptional(value: string | null, name: string, maxLength = 500): string | null {
  if (value === null || value === '') return null
  if (value.length > maxLength || /[\u0000-\u001f]/.test(value)) {
    throw new HubRouteError(400, 'INVALID_QUERY', `${name} is invalid`)
  }
  return value
}

function safeDateTime(value: string | null, name: string): string | null {
  const safe = safeOptional(value, name, 100)
  if (safe === null) return null
  const timestamp = Date.parse(safe)
  if (!Number.isFinite(timestamp) || !safe.includes('T')) {
    throw new HubRouteError(400, 'INVALID_QUERY', `${name} must be an ISO date-time`)
  }
  return safe
}

function base64UrlEncode(value: string | Uint8Array): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url')
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

async function tokenSignature(payload: string, key: string): Promise<Uint8Array> {
  if (!globalThis.crypto?.subtle) throw new HubRouteError(500, 'SERVER_MISCONFIGURED', 'Web Crypto is required for signed portal tokens')
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  return new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(payload)))
}

async function createSnapshotPageToken(accountId: string, snapshotId: string, hubApiKey: string): Promise<string> {
  const payload = base64UrlEncode(JSON.stringify({ version: 1, accountId, snapshotId } satisfies SnapshotPageToken))
  return `${payload}.${base64UrlEncode(await tokenSignature(payload, hubApiKey))}`
}

async function parseSnapshotPageToken(value: string, context: HubRequestContext, hubApiKey: string): Promise<string> {
  const [payload, encodedSignature, extra] = value.split('.')
  if (!payload || !encodedSignature || extra) throw new HubRouteError(400, 'INVALID_QUERY', 'page_token is invalid')
  try {
    const expected = await tokenSignature(payload, hubApiKey)
    if (!sameBytes(expected, base64UrlDecode(encodedSignature))) throw new Error('Invalid signature')
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as Partial<SnapshotPageToken>
    if (parsed.version !== 1 || parsed.accountId !== context.hubAccountId || !parsed.snapshotId || !UUID_PATTERN.test(parsed.snapshotId)) {
      throw new Error('Wrong account')
    }
    return parsed.snapshotId
  } catch (error) {
    if (error instanceof HubRouteError) throw error
    throw new HubRouteError(400, 'INVALID_QUERY', 'page_token is invalid')
  }
}

function safeUpstreamEtag(value: string | null): string | null {
  if (!value || value.length > 1_024 || /[\u0000-\u001f\u007f]/.test(value)) return null
  return value
}

function conditionalTokenValue(value: string | null): string | null {
  if (!value || value.length > 4_096 || /[\u0000-\u001f\u007f]/.test(value)) return null
  const match = /^"([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)"$/.exec(value)
  return match?.[1] ?? null
}

async function createPerformanceConditionalToken(
  context: HubRequestContext,
  upstreamEtag: string,
  hubApiKey: string,
): Promise<string> {
  const token: PerformanceConditionalToken = {
    version: 1,
    authUserId: context.authUserId,
    clientId: context.clientId,
    hubAccountId: context.hubAccountId,
    upstreamEtag,
    normalizerVersion: PERFORMANCE_NORMALIZER_VERSION,
  }
  const payload = base64UrlEncode(JSON.stringify(token))
  return `"${payload}.${base64UrlEncode(await tokenSignature(payload, hubApiKey))}"`
}

async function parsePerformanceConditionalToken(
  headerValue: string | null,
  context: HubRequestContext,
  hubApiKey: string,
): Promise<{ upstreamEtag: string; portalEtag: string } | null> {
  const token = conditionalTokenValue(headerValue)
  if (!token) return null
  const [payload, encodedSignature, extra] = token.split('.')
  if (!payload || !encodedSignature || extra) return null
  try {
    const expected = await tokenSignature(payload, hubApiKey)
    if (!sameBytes(expected, base64UrlDecode(encodedSignature))) return null
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as Partial<PerformanceConditionalToken>
    const upstreamEtag = typeof parsed.upstreamEtag === 'string'
      ? safeUpstreamEtag(parsed.upstreamEtag)
      : null
    if (
      parsed.version !== 1
      || parsed.normalizerVersion !== PERFORMANCE_NORMALIZER_VERSION
      || parsed.authUserId !== context.authUserId
      || parsed.clientId !== context.clientId
      || parsed.hubAccountId !== context.hubAccountId
      || upstreamEtag === null
    ) return null
    return { upstreamEtag, portalEtag: headerValue! }
  } catch (error) {
    if (error instanceof HubRouteError) throw error
    return null
  }
}

function validatedRetryAfter(value: string | null, nowMs: number): string | null {
  if (!value || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) return null
  if (/^\d{1,6}$/.test(value)) {
    const seconds = Number(value)
    return seconds <= 86_400 ? String(seconds) : null
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && timestamp >= nowMs && timestamp <= nowMs + 86_400_000
    ? value
    : null
}

export function compareDatasetAlignment(
  summary: HubSummary,
  positions: HubLatestPositionPage,
): DatasetAlignment {
  const runAligned = summary.runId === positions.snapshot.runId
  return {
    runAligned,
    mixedAge: !runAligned,
    summaryRunId: summary.runId,
    positionsRunId: positions.snapshot.runId,
    summaryFetchedAt: summary.fetchedAt,
    positionsFetchedAt: positions.snapshot.fetchedAt,
  }
}

export function createPortfolioDataHubGateway(dependencies: GatewayDependencies = {}) {
  const env = dependencies.env ?? process.env
  const fetchImpl = dependencies.fetch ?? globalThis.fetch
  const now = dependencies.now ?? Date.now
  const config = readConfig(env)

  async function authenticate(req: Request): Promise<{ token: string; user: SupabaseAuthUser; headers: HeadersInit }> {
    const token = bearerToken(req)
    const supabaseHeaders = {
      apikey: config.supabasePublishableKey,
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    }

    let authResponse: Response
    try {
      authResponse = await fetchWithTimeout(
        fetchImpl,
        `${config.supabaseUrl}/auth/v1/user`,
        { headers: supabaseHeaders },
        config.timeoutMs,
      )
    } catch (error) {
      if (error instanceof HubRouteError) throw error
      throw new HubRouteError(502, 'SUPABASE_UNAVAILABLE', 'Supabase authentication is unavailable', error)
    }
    const authBody = await readJson(authResponse) as Partial<SupabaseAuthUser> | null
    if (!authResponse.ok || typeof authBody?.id !== 'string' || !UUID_PATTERN.test(authBody.id)) {
      throw new HubRouteError(401, 'UNAUTHENTICATED', 'The Supabase session is invalid or expired')
    }
    return { token, user: { id: authBody.id, app_metadata: authBody.app_metadata }, headers: supabaseHeaders }
  }

  function reportingCurrencySource(value: unknown): 'client' | 'admin' | null {
    return value === 'client' || value === 'admin' ? value : null
  }

  async function readClientRows(headers: HeadersInit, search: URLSearchParams): Promise<Partial<PortalClientRow>[]> {
    let profileResponse: Response
    try {
      profileResponse = await fetchWithTimeout(
        fetchImpl,
        `${config.supabaseUrl}/rest/v1/clients?${search}`,
        { headers },
        config.timeoutMs,
      )
    } catch (error) {
      if (error instanceof HubRouteError) throw error
      throw new HubRouteError(502, 'SUPABASE_UNAVAILABLE', 'The portal client mapping is unavailable', error)
    }
    const profileBody = await readJson(profileResponse)
    if (!profileResponse.ok || !Array.isArray(profileBody)) {
      throw new HubRouteError(502, 'SUPABASE_UNAVAILABLE', 'The portal client mapping could not be read')
    }
    return profileBody as Partial<PortalClientRow>[]
  }

  async function resolveContext(req: Request): Promise<HubRequestContext> {
    const { user, headers } = await authenticate(req)

    const query = new URLSearchParams({
      select: 'client_id,client_name,hub_account_id,hub_account_label,reporting_currency,reporting_currency_source',
      limit: '2',
    })
    const rows = await readClientRows(headers, query)
    if (rows.length !== 1) {
      throw new HubRouteError(403, 'CLIENT_NOT_LINKED', 'The signed-in user is not linked to one portal client')
    }
    const row = rows[0]
    if (!row.client_id || !UUID_PATTERN.test(row.client_id) || typeof row.client_name !== 'string') {
      throw new HubRouteError(502, 'SUPABASE_UNAVAILABLE', 'The portal client mapping is invalid')
    }
    if (!row.hub_account_id || !UUID_PATTERN.test(row.hub_account_id)) {
      throw new HubRouteError(409, 'HUB_ACCOUNT_NOT_CONFIGURED', 'Portfolio Data Hub is not configured for this client')
    }
    return {
      authUserId: user.id,
      clientId: row.client_id,
      clientName: row.client_name,
      hubAccountId: row.hub_account_id,
      hubAccountLabel: row.hub_account_label ?? null,
      reportingCurrency: row.reporting_currency ?? null,
      reportingCurrencySource: reportingCurrencySource(row.reporting_currency_source),
    }
  }

  async function adminReportingCurrencies(req: Request): Promise<AdminReportingCurrencyOptions> {
    const { user, headers } = await authenticate(req)
    if (user.app_metadata?.role !== 'admin') {
      throw new HubRouteError(403, 'FORBIDDEN', 'Administrator privileges are required')
    }
    const requestUrl = new URL(req.url)
    const clientId = requestUrl.searchParams.get('client_id')
    if (!clientId || !UUID_PATTERN.test(clientId)) {
      throw new HubRouteError(400, 'INVALID_QUERY', 'client_id must be a UUID')
    }
    const query = new URLSearchParams({
      select: 'client_id,client_name,hub_account_id,hub_account_label,reporting_currency,reporting_currency_source',
      client_id: `eq.${clientId}`,
      limit: '2',
    })
    // This is intentionally still caller-JWT/RLS scoped after trusted-role verification.
    // It prevents this route from becoming a service-role client-directory oracle.
    const rows = await readClientRows(headers, query)
    if (rows.length !== 1) throw new HubRouteError(404, 'CLIENT_NOT_FOUND', 'The requested client could not be found')
    const row = rows[0]
    if (!row.client_id || row.client_id !== clientId || !row.hub_account_id || !UUID_PATTERN.test(row.hub_account_id)) {
      if (!row.hub_account_id) {
        throw new HubRouteError(409, 'HUB_ACCOUNT_NOT_CONFIGURED', 'Portfolio Data Hub is not configured for this client')
      }
      throw new HubRouteError(502, 'SUPABASE_UNAVAILABLE', 'The portal client mapping is invalid')
    }
    const context: HubRequestContext = {
      authUserId: user.id,
      clientId,
      clientName: typeof row.client_name === 'string' ? row.client_name : '',
      hubAccountId: row.hub_account_id,
      hubAccountLabel: typeof row.hub_account_label === 'string' ? row.hub_account_label : null,
      reportingCurrency: typeof row.reporting_currency === 'string' ? row.reporting_currency : null,
      reportingCurrencySource: reportingCurrencySource(row.reporting_currency_source),
    }
    const latestSummary = await summary(context)
    const currencies = [...new Set(latestSummary.components
      .map((component) => component.currency.trim().toUpperCase())
      .filter((currency) => /^[A-Z0-9]{2,12}$/.test(currency)))]
      .sort((left, right) => left.localeCompare(right))
    return {
      currencies,
      reportingCurrency: context.reportingCurrency,
      reportingCurrencySource: context.reportingCurrencySource,
      summary: {
        runId: latestSummary.runId,
        fetchedAt: latestSummary.fetchedAt,
        venueObservedAt: latestSummary.venueObservedAt,
        quality: latestSummary.quality,
        venue: latestSummary.venue,
      },
    }
  }

  async function fetchHub<T>(
    context: HubRequestContext,
    pathname: string,
    search: URLSearchParams | null,
    parse: (value: unknown) => T,
  ): Promise<T> {
    const endpoint = `${config.hubBaseUrl}${pathname}${search ? `?${search}` : ''}`
    let response: Response
    try {
      response = await fetchWithTimeout(fetchImpl, endpoint, {
        headers: {
          authorization: `Bearer ${config.hubApiKey}`,
          accept: 'application/json',
        },
      }, config.timeoutMs)
    } catch (error) {
      if (error instanceof HubRouteError) throw error
      throw new HubRouteError(502, 'HUB_UNAVAILABLE', 'Portfolio Data Hub is unavailable', error)
    }
    const body = await readJson(response)
    if (!response.ok) {
      throw new HubRouteError(
        response.status === 408 || response.status === 504 ? 504 : 502,
        response.status === 408 || response.status === 504 ? 'UPSTREAM_TIMEOUT' : 'HUB_UNAVAILABLE',
        'Portfolio Data Hub could not provide this dataset',
      )
    }
    try {
      const parsed = parse(body)
      const accountContainer = parsed as {
        accountId?: string
        snapshot?: { accountId?: string }
        items?: Array<{ accountId?: string }>
      }
      const accountIds = [
        accountContainer.accountId,
        accountContainer.snapshot?.accountId,
        ...(accountContainer.items?.map((item) => item.accountId) ?? []),
      ].filter((accountId): accountId is string => typeof accountId === 'string')
      if (accountIds.some((accountId) => accountId !== context.hubAccountId)) {
        throw new Error('Hub response account does not match the mapped account')
      }
      return parsed
    } catch (error) {
      throw new HubRouteError(502, 'HUB_INVALID_RESPONSE', 'Portfolio Data Hub returned an unsupported response', error)
    }
  }

  const accountPath = (context: HubRequestContext, suffix: string) =>
    `/api/v1/accounts/${encodeURIComponent(context.hubAccountId)}/${suffix}`

  async function summary(context: HubRequestContext): Promise<HubSummary> {
    return fetchHub(context, accountPath(context, 'summaries/latest'), null, parseHubSummary)
  }

  async function summaries(context: HubRequestContext, requestUrl: URL): Promise<HubPage<HubSummary>> {
    const search = new URLSearchParams({ limit: String(safeLimit(requestUrl.searchParams.get('limit'), 200)) })
    const cursor = safeOptional(requestUrl.searchParams.get('cursor'), 'cursor')
    const fetchedFrom = safeDateTime(requestUrl.searchParams.get('fetched_from'), 'fetched_from')
    const fetchedTo = safeDateTime(requestUrl.searchParams.get('fetched_to'), 'fetched_to')
    if (cursor) search.set('cursor', cursor)
    if (fetchedFrom) search.set('fetched_from', fetchedFrom)
    if (fetchedTo) search.set('fetched_to', fetchedTo)
    return fetchHub(context, accountPath(context, 'summaries'), search, parseHubSummaryPage)
  }

  async function positions(context: HubRequestContext, requestUrl: URL): Promise<HubPositionRoutePage> {
    const search = new URLSearchParams({ limit: String(safeLimit(requestUrl.searchParams.get('limit'), 200)) })
    const cursor = safeOptional(requestUrl.searchParams.get('cursor'), 'cursor')
    const instrument = safeOptional(requestUrl.searchParams.get('instrument'), 'instrument', 200)
    const pageToken = safeOptional(requestUrl.searchParams.get('page_token'), 'page_token', 2_000)
    if (requestUrl.searchParams.has('snapshot_id')) throw new HubRouteError(400, 'INVALID_QUERY', 'snapshot_id is not accepted; use page_token')
    if (cursor && !pageToken) throw new HubRouteError(400, 'INVALID_QUERY', 'cursor requires page_token')
    if (cursor) search.set('cursor', cursor)
    if (instrument) search.set('instrument', instrument)
    // The initial read obtains an account-validated latest snapshot. Subsequent pages
    // must use a server-signed token bound to that account and immutable snapshot.
    if (pageToken) {
      const snapshotId = await parseSnapshotPageToken(pageToken, context, config.hubApiKey)
      const page = await fetchHub(
        context,
        accountPath(context, 'positions/latest'),
        search,
        parseHubLatestPositionPage,
      )
      if (page.snapshot.id !== snapshotId || page.items.some((position) => position.snapshotId !== snapshotId)) {
        throw new HubRouteError(502, 'HUB_INVALID_RESPONSE', 'Portfolio Data Hub returned positions from a different snapshot')
      }
      // The snapshot field is useful provenance; the browser consumes the page fields.
      return { ...page, pageToken }
    }
    const page = await fetchHub(context, accountPath(context, 'positions/latest'), search, parseHubLatestPositionPage)
    if (page.items.some((position) => position.snapshotId !== page.snapshot.id)) {
      throw new HubRouteError(502, 'HUB_INVALID_RESPONSE', 'Portfolio Data Hub returned positions from a different snapshot')
    }
    return { ...page, pageToken: await createSnapshotPageToken(context.hubAccountId, page.snapshot.id, config.hubApiKey) }
  }

  async function latestPositions(context: HubRequestContext, requestUrl: URL): Promise<HubLatestPositionPage & { pageToken: string }> {
    const result = await positions(context, new URL(requestUrl.toString()))
    if (!('snapshot' in result)) {
      throw new HubRouteError(400, 'INVALID_QUERY', 'snapshot_id is not supported for an overview request')
    }
    return result
  }

  async function ledger(context: HubRequestContext, requestUrl: URL): Promise<HubPage<HubLedgerEvent>> {
    const search = new URLSearchParams({ limit: String(safeLimit(requestUrl.searchParams.get('limit'), 50)) })
    for (const name of ['cursor', 'event_type', 'instrument', 'currency'] as const) {
      const value = safeOptional(requestUrl.searchParams.get(name), name, name === 'cursor' ? 500 : 200)
      if (value) search.set(name, value)
    }
    for (const name of ['event_from', 'event_to'] as const) {
      const value = safeDateTime(requestUrl.searchParams.get(name), name)
      if (value) search.set(name, value)
    }
    return fetchHub(context, accountPath(context, 'ledger-events'), search, parseHubLedgerEventPage)
  }

  async function performance(
    context: HubRequestContext,
    ifNoneMatch: string | null,
  ): Promise<HubPerformanceRouteResult> {
    const conditional = await parsePerformanceConditionalToken(
      ifNoneMatch,
      context,
      config.hubApiKey,
    )
    const headers = new Headers({
      authorization: `Bearer ${config.hubApiKey}`,
      accept: 'application/json',
    })
    if (conditional) headers.set('if-none-match', conditional.upstreamEtag)

    let response: Response
    try {
      response = await fetchWithTimeout(
        fetchImpl,
        `${config.hubBaseUrl}${accountPath(context, 'performance/latest')}`,
        { headers },
        config.timeoutMs,
      )
    } catch (error) {
      if (error instanceof HubRouteError) throw error
      throw new HubRouteError(
        502,
        'HUB_UNAVAILABLE',
        'Portfolio Data Hub is unavailable',
        error,
        'network',
      )
    }

    if (response.status === 304) {
      if (!conditional) {
        throw new HubRouteError(
          502,
          'HUB_INVALID_RESPONSE',
          'Portfolio Data Hub returned an unsupported conditional response',
          undefined,
          'none',
        )
      }
      return { status: 'not-modified', etag: conditional.portalEtag }
    }

    if (!response.ok) {
      const statusClass = response.status >= 500 ? '5xx' : '4xx'
      if (response.status === 401 || response.status === 403) {
        throw new HubRouteError(
          502,
          'HUB_AUTHORIZATION_FAILED',
          'Portfolio Data Hub rejected the portal credential',
          undefined,
          statusClass,
        )
      }
      if (response.status === 404) {
        throw new HubRouteError(
          502,
          'HUB_ACCOUNT_NOT_FOUND',
          'The mapped Portfolio Data Hub account was not found',
          undefined,
          statusClass,
        )
      }
      if (response.status === 429) {
        const retryAfter = validatedRetryAfter(response.headers.get('retry-after'), now())
        throw new HubRouteError(
          503,
          'HUB_RATE_LIMITED',
          'Portfolio Data Hub is rate limited',
          undefined,
          statusClass,
          retryAfter ? { 'retry-after': retryAfter } : {},
        )
      }
      if (response.status === 408 || response.status === 504) {
        throw new HubRouteError(
          504,
          'UPSTREAM_TIMEOUT',
          'Portfolio Data Hub timed out',
          undefined,
          'timeout',
        )
      }
      throw new HubRouteError(
        502,
        'HUB_UNAVAILABLE',
        'Portfolio Data Hub could not provide performance data',
        undefined,
        statusClass,
      )
    }

    const body = await readJson(response)
    let data: HubPerformance
    try {
      data = parseHubPerformance(body)
      if (data.accountId !== context.hubAccountId) {
        throw new Error('Hub response account does not match the mapped account')
      }
    } catch (error) {
      throw new HubRouteError(
        502,
        'HUB_INVALID_RESPONSE',
        'Portfolio Data Hub returned an unsupported performance response',
        error,
      )
    }

    const upstreamEtag = safeUpstreamEtag(response.headers.get('etag'))
    const etag = upstreamEtag
      ? await createPerformanceConditionalToken(context, upstreamEtag, config.hubApiKey)
      : null
    return { status: 'updated', data, etag }
  }

  return {
    resolveContext,
    summary,
    summaries,
    positions,
    latestPositions,
    ledger,
    performance,
    adminReportingCurrencies,
  }
}

export async function handlePortfolioDataHubRequest(
  req: Request,
  dataset: HubDataset | 'overview' | 'admin-reporting-currencies',
  dependencies: GatewayDependencies = {},
): Promise<Response> {
  const methodError = methodGuard(req)
  if (methodError) return methodError
  const now = dependencies.now ?? Date.now
  const startedAt = now()
  const correlationId = dataset === 'performance'
    ? (dependencies.correlationId?.() ?? globalThis.crypto.randomUUID())
    : null
  let performanceContext: HubRequestContext | null = null

  const logPerformanceError = (
    code: HubRouteErrorCode,
    upstreamStatusClass: HubSafeLogEvent['upstreamStatusClass'],
  ) => {
    if (dataset !== 'performance' || correlationId === null) return
    const event: HubSafeLogEvent = {
      correlationId,
      route: 'performance',
      portalErrorCode: code,
      upstreamStatusClass,
      latencyMs: Math.max(0, Math.round(now() - startedAt)),
    }
    if (dependencies.logger) dependencies.logger(event)
    else if (process.env.NODE_ENV !== 'test') console.error(JSON.stringify(event))
  }

  try {
    const gateway = createPortfolioDataHubGateway(dependencies)
    if (dataset === 'admin-reporting-currencies') {
      return json({ data: await gateway.adminReportingCurrencies(req) })
    }
    const context = await gateway.resolveContext(req)
    if (dataset === 'performance') performanceContext = context
    const requestUrl = new URL(req.url)
    if (dataset === 'summary') return json({ data: await gateway.summary(context) })
    if (dataset === 'summaries') return json({ data: await gateway.summaries(context, requestUrl) })
    if (dataset === 'positions') return json({ data: await gateway.positions(context, requestUrl) })
    if (dataset === 'ledger') return json({ data: await gateway.ledger(context, requestUrl) })
    if (dataset === 'performance') {
      const result = await gateway.performance(context, req.headers.get('if-none-match'))
      if (result.status === 'not-modified') {
        return new Response(null, {
          status: 304,
          headers: {
            etag: result.etag,
            'cache-control': 'private, no-store',
          },
        })
      }
      return json(
        { data: result.data },
        200,
        result.etag ? { etag: result.etag } : {},
      )
    }
    const [summary, positions] = await Promise.all([
      gateway.summary(context),
      gateway.latestPositions(context, requestUrl),
    ])
    return json({
      data: {
        summary,
        positions,
        alignment: compareDatasetAlignment(summary, positions),
        // Configuration is intentionally returned without any privileged mapping IDs.
        reportingCurrency: context.reportingCurrency,
        reportingCurrencySource: context.reportingCurrencySource,
      },
    })
  } catch (error) {
    if (error instanceof HubRouteError) {
      logPerformanceError(error.code, error.upstreamStatusClass)
      const responseHeaders = new Headers(error.responseHeaders)
      if (performanceContext) {
        responseHeaders.set('x-portfolio-hub-account-id', performanceContext.hubAccountId)
      }
      return json(
        { error: { code: error.code, message: error.message } },
        error.status,
        responseHeaders,
      )
    }
    const code = error instanceof ZodError ? 'HUB_INVALID_RESPONSE' : 'HUB_UNAVAILABLE'
    logPerformanceError(code, 'none')
    const responseHeaders: Record<string, string> = {}
    if (performanceContext) {
      responseHeaders['x-portfolio-hub-account-id'] = performanceContext.hubAccountId
    }
    return json({ error: { code, message: 'The portfolio dataset could not be loaded' } }, 502, responseHeaders)
  }
}
