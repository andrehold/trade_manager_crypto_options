# Portfolio Data Hub Performance Integration

**Date:** 2026-09-29
**Status:** Ready for implementation; sanitized provisional fixture required before acceptance

## Summary

The client portal will add an authenticated, account-scoped performance read from Portfolio
Data Hub:

```text
GET /api/v1/accounts/{mapped_hub_account_id}/performance/latest
```

The portal server remains the only caller of the Hub. It authenticates the Supabase user,
resolves exactly one RLS-visible `public.clients` row, takes `hub_account_id` from that row,
and constructs the Hub URL. The browser cannot supply, override, or discover the Hub account
ID through a request parameter. Normal portal traffic never calls the Hub account-listing
endpoint.

The UI treats the Hub response as authoritative. It presents `ready`, `provisional`, and
`unavailable` honestly; shows stale and recalculation-pending provenance; and preserves the
difference between a missing value and exact numeric zero. Conditional requests use ETag,
and a `304 Not Modified` preserves the last valid, account-scoped response without attempting
JSON parsing.

This change also repairs the intended test user's trusted `app_metadata.client_id`, verifies
positive and negative authorization live, verifies the deployed Hub key has exactly
`data:read`, and records the exact Production deployment revision.

## Current-state findings

The target app already has the required trust boundary:

- `public.clients.hub_account_id` is unique when present and can be changed only through the
  audited administrator/service-role mapping path.
- `helpers.current_client_id()` reads only `auth.jwt().app_metadata.client_id`.
- `public.clients` RLS permits a client to read only its own row.
- `src/lib/portfolioDataHub/server.ts` authenticates the Supabase bearer token, resolves the
  RLS-visible client row, and builds account-scoped Hub URLs on the server.
- Hub keys use a server-only `PORTFOLIO_DATA_HUB_API_KEY`; browser code calls same-origin
  `/api/portfolio-data-hub/*` routes.

The existing integration does **not** yet request or parse `performance/latest`, does not
support conditional requests, and has no UI vocabulary for the new performance states.

On 2026-09-29 the deployed Hub endpoint was checked without printing credentials or financial
values. It returned:

- HTTP `200` with `Cache-Control: private, max-age=0, must-revalidate` and a strong ETag;
- HTTP `304` with an empty body when that ETag was sent as `If-None-Match`;
- `quality.equity_status = "unavailable"`;
- `quality.performance_status = "unavailable"`;
- `quality.freshness = "unknown"`;
- `quality.recalculation_pending = true`;
- `quality.reason_codes = ["policy_not_configured"]`.

The proposed account `bc0d0917-83a9-44e5-a447-f16fc9f4a5bf` returned account-matching
Paradex data. All six currently mapped accounts returned unavailable performance with no
non-null `performance` object because policy configuration was still pending.

The Hub team has supplied the authoritative contract and ready example:

- `/Users/andreholschick/Desktop/portfolio-data-hub/docs/contracts/performance/openapi.json`
- `/Users/andreholschick/Desktop/portfolio-data-hub/docs/contracts/performance/single-account-example.json`
- `/Users/andreholschick/Desktop/portfolio-data-hub/consumer_kit/performance_example.py`

These establish the exact capital-flow and P&L fields. The only remaining contract fixture
prerequisite is a sanitized provisional response.

## Goals

- Fetch only the authenticated client's explicitly mapped Hub performance resource.
- Validate the complete Hub performance contract and reject cross-account responses.
- Present state, freshness, recalculation, reason, and lineage information without local
  financial inference.
- Preserve exact decimals, nulls, and numeric zero end to end.
- Use ETag/304 safely without cross-user or cross-account cache reuse.
- Prove both positive and negative authorization with live test identities.
- Prove the deployed consumer key has exactly `data:read` without exposing it.
- Produce reproducible test and deployment evidence tied to one Git commit.

## Non-goals

- Listing or auto-discovering Hub accounts during normal portal requests.
- Accepting a Hub account ID, client ID, reporting currency, policy, or calculation input from
  the browser for the performance read.
