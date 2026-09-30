# Deploying to Vercel

This app uses **explicit Vercel Edge routes** for live data and a Vite proxy for local development. The Portfolio Data Hub is always reached server-to-server: the browser calls this portal's `/api/portfolio-data-hub/*` routes and never receives a Hub credential.

## Required files
- `api/deribit/ticker.ts` — proxies `public/ticker` to Deribit and returns upstream JSON.
- `api/coincall/price.ts` — aggregates Coincall detail + orderbook + last trade and returns `{ price, multiplier, greeks }`.
- `api/portfolio-data-hub/*` — authenticated client summary, historical summaries, positions, ledger, combined provenance, and account performance routes.

## Portfolio Data Hub environment

The Hub key is server-only and must never use a `VITE_` prefix:

```env
PORTFOLIO_DATA_HUB_BASE_URL=https://hub.germanquantum.tech
PORTFOLIO_DATA_HUB_API_KEY=<server-only bearer key; exact data:read scope>
```

For this integration, the deployed portal key must have **exactly** the `data:read`
scope. Confirm that scope on the deployed key in Portfolio Data Hub key management.
The portal preflight checks configuration placement and shape only; it cannot
inspect the Hub key or establish its scopes. Do not expose the key when recording
the verification result.

The routes validate the caller with the existing Supabase publishable key and
query `public.clients` under the caller's RLS context. They therefore use
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; no service-role secret is
required for client reads. The local loopback Hub URL works only on the developer
machine. Production and the account remap script use the remote Hub at `https://hub.germanquantum.tech`.

## Production Hub connection

Before configuring Vercel, the Hub team must provide a public HTTPS hostname on
the fixed Hetzner IP. Do not use a raw IP address: certificate validation and
key rotation depend on a stable hostname.

The v1 network boundary is HTTPS plus a scoped, revocable Hub bearer key. Do
not allowlist Vercel egress IPs for this deployment: these routes run on the
Edge runtime and the design does not rely on static egress addresses. The Hub
server should expose only `80/443`; its API process and database remain private
to the server network.

### Vercel environment scopes

Configure variables in **Project Settings → Environment Variables**, not in
source control. Environment changes apply only to deployments created after the
change.

| Vercel scope | `PORTFOLIO_DATA_HUB_*` policy |
| --- | --- |
| Development | Local Hub URL and local development key are allowed. |
| Preview | Leave unset by default. A designated staging branch may use a separate, read-only staging Hub key and staging HTTPS URL. Never copy the Production key here. |
| Production | Set the public Hetzner HTTPS URL and a Production read-only consumer key. |

`PORTFOLIO_DATA_HUB_BASE_URL`, `PORTFOLIO_DATA_HUB_API_KEY`, and
`PORTFOLIO_DATA_HUB_TIMEOUT_MS` are server-only. Never prefix them with `VITE_`.
The Vercel function region remains intentionally unset in source until the
Hetzner and Hub Supabase locations are confirmed; select the closest available
EU region in Vercel at that point.

### Safe configuration preflight

Run this in the same environment used to deploy, after exporting only the
server environment variables. It validates configuration shape and placement without
contacting the Hub or printing URLs, keys, or other values:

```bash
npm run hub:preflight:production
```

In a local shell that intentionally loads `.env.local`:

```bash
set -a; source .env.local; set +a
npm run hub:preflight
```

The command fails if a Hub variable uses a `VITE_` prefix, a production Hub URL
is not HTTPS, required configuration is missing, or the timeout is invalid. It
does not contact the Hub and does not verify the key's permissions; verify the
exact `data:read` scope separately in Hub key management.

On Vercel this runs automatically as a deploy gate: `vercel.json` sets the
build command to run `hub:preflight:production` before `npm run build`, gated
to `VERCEL_ENV=production` so it fires only on Production deploys (Preview and
Development builds, where the Hub vars are intentionally unset, skip it). A
failing preflight fails the Production build, so a misconfigured Hub connection
can never ship. The Hub/Supabase variables must be set with **Production** scope
in Vercel for the build to see them.