- Calculating performance, capital flows, P&L, freshness, or status in the portal.
- Replacing the existing summary, positions, ledger, or risk integrations.
- Converting currencies or substituting summary-derived values when Hub performance is
  unavailable.
- Persisting performance data in the portal database.
- Exposing the Hub bearer key, Supabase tokens, credentials, personal information, or raw
  administrative responses in logs or validation artifacts.

## Authoritative Hub contract

### Endpoint

```http
GET /api/v1/accounts/{account_id}/performance/latest
Authorization: Bearer <server-only Hub key>
Accept: application/json
If-None-Match: <prior ETag>   # optional
```

The server substitutes `context.hubAccountId`, obtained after Supabase authentication and
the RLS-scoped `public.clients` lookup. No portal query string, path segment, request body, or
client header can select `account_id`.

### Authoritative response

The parser must cover the complete Hub response. The authoritative OpenAPI components define:

```ts
type HubPerformance = {
  performance_schema_version: string
  id: string | null
  account_id: string
  revision: number | null
  as_of: string | null
  time_basis: string
  computed_at: string | null
  reporting_currency: string | null
  equity: ExactDecimal | null
  opening_equity: ExactDecimal | null
  performance: {
    opening_equity: ExactDecimal | null
    contributions: ExactDecimal | null
    distributions: ExactDecimal | null
    transfers_in: ExactDecimal | null
    transfers_out: ExactDecimal | null
    net_capital_flow: ExactDecimal | null
    pnl: ExactDecimal | null
  } | null
  quality: {
    equity_status: 'ready' | 'provisional' | 'unavailable'
    performance_status: 'ready' | 'provisional' | 'unavailable'
    freshness: 'fresh' | 'stale' | 'unknown'
    recalculation_pending: boolean
    unresolved_movement_count: number
    ledger_coverage_from: string | null
    ledger_coverage_through: string | null
    reason_codes: string[]
    details: Record<string, unknown>
  }
  lineage: {
    summary_snapshot_id: string | null
    baseline_snapshot_id: string | null
    baseline_at: string | null
    canonical_input_sequence: number
    classification_sequence: number
    policy_revision: number | null
    calculation_version: string | null
  }
}
```

This is the stable normalized portal shape. The raw Zod schema must follow the supplied
OpenAPI schema for required/optional fields, UUID/date-time formats, defaults, and nullability;
documented omitted nullable/defaulted fields normalize to null or their documented default,
never zero. Both `revision` and `lineage.policy_revision`, when present and non-null, are
integers only. Numeric strings, decimal strings, floats, and coerced values must be rejected
for these two fields.

### Contract-artifact gate

Copy the supplied OpenAPI performance components and sanitized ready response into the target
repository as pinned contract fixtures, retaining their Hub revision/provenance. Obtain one
additional sanitized **provisional** response from the same Hub contract revision before UI
implementation is accepted. Do not infer provisional null/status combinations from product
copy, and do not merge a permissive `record<string, unknown>` parser for financial values.

The supplied consumer example is behavioral guidance for account matching, exact decimal
strings, and `304` handling; the OpenAPI contract remains authoritative for field types and
optionality.

All financial values remain exact decimal strings. They must pass the existing exact-decimal
schema and must never pass through JavaScript `number`.

### Validation invariants

- `account_id` must equal the resolved `context.hubAccountId`; mismatch is
  `502 HUB_INVALID_RESPONSE`.
- All required top-level, quality, lineage, capital-flow, and P&L fields are parsed before a
  response becomes cacheable or renderable.
- Unknown additive fields may be retained or ignored according to the existing Canonical v1
  policy, but cannot replace required fields.
- Null stays null. Missing required data does not become `"0"`, `0`, or an empty string.
- Exact zero stays an exact decimal zero and renders as zero.
- `equity_status`, `performance_status`, and `freshness` are strict enums. Unknown values fail
  parsing.
- Reason codes are extensible: accept known codes and unknown non-empty strings. Known codes
  use approved copy; unknown codes use one safe generic fallback and do not fail parsing.
- `quality.details` may be retained internally as untrusted opaque data, but is never displayed,
  interpolated into UI copy, or logged.
- Top-level `opening_equity` is the single display source. When it and
  `performance.opening_equity` are both non-null, compare them as exact decimals and reject the
  response if they disagree. Do not silently choose between conflicting values.
- An unavailable response is a valid data response, not a network error.

## Server architecture

### Portal route

Add:

```text
api/portfolio-data-hub/performance.ts
```

The route delegates to the shared gateway using a new `performance` dataset. It accepts only
`GET`. It accepts no account-, client-, currency-, policy-, or calculation-selection query
parameters.

The gateway sequence is fixed:

1. Require the browser's Supabase bearer token.
2. Validate it through Supabase Auth.
3. Query `public.clients` with the caller JWT and no browser-supplied client predicate.
4. Require exactly one row and a valid `hub_account_id`.
5. Build `/api/v1/accounts/${encodeURIComponent(context.hubAccountId)}/performance/latest`.
6. Send the server-only Hub key and an optional validated conditional ETag.
7. On `200`, parse the full response and verify its account ID.
8. On `304`, return an empty `304` response without calling `response.json()`.

The normal performance path must never call `/api/v1/data/accounts` or any equivalent listing
endpoint. The existing operational remap script remains the only account-enumeration flow.

### Browser-safe response

On `200`, return the normalized performance object in the existing `{ data: ... }` envelope,
plus the portal ETag header. Preserve `Cache-Control: private, no-store` at the portal boundary;
the application owns its small in-memory conditional cache and does not rely on shared HTTP
caches.

The response may include normalized `accountId`, consistent with current summary and position
responses. Documentation must state this accurately: the Hub credential is never exposed,
but account IDs are present in normalized account-scoped payloads.

### ETag binding and cache isolation

An ETag obtained for one user/account must never validate another user/account's cache entry.
Use a server-signed opaque conditional token, following the existing signed position-page-token
pattern:

```ts
type PerformanceConditionalToken = {
  version: 1
  authUserId: string
  clientId: string
  hubAccountId: string
  upstreamEtag: string
  normalizerVersion: string
}
```

- On Hub `200`, sign this payload server-side and expose the signed token as the portal route's
  ETag. This is a non-secret, integrity-protected token, not an encrypted token: a browser can
  decode its payload, and the contained IDs are already browser-visible. Its signature prevents
  tampering; it does not provide confidentiality.
- On the next request, accept `If-None-Match` only within a conservative size limit and reject
  control characters.
- Validate its signature and bind it to the newly resolved auth user, client, and Hub account.
- Require `normalizerVersion` to equal the running portal normalizer version. A token from an
  older normalizer is ignored so an upstream `304` cannot reuse data shaped by an older portal
  release.
- If valid, forward only its `upstreamEtag` to the same mapped Hub account.
- If absent, invalid, from another token/normalizer version, or bound to another context, ignore the
  conditional value and perform an unconditional read. Do not reveal why it was ignored.
- If the Hub returns `304`, return `304` with the same portal ETag and an empty body.
- Never call JSON parsing or schema parsing on `304`.

The browser keeps at most one valid performance entry per
`authenticatedUserId + clientId + accountId`. Sign-out, an auth-user change, or an account-ID
change evicts the active entry. A `304` is usable only when an entry exists for the current
identity tuple; a cacheless `304` triggers one unconditional recovery request, not an error or
blank state.

### Error mapping

- Missing/invalid Supabase session: portal `401 UNAUTHENTICATED`; no Hub request.
- Zero or multiple RLS-visible client rows: portal `403 CLIENT_NOT_LINKED`; no Hub request.
- Visible client without mapping: portal `409 HUB_ACCOUNT_NOT_CONFIGURED`; no Hub request.
- Hub `401`/`403`: portal `502 HUB_AUTHORIZATION_FAILED`; do not retry automatically.
- Hub `404`: portal `502 HUB_ACCOUNT_NOT_FOUND`; do not retry or attempt account discovery.
- Hub `429`: portal `503 HUB_RATE_LIMITED`, forwarding a validated `Retry-After` when present.
- Hub `408`/`504` or local timeout: portal `504 UPSTREAM_TIMEOUT`.
- Other Hub `5xx`/network errors: portal `502 HUB_UNAVAILABLE`.
- Contract or account mismatch: portal `502 HUB_INVALID_RESPONSE`.