### Direct Hub contract/parser smoke

This opt-in test directly calls the configured Hub URL with its consumer key,
then parses a mapped test account's summary, latest positions, and first ledger
page. It does not print credentials. Supabase
authentication and portal-client mapping are intentionally stubbed in this
test, so it is **not** an end-to-end
portal deployment check. Run it only from a trusted shell or CI secret context:

```bash
set -a; source .env.local; set +a
export PORTFOLIO_DATA_HUB_TEST_ACCOUNT_ID=<mapped-hub-account-uuid>
npm run test:portfolio-data-hub:direct
```

For Production direct-contract acceptance, supply the Production server
variables and a known mapped account ID through the secret store—not through
command history, source files, browser variables, or screenshots. The signed-in
browser acceptance checklist below remains the portal end-to-end check.

The Hub deployment runbook must separately prove that public Hub reads reject
both a missing key and an invalid key (normally `401` or `403`). The portal does
not issue uncredentialed browser-to-Hub calls, so this negative test belongs in
the Hub's public API smoke check rather than this direct parser check.

### Key rotation

1. Create a new Hub consumer key with exactly the `data:read` scope.
2. Replace `PORTFOLIO_DATA_HUB_API_KEY` in Vercel **Production**.
3. Redeploy Production, run the preflight, and run the direct Hub contract/parser smoke.
4. Verify the signed-in portal account still loads overview, positions, and ledger.
5. Revoke the old Hub key only after the new deployment is verified.

### Remote Hub cutover (hub.germanquantum.tech)

Direct production switch. The old Hub stays reachable until the new one is
verified, so rollback is immediate.

**Preconditions**
- The new `PORTFOLIO_DATA_HUB_API_KEY` has exactly the `data:read` scope,
  verified in Hub key management; no additional scope is required.
- A reviewer has an `expected.json` of known figures — one row per client:
  `{ client_id, currency, component_scope, field, expected, tolerance }`.

**Cutover**
1. Set Production `PORTFOLIO_DATA_HUB_BASE_URL=https://hub.germanquantum.tech`
   and the new `PORTFOLIO_DATA_HUB_API_KEY`. Redeploy.
2. `npm run hub:preflight:production` — expect a pass with no printed values.
3. Build the mapping (read-only): `npm run hub:remap -- build --out mapping.json`.
   Resolve every CONFLICT until the run is clean, then **have a human review
   `mapping.json`** (each `old -> new`, venue, external id).
4. Apply: `npm run hub:remap -- apply --input mapping.json`. This writes
   `rollback.json` (a pre-write snapshot) before any change and applies each
   mapping through the audited `admin_set_client_hub_account_mapping` RPC.
5. Verify: `npm run hub:remap -- verify --input mapping.json --expected expected.json`.
   Every client must report `OK`.
6. Smoke-test one real client login end-to-end (overview, positions, ledger),
   and the direct parser check: `npm run test:portfolio-data-hub:direct` with
   `PORTFOLIO_DATA_HUB_TEST_ACCOUNT_ID` set to a mapped new account UUID.
7. Monitor. Decommission the old Hub only after a soak period.

**Rollback**
- Data: `npm run hub:remap -- rollback --input rollback.json` restores every
  client's prior `hub_account_id` (also recoverable from
  `client_account_config_audit`).
- Config: restore the previous Production `PORTFOLIO_DATA_HUB_BASE_URL` and key,
  then redeploy.

`mapping.json`, `rollback.json`, and `expected.json` are operational artifacts —
never commit them.

If the Hub is unavailable, the portal must show its existing safe unavailable
state; it must not present stale data as current or disclose internal Hub
details.

## Project settings
- Framework preset: **Vite**
- Output directory: **dist**
- Root directory: **(empty)** (repo root)