The configured timeout remains 10 seconds by default. No request is automatically retried by
the server. Browser behavior is selected from the portal error code, never from a hidden
upstream status:

- `HUB_AUTHORIZATION_FAILED`, `HUB_ACCOUNT_NOT_FOUND`, `HUB_INVALID_RESPONSE`,
  `UNAUTHENTICATED`, `CLIENT_NOT_LINKED`, and `HUB_ACCOUNT_NOT_CONFIGURED` are permanent for the
  current request/session and are not retried automatically.
- `HUB_RATE_LIMITED` may enable refresh after a validated `Retry-After`; it is the only error
  allowed to use that header.
- `HUB_UNAVAILABLE` and `UPSTREAM_TIMEOUT` preserve any last valid response but require manual
  retry in the first release.

### Production logging rules

Production logs may contain a generated request/correlation ID, route name, portal error code,
upstream status class, latency, and anonymous environment/deployment metadata. They must not
contain:

- the complete raw or normalized performance payload;
- any financial value or `quality.details` content;
- the signed ETag token or raw upstream ETag;
- an `Authorization` header, Supabase JWT, Hub API key, password, or session credential.

## Browser client and refresh behavior

Add a dedicated `fetchPortfolioHubPerformance` client that calls only:

```text
/api/portfolio-data-hub/performance
```

It sends the current Supabase access token and, when a matching cached entry exists, its portal
ETag. Its response type must distinguish:

```ts
type ConditionalResult<T> =
  | { status: 'updated'; data: T; etag: string | null }
  | { status: 'not-modified'; etag: string | null }
```

`304` is handled before any JSON read. `not-modified` retains the existing object reference
and render state.

### Refresh policy

- Fetch on authenticated portal entry.
- Keep the existing manual Refresh action and use ETag revalidation for it.
- Do **not** poll automatically or schedule background retries in the first release. This avoids
  consuming the shared Hetzner gateway rate limit through concurrent Vercel users.
- Do not overlap requests; discard late results from an older identity or generation.
- For `HUB_RATE_LIMITED`, validate `Retry-After`, disable manual refresh until that time, and
  tell the user when retry is available. Do not start a timer that automatically calls the API.
- For retryable transport failures, keep the last valid response visibly marked as
  refresh-failed and offer manual retry.
- A successful `200` or `304` clears the refresh error/rate-limit state.

Automatic polling is explicitly deferred. It requires measured user concurrency, observed Hub
rate-limit headroom, and a separately approved cadence/backoff design.

## UI specification

Add a performance status panel to the existing Performance & risk dashboard. Hub performance
replaces summary-derived performance figures where the Hub contract supplies them; the existing
summary/positions/risk datasets remain independently sourced and retain their provenance.

### Independent equity and performance status

`quality.equity_status` and `quality.performance_status` are independent axes. The UI must not
collapse them into one overall financial status:

- Render top-level `equity` according to `equity_status`.
- Render top-level `opening_equity`, capital-flow totals, and P&L according to
  `performance_status`.
- A valid `equity_status = ready` plus `performance_status = unavailable` displays valid equity
  while showing the performance block as unavailable. Missing baseline selection is one expected
  cause.
- Unavailable performance never hides or degrades valid equity.
- Unavailable equity never causes non-null ready/provisional performance values to be replaced
  with summary-derived values.
- Top-level `opening_equity` is the only opening-equity display source. The nested copy is
  retained for contract validation and must agree when both values are non-null.

### Ready

- For each independently ready block, display its non-null values: equity for the equity block;
  opening equity, contributions, distributions, transfers in/out, net capital flow, and P&L for
  the performance block.
- Display reporting currency, `as_of`, and computation provenance.
- Show a quiet “Ready” state on the applicable block.
- A null individual value renders `—`; exact zero renders a formatted zero.

### Provisional

- For each independently provisional block, display only its non-null Hub-provided values.
- Show a persistent “Provisional” warning on the applicable block explaining that classification
  or calculation may still change.
- Show applicable reason codes and unresolved movement count using reviewed user-facing copy.
- Never relabel provisional values as final or fill nulls from summary data.

### Unavailable

- For an unavailable equity block, show “Equity unavailable” and do not render fabricated equity.
- For an unavailable performance block, show “Performance unavailable” and do not render
  fabricated opening equity, flows, P&L, or zeros.
- Show reviewed reason-code copy and a manual refresh action where useful.
- Keep the independently available block visible.
- Existing position/risk sections may remain available, clearly separated from performance.

### Freshness

- `fresh`: normal provenance treatment.
- `stale`: persistent warning with the last `as_of`/`computed_at`; do not describe values as
  current.
- `unknown`: neutral “Freshness unavailable” provenance, not “fresh.”
- A transport refresh failure with a last valid response is a separate stale/error condition:
  retain the last response, show when it was last validated, and state that refresh failed.

### Recalculation pending

When `quality.recalculation_pending` is true, show “Recalculation pending” independently of
ready/provisional/unavailable. It does not turn null into zero and does not hide reason codes.
The next manual refresh uses the conditional request flow.

### Reason codes and lineage

- Maintain a reviewed map from known reason codes to concise user-facing explanations.
- Unknown non-empty codes are accepted and use a safe generic explanation; raw unknown text is
  not interpolated into UI copy and does not crash the page.
- `quality.details` is never displayed. Only explicitly approved quality fields and reason-code
  mappings can produce user-visible text.
- Show policy revision and calculation version in the provenance/details treatment when present.
- Keep snapshot IDs and sequences available for diagnostics without implying they are financial
  values. Do not log the complete payload.

### Combined-state precedence

Equity status, performance status, freshness, and recalculation are orthogonal:

1. Render the equity availability state (`ready`, `provisional`, `unavailable`).
2. Render the performance availability state independently.
3. Add stale/unknown freshness treatment.
4. Add recalculation-pending treatment.
5. Add approved reason-code detail.

For example, `equity ready + performance unavailable + stale + pending` shows valid equity and
all three performance/provenance facts; it is not collapsed into a generic unavailable view.

## Trusted test-identity repair

The intended authorized test identity currently authenticates but has no trusted
`app_metadata.client_id`, so RLS returns zero client rows. Repair it only through an audited
administrative path:

1. Resolve the intended auth user and target portal client out of band without writing personal
   information to the repository or test output.
2. Verify the target client is the unique row mapped to
   `bc0d0917-83a9-44e5-a447-f16fc9f4a5bf`.
3. Using Supabase Admin Auth or an equivalent service-role operation, merge
   `client_id: <target public.clients.client_id>` into the user's existing `app_metadata`.
   Preserve unrelated trusted claims such as role; do not replace the entire metadata object.
4. Do not write authorization data to `user_metadata`.
5. Revoke/refresh the old session. Sign out and sign back in, or otherwise obtain a freshly
   minted JWT.
6. Verify the new JWT's trusted claim server-side without printing the JWT.
7. Record the administrative change in the portal identity audit store described below, and
   retain the corresponding Supabase Auth administrative audit event. Redact identities from
   handover output.

This is an operational identity fix, not a browser feature and not a SQL seed containing user
details.

### Identity-repair audit store

Supabase Auth metadata updates do not write `client_account_config_audit`. Add a focused
`public.auth_identity_admin_audit` table rather than overloading the Hub-mapping audit stream.
It stores:

- `id`, `ts`;
- `subject_user_id` (the Auth user changed);
- `actor_id` and `actor_role`;
- `old_client_id` and `new_client_id`;
- a required non-secret change-ticket/reference string;
- operation result (`applied` or `rolled_back`).