## Build & verify
1) Push to your repo and open the Vercel deployment page.  
2) **Resources → Functions** should list:
   - `/api/deribit/ticker`
   - `/api/coincall/price`
   - `/api/portfolio-data-hub/summary`
   - `/api/portfolio-data-hub/summaries?fetched_from=<ISO>&fetched_to=<ISO>&limit=200`
   - `/api/portfolio-data-hub/positions`
   - `/api/portfolio-data-hub/ledger`
   - `/api/portfolio-data-hub/overview`
3) Test in the browser (replace domain):
   ```
   https://<your-app>.vercel.app/api/deribit/ticker?instrument_name=BTC-27DEC25-50000-C
   https://<your-app>.vercel.app/api/coincall/price?symbol=BTCUSD-27DEC25-50000-C
   ```
4) In the app → DevTools → Network while clicking **Get Live Marks** you should see those same two endpoints.

## Portfolio production acceptance

After promoting a known-good deployment to Production, sign in as the mapped
DWF test client and verify:

1. Dashboard loads summary and positions through the portal's same-origin API routes.
2. Positions use their snapshot pagination and ledger initially shows 50 newest entries; **Load more** retrieves the next ledger page.
3. Summary and positions display independent provenance. When run IDs differ, the UI identifies the view as mixed-age and does not imply the datasets are run-aligned.
4. Reporting currency is shown as configured, and the selector remains limited to summary currencies.
5. Refresh works after a normal Hub collection run.
6. An expired portal session asks the user to sign in again rather than exposing portfolio data.
7. Temporarily unreachable Hub requests display the safe unavailable state; restore connectivity afterwards.
8. Browser DevTools shows requests only to `/api/portfolio-data-hub/*`; no Hub key or direct Hub request appears. Normalized performance responses include `accountId` as a routing identifier, so it can appear in the browser response. It is not a credential. Verify that the browser cannot choose the account ID and that unauthorized users receive no mapping or performance response.

### Performance route acceptance

The portal endpoint is `GET /api/portfolio-data-hub/performance`. The server
resolves the Hub account exclusively from the authenticated caller's RLS-visible
`public.clients.hub_account_id`, then requests only
`GET /api/v1/accounts/{mapped_hub_account_id}/performance/latest`. The browser
does not supply the Hub account ID and ordinary portal traffic never enumerates
Hub accounts.

The first release loads performance when the view is opened and supports a
manual **Refresh** action. It does not poll in the background or refresh on
focus. Refresh sends the portal's integrity-protected ETag token as
`If-None-Match`. The portal translates it to the Hub's upstream ETag. A valid
portal `304` has no JSON body: the client retains its last valid cached
performance response and does not parse the response as JSON. A `304` without
a matching cached response is an error and must not create empty or fabricated
performance data.

After authentication and RLS mapping resolution, portal error responses include
`X-Portfolio-Hub-Account-Id` as a non-secret cache-binding value. The browser
retains a last valid response after a transient failure only when this value
matches the cached response account. A missing or different value evicts the
cache, preventing data from a prior mapping remaining visible. Unauthenticated,
unlinked, and unmapped responses do not include this header or the target account
ID.

Portal error codes remain explicit even when the Hub's original status differs:

| Portal code | Meaning | Client behavior |
| --- | --- | --- |
| `HUB_AUTHORIZATION_FAILED` | Hub rejected the server credential (`401`/`403`) | Show unavailable; do not retry automatically |
| `HUB_ACCOUNT_NOT_FOUND` | Mapped account is not available (`404`) | Show unavailable; do not retry automatically |
| `HUB_RATE_LIMITED` | Hub rate limit (`429`) | Show rate-limited state; accept only a validated `Retry-After`; no automatic retry |
| `HUB_UNAVAILABLE` | Other upstream/network failure, including `5xx` | Show unavailable; no automatic retry |
| `UPSTREAM_TIMEOUT` | Hub request timed out | Show unavailable; no automatic retry |
| `HUB_INVALID_RESPONSE` | Invalid contract, account mismatch, or unsupported conditional response | Show unavailable; do not retry automatically |