Enable RLS with no client policy. Only trusted administrators may read it; only a dedicated
security-definer RPC callable by `service_role` may append events. The table stores no email,
password, JWT, API key, or complete Auth metadata object.

The administrative repair script performs: read existing app metadata → update Auth metadata →
append `applied` audit row → revoke/refresh session. If the audit append fails, it restores the
old app metadata, appends/records `rolled_back` where possible, and stops. Validation handover
reports only the audit event ID/change reference and pass/fail, not user identifiers.

## Live authorization acceptance

Run against the deployed portal route, not only by calling the Hub directly.

### Authorized identity

- Login succeeds.
- The trusted JWT contains the expected `app_metadata.client_id`.
- The caller sees exactly one `public.clients` row through RLS.
- That row maps to `bc0d0917-83a9-44e5-a447-f16fc9f4a5bf`.
- `/api/portfolio-data-hub/performance` succeeds and its normalized `accountId` equals that ID.
- Network capture shows one Hub data request to the exact mapped `performance/latest` URL and
  no account-listing request.
- A second conditional request returns/handles `304` while preserving the displayed response.

### Unauthorized identity

- Login succeeds with a separate fixture identity.
- The identity has no RLS-visible target mapping.
- The portal route returns `403 CLIENT_NOT_LINKED` (or `409` for an intentionally visible but
  unmapped fixture) before any Hub request.
- The response contains no target account ID, mapping, performance payload, ETag token from the
  target, or financial data.

Report only anonymous fixture labels, status codes, account-match booleans, and pass/fail.

## Hub key-scope verification

The deployed Production key must have exactly:

```text
data:read
```

Verification must use the Hub key-management source of truth (administrative UI/API or audited
key inventory), not infer scope from a successful data request. Record:

- environment;
- a non-secret key identifier or fingerprint approved for reporting;
- exact scope set `['data:read']`;
- active/revoked state;
- verification timestamp and reviewer.

Do not print or store the key value. If any additional scope is present, issue a replacement
least-privilege key, update Vercel Production, redeploy, validate, then revoke the old key.

## Automated test specification

### Schema and normalizer

- parses authoritative ready fixture with every capital-flow/P&L field;
- parses provisional and unavailable fixtures;
- rejects unsupported schema/status/freshness values;
- rejects string or fractional `revision` and `lineage.policy_revision` values;
- rejects malformed exact decimals;
- preserves null and exact zero distinctly;
- accepts unknown non-empty reason codes while preserving complete lineage/policy metadata;
- rejects unequal non-null top-level and nested opening equity.

### Server boundary

- **`requests only the RLS-mapped performance/latest endpoint`**: assert call order is Auth,
  RLS client lookup, exact mapped Hub URL.
- Assert no call contains `/api/v1/data/accounts` and no browser query value changes the URL.
- **`rejects a performance response for a different account`** with
  `502 HUB_INVALID_RESPONSE`.
- Unauthenticated, unauthorized, and unmapped callers cause zero Hub requests.
- A payload whose performance status is `unavailable` is a valid parsed `200`; transport
  failures retain their distinct portal error semantics.
- A valid same-context conditional token forwards the upstream ETag.
- A cross-user/cross-client/cross-account or tampered conditional token is ignored and cannot
  produce a cached response.
- A token with an old `normalizerVersion` is ignored and forces a fresh `200` normalization.
- Upstream `304` produces an empty portal `304` and never invokes JSON parsing.
- Hub `401`/`403`, `404`, `429`, and generic `5xx` map to their distinct portal error codes;
  only rate limiting forwards a validated `Retry-After`.
- Structured logging tests prove payloads, financial values, ETags, authorization headers, and
  credentials are absent.

### Browser client and hook

- sends `If-None-Match` only for the current identity tuple;
- preserves existing data and object identity on `304`;
- performs one unconditional recovery read for a cacheless `304`;
- clears cache on sign-out/account change;
- ignores late results after an identity/generation change;
- performs no background polling or automatic retry;
- selects manual-retry/rate-limit UI behavior from portal error codes, not upstream statuses.

### UI

- ready renders all non-null metrics and Ready provenance;
- provisional renders warning, values, reasons, and unresolved count;
- unavailable renders no fabricated financial values;
- ready equity remains visible when performance is unavailable, and the inverse states remain
  independently represented;
- stale and unknown freshness render honest provenance;
- recalculation pending renders independently of availability status;
- null renders `—`, while exact zero renders formatted zero;
- unknown reason codes fall back safely;
- `quality.details` and raw unknown reason text never render;
- a refresh failure retains but clearly marks the last valid response.

Test fixtures must contain no real account figures, credentials, tokens, or personal data.

## Documentation changes

Update `docs/DEPLOY.md` and `.env.example` to:

- list `/api/portfolio-data-hub/performance`;
- describe `data:read` as the exact Production key scope;
- document ETag/304 and the live authorization acceptance procedure;
- add the performance endpoint to Production smoke checks;
- correct “no Hub routing ID appears in browser-accessible responses.”

Replacement security statement:

> Browser traffic is limited to authenticated same-origin portal routes. The Hub bearer key
> and server configuration never enter browser code or responses. Normalized account-scoped
> payloads may include their Hub `accountId`; the browser cannot choose that ID, and the server
> verifies it against the authenticated client's RLS-visible mapping.

## Expected code locations

- `src/lib/portfolioDataHub/schemas.ts` — raw performance contract.
- `src/lib/portfolioDataHub/normalizers.ts` — normalized performance types/data.
- `src/lib/portfolioDataHub/server.ts` — mapped request, account check, conditional token, and
  upstream status handling.
- `src/lib/portfolioDataHub/client.ts` — conditional portal client.
- `api/portfolio-data-hub/performance.ts` — Edge route.
- `src/features/clientPortal/usePortfolioDataHub.ts` or a dedicated performance hook —
  identity-bound conditional cache and manual-refresh/error state.
- `src/features/clientPortal/components/HubPortfolioView.tsx` plus focused components — UI.
- `src/lib/portfolioDataHub/__fixtures__/performance/` — sanitized authoritative fixtures.
- `supabase/migrations/*_auth_identity_admin_audit.sql` and a restricted administrative repair
  script — durable claim-repair auditing.
- existing server/client/hook/component test suites — required automated coverage.
- `docs/DEPLOY.md` and `.env.example` — operations and security documentation.

## Deployment and evidence gates

The change is complete only when all of the following are captured:

1. Implementation commit SHA with a clean worktree.
2. Typecheck, production build, targeted performance tests, and full test suite all pass.
3. Live authorized and unauthorized portal-route tests pass as specified above.
4. Direct Hub contract smoke passes for the mapped Paradex account.
5. Hub key management confirms the deployed key has exactly `data:read`.
6. Vercel deployment record shows environment `Production`, supplied Git commit SHA, final URL,
   Ready status, and Production alias.
7. A read-only request to the Production route confirms the deployed behavior.
8. Browser/network evidence contains no key, JWT, password, personal information, or direct
   browser-to-Hub call.

Do not state that Production runs the supplied commit based only on a local Git branch or a
successful build. Verify the commit in Vercel's deployment metadata after promotion.

## Rollback

- Roll back the Vercel Production alias to the prior known-good deployment.
- The performance data path does not persist performance or change mappings. The identity-repair
  audit table migration may be rolled back only after its audit records have been retained under
  the organization's audit policy.
- If the test-identity claim must be reverted, use the same administrative Auth path, preserve
  unrelated trusted metadata, and revoke old sessions again.
- If a replacement Hub key was issued, restore only a known-good `data:read` key and revoke any
  superseded key after rollback validation.

## Open decisions and prerequisites

1. Obtain the sanitized provisional fixture matching the already supplied OpenAPI contract and
   ready fixture.
2. Approve user-facing copy for every known reason code, beginning with
   `policy_not_configured`.
3. Confirm the Hub key-management evidence mechanism and the non-secret key identifier allowed
   in validation reports.
4. Identify the intended authorized auth user and target `public.clients` row out of band for
   the administrative claim repair.