Only `HUB_RATE_LIMITED` may carry `Retry-After`. The portal forwards it only
when it is a valid bounded delay/date; the client ignores malformed or
out-of-range values. The user can manually refresh after the indicated time.

For live positive and negative acceptance, use the deployed Production URL and
two separate authenticated sessions:

1. Sign in as the intended authorized test identity. Confirm its RLS-visible
   client mapping resolves exactly one client and the browser receives only
   that mapped account's performance through the portal endpoint.
2. Inspect gateway request evidence to confirm the only Hub performance request
   is the exact mapped `/api/v1/accounts/{id}/performance/latest` path. Confirm
   there are no account list or enumeration requests. Do not capture credentials
   or financial payloads.
3. Sign in as an unauthorized identity with no mapping to that account. Confirm
   it resolves no mapping, the portal returns no performance data, and no Hub
   performance request is triggered.
4. Verify an authorized manual refresh sends `If-None-Match`; a `304` retains
   the last valid displayed values. Verify stale, provisional, unavailable, and
   recalculation-pending states remain explicit and null financial values are
   not rendered as zero.
5. In Hub key management, inspect the exact key configured in Vercel Production
   and confirm its scope set is exactly `data:read`. Record only the result and
   a non-secret key reference.

Record the deployment URL and commit, test outcomes, positive/negative login
results, and key-scope confirmation without personal information, JWTs, API
keys, or performance payloads.

## Local development
### Option A — `vercel dev` (preferred)
Runs the app and Edge functions locally under `/api`.
```bash
npm i
vercel dev
```

Portfolio Data Hub routes require `vercel dev`; the plain Vite proxy does not
execute files under `api/`. Requests must include the signed-in user's access
token as `Authorization: Bearer <Supabase JWT>`.

Dataset behavior:

- `summary`: latest account summary.
- `positions`: latest position snapshot; `limit` defaults to 200 and supports an
  opaque `cursor`.
- `ledger`: newest ledger page; `limit` defaults to 50 and supports `cursor` plus
  the documented Hub filters.
- `overview`: summary and positions together with `runAligned`/`mixedAge`, both
  run IDs, and both collection timestamps. Each dataset retains its own quality
  and provenance; the server does not imply coherence when run IDs differ.

### Option B — `npm run dev` (vite proxy)
If you only use Vite dev, the client falls back to proxies:
```ts
// vite.config.ts
server: {
  proxy: {
    '/coincall': {
      target: 'https://api.coincall.com',
      changeOrigin: true,
      rewrite: p => p.replace(/^\/coincall/, ''),
    },
    '/deribit': {
      target: 'https://www.deribit.com/api/v2',
      changeOrigin: true,
      rewrite: p => p.replace(/^\/deribit/, ''),
    },
  },
}
```

## Troubleshooting
**404 (HTML) from Vercel**  
→ You’re hitting a deployment that doesn’t include the function. Use that deployment’s **Visit** URL and confirm the route exists under **Resources → Functions**.

**Coincall `{ code: 40034 }`**  
→ Symbol string doesn’t exist (routing OK). Ensure `DDMONYY` **without leading zero** for day and `USD` suffix. Example: `BTCUSD-27DEC25-50000-C`.

**Deribit “instrument not found”**  
→ Instrument format: `UNDERLYING-DMONYY-STRIKE-C|P`, day **without leading zero**. Example: `BTC-27DEC25-50000-C`.

**Symbols from the UI**  
→ Hover the **Mark** cell in the table to copy the exact symbol/instrument queried.

## Production domains
Promote a known-good preview to **Production** so your main domain always points to a stable commit with both Edge routes.
