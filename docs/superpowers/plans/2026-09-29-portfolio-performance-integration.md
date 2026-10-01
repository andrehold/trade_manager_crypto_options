# Portfolio Data Hub Performance Integration — Implementation Plan

> **For agentic workers:** Execute test-first and in dependency order. All agents share one
> worktree. The Sol lead owns integration, commits, live operations, and the final deployment.
> Supporting agents edit only their assigned files, do not commit, and report changed files,
> test results, and unresolved concerns.

**Goal:** Add a secure, account-mapped Portfolio Data Hub performance integration with exact
contract validation, independent equity/performance states, conditional ETag reads, honest UI
semantics, audited test-identity repair, live authorization proof, and Production deployment
evidence.

**Architecture:** Extend the existing authenticated Hub gateway with one account-scoped
`performance/latest` request. The server resolves the Hub account only through the caller's
RLS-visible `public.clients.hub_account_id`, validates the complete Hub contract, rejects
account mismatches, and wraps the upstream ETag in a non-secret signed token bound to the
current user/client/account and normalizer version. The browser keeps a small identity-scoped
in-memory cache, performs initial load plus manual revalidation, and never polls automatically.
The UI renders equity and performance as independent state machines.

**Tech stack:** React 18, TypeScript, Zod, Decimal.js, Vercel Edge routes, Supabase Auth/RLS,
PostgreSQL migrations/RPCs, Vitest, Testing Library, Portfolio Data Hub Performance Contract
`0.1.0`.

**Design reference:**
`docs/superpowers/specs/2026-09-29-portfolio-performance-integration-design.md`

**Authoritative Hub artifacts:**

- `/Users/andreholschick/Desktop/portfolio-data-hub/docs/contracts/performance/openapi.json`
- `/Users/andreholschick/Desktop/portfolio-data-hub/docs/contracts/performance/single-account-example.json`
- `/Users/andreholschick/Desktop/portfolio-data-hub/consumer_kit/performance_example.py`
- Sanitized provisional fixture: required from the Hub team before Task 4 acceptance

---

## Agent recommendation

### Default execution

Use **Sol (`gpt-6-sol`) with high reasoning** as the lead and end-to-end owner. If only one
agent is used, Sol executes the entire plan.

### Supporting assignments

| Work | Recommended agent | Why |
|---|---|---|
| Contract parser, gateway, ETag token, error semantics | **Sol · high** | Security-sensitive cross-layer reasoning and exact contract work |
| Conditional client/cache integration | **Sol · high** | Identity isolation and `304` correctness are critical |
| Performance UI and component tests | **Terra (`gpt-5.6-terra`) · high** | Bounded product/UI implementation with substantial judgment |
| Contract/fixture import and documentation edits | **Luna (`gpt-6-luna`) · medium** | Mechanical, well-scoped changes after interfaces are frozen |
| Identity audit migration and repair operation | **Sol · high** | Privileged mutation, rollback, and audit guarantees |
| Independent final review | **Terra · xhigh** | Fresh read-only review of code, tests, and evidence |
| Production promotion and live acceptance | **Sol · high** | Requires exact operational sequencing and stop conditions |

Luna and Terra are optional accelerators, not alternative owners of the security-critical path.
The Sol lead reviews every supporting-agent diff before it enters a commit.

## Execution waves

1. **Wave 0 — Sol lead:** Task 0 baseline and artifact gate.
2. **Wave 1 — Luna then Sol:** Luna performs only Task 1 artifact import; Sol reviews it and
   implements Task 2 schemas/normalizers after the provisional fixture is available.
3. **Wave 2 — Sol:** Tasks 3 and 4 are sequential because the client contract depends on the
   server's final ETag/error contract.
4. **Wave 3 — Terra:** Task 5 UI begins only after the normalized client/hook interface is green.
5. **Wave 4 — Sol and Luna, disjoint files:** Sol performs Task 6 identity audit/repair tooling;
   Luna performs Task 7 documentation/preflight changes. Sol integrates both.
6. **Wave 5 — Terra review, then Sol:** Task 8 review and verification.
7. **Wave 6 — Sol only:** Task 9 privileged live validation and Production deployment.

Do not run multiple agents against `server.ts`, `client.ts`, `usePortfolioDataHub.ts`, or
`HubPortfolioView.tsx` concurrently.

---

## Global constraints

- The Hub account ID comes only from the authenticated caller's single RLS-visible
  `public.clients.hub_account_id`.
- Normal portal traffic never calls `/api/v1/data/accounts` or another account-list endpoint.
- The browser cannot provide a Hub account ID, client ID, policy, currency, or calculation input
  for the performance request.
- The Hub key remains server-only and must have exactly `data:read` in Production.
- `revision` and `lineage.policy_revision` accept only integer or null when present. Reject
  strings, floats, and coercion.
- All financial values remain exact decimal strings. Null is not zero.
- Top-level `opening_equity` is the display source. If it and
  `performance.opening_equity` are both non-null, exact-decimal values must agree.
- Equity and performance statuses are independent. Unavailable performance cannot hide ready
  equity.
- Status and freshness fields are strict enums. Unknown non-empty reason codes are accepted and
  use safe generic UI copy.
- `quality.details` is opaque internal data and is never displayed or logged.
- A Hub `304` has no JSON body and must never enter JSON/schema parsing.
- The signed browser ETag token is non-secret and integrity-protected, not encrypted.
- The first release performs initial load and manual refresh only. No polling, background retry,
  focus-triggered refresh, or automatic rate-limit retry.
- Logs must exclude payloads, financial values, ETags/tokens, authorization headers, API keys,
  JWTs, passwords, and complete Auth metadata.
- Never print or commit live credentials, personal information, real performance figures, JWTs,
  or secret operational files.

## Planned commits

1. `test(hub): pin performance contract fixtures`
2. `feat(hub): validate performance contract`
3. `feat(hub): add mapped performance gateway`
4. `feat(portal): add conditional performance client`
5. `feat(portal): render performance quality states`
6. `feat(auth): audit trusted client claim repairs`
7. `docs(hub): document performance deployment controls`
8. Final corrections, if review finds issues, as focused commits rather than squashing evidence.

---

## Task 0: Establish a clean baseline and prerequisite gate

**Owner:** Sol · high
**Files:** No product changes.

- [ ] **Step 1: Preserve current planning work**

  ```bash
  git status --short --branch
  git diff --check
  ```

  Preserve unrelated user changes. Commit the approved design and plan before creating an
  implementation branch from the latest intended base. Do not use destructive reset/checkout.

- [ ] **Step 2: Record the repository baseline**

  ```bash
  npm run typecheck
  npm test
  npm run build
  ```

  Expected: existing typecheck, tests, and production build pass. Record pre-existing failures;
  do not weaken tests to conceal them.

- [ ] **Step 3: Verify authoritative artifacts**

  Confirm the supplied OpenAPI contains:

  - `/api/v1/accounts/{account_id}/performance/latest`;
  - `PerformanceDatapointView`;
  - `PerformanceTotalsView`;
  - `PerformanceQualityView`;
  - `PerformanceLineageView`;
  - integer-or-null `revision` and `policy_revision`.

  Confirm the ready fixture contains the seven performance totals and matching opening equity.
  Obtain the sanitized provisional fixture before declaring Task 5/UI acceptance complete.

**Gate:** Baseline is recorded and artifacts are available. Stop if the provisional fixture or
OpenAPI revision is ambiguous; do not invent a fixture from prose.

---

## Task 1: Pin Hub contract artifacts in the target repository

**Owner:** Luna · medium; Sol reviews and commits
**Files:**

- Create: `src/lib/portfolioDataHub/contract/performance.openapi.json`
- Create: `src/lib/portfolioDataHub/__fixtures__/performance/ready.json`
- Create: `src/lib/portfolioDataHub/__fixtures__/performance/provisional.json`
- Create: `src/lib/portfolioDataHub/__fixtures__/performance/unavailable.json`
- Modify: `src/lib/portfolioDataHub/__tests__/canonicalV1.test.ts`

- [ ] **Step 1: Copy, sanitize, and document provenance**

  Pin the supplied performance path and its referenced schemas, or the full supplied OpenAPI,
  without changing types. Copy the ready fixture after removing request wrappers and replacing
  any real IDs/figures with structurally valid synthetic values. Import the Hub-supplied
  provisional fixture the same way. Create a synthetic unavailable fixture matching the
  authoritative schema and `policy_not_configured` behavior.

  Fixtures use reserved synthetic UUIDs and figures only. Do not copy the real mapped account
  ID or live financial values.

- [ ] **Step 2: Add a contract-presence test**

  Extend the contract test to prove the pinned path references `PerformanceDatapointView` and
  both revision fields are integer-or-null. This test guards accidental hand-editing of the
  pinned contract.

- [ ] **Step 3: Run the focused gate**

  ```bash
  npx vitest run src/lib/portfolioDataHub/__tests__/canonicalV1.test.ts
  git diff --check
  ```

**Agent handoff:** Luna reports source artifact hashes, sanitization performed, changed files,
and test result. Sol compares the pinned schema to the source before committing.

---

## Task 2: Implement the raw schema and normalized performance model

**Owner:** Sol · high
**Files:**

- Modify: `src/lib/portfolioDataHub/schemas.ts`
- Modify: `src/lib/portfolioDataHub/normalizers.ts`
- Modify: `src/lib/portfolioDataHub/index.ts`
- Create: `src/lib/portfolioDataHub/__tests__/performanceContract.test.ts`

- [ ] **Step 1: Write failing contract tests**

  Cover:

  - ready, provisional, and unavailable fixtures;
  - exact totals: `opening_equity`, `contributions`, `distributions`, `transfers_in`,
    `transfers_out`, `net_capital_flow`, `pnl`;
  - integer/null/omitted revisions and rejection of string/fractional revisions;
  - exact decimal validation, including null, zero, negative zero, and malformed values;
  - strict `ready | provisional | unavailable` status enums;
  - strict `fresh | stale | unknown` freshness;
  - known and unknown non-empty reason codes; reject empty codes;
  - complete quality and lineage normalization;
  - unequal non-null top-level/nested opening equity rejection;
  - preservation of `quality.details` internally without interpreting it.

- [ ] **Step 2: Implement exact schemas**

  Add Zod schemas mirroring the pinned OpenAPI optionality/defaults. Reuse
  `exactDecimalSchema`; do not use `z.coerce`, `Number`, or `parseFloat`. Normalize documented
  omitted nullable/defaulted fields to null/defaults, never zero.

- [ ] **Step 3: Implement browser-safe normalized types**

  Export a stable camelCase `HubPerformance` type with independent equity/performance statuses,
  exact decimals, quality, and lineage. Retain `details` only in an internal field that UI types
  do not consume, or omit it from the browser-safe normalizer entirely if no internal consumer
  needs it.

- [ ] **Step 4: Run the gate**

  ```bash
  npx vitest run \
    src/lib/portfolioDataHub/__tests__/performanceContract.test.ts \
    src/lib/portfolioDataHub/__tests__/canonicalV1.test.ts
  npm run typecheck
  ```

**Commit:** `feat(hub): validate performance contract`

---

## Task 3: Add the mapped server route, error semantics, and signed ETag token

**Owner:** Sol · high
**Files:**

- Modify: `src/lib/portfolioDataHub/server.ts`
- Create: `api/portfolio-data-hub/performance.ts`
- Modify: `src/lib/portfolioDataHub/__tests__/server.test.ts`
- Optionally create: `src/lib/portfolioDataHub/__tests__/performanceToken.test.ts`

- [ ] **Step 1: Write failing authorization and URL tests**

  Add tests named to prove:

  - `requests only the RLS-mapped performance/latest endpoint`;
  - no browser account/client query changes the exact Hub URL;
  - no normal request calls `/api/v1/data/accounts`;
  - a different-account response returns `502 HUB_INVALID_RESPONSE`;
  - unauthenticated, unauthorized, and unmapped requests trigger zero Hub calls;
  - ready, provisional, and unavailable `200` payloads are accepted.

- [ ] **Step 2: Write failing upstream-error tests**

  Assert:

  - Hub `401/403` → `502 HUB_AUTHORIZATION_FAILED`;
  - Hub `404` → `502 HUB_ACCOUNT_NOT_FOUND`;
  - Hub `429` → `503 HUB_RATE_LIMITED` with only a validated `Retry-After`;
  - timeout → `504 UPSTREAM_TIMEOUT`;
  - other network/`5xx` → `502 HUB_UNAVAILABLE`;
  - invalid contract/account → `502 HUB_INVALID_RESPONSE`.

- [ ] **Step 3: Write failing ETag-token tests**

  Define one version constant for the performance normalizer. The signed non-secret payload is:

  ```ts
  {
    version: 1,
    authUserId,
    clientId,
    hubAccountId,
    upstreamEtag,
    normalizerVersion,
  }
  ```

  Prove same-context tokens forward only `upstreamEtag`; tampered, cross-user, cross-client,
  cross-account, wrong-token-version, and wrong-normalizer-version tokens force an unconditional
  Hub read. Do not describe the token as encrypted or confidential.

- [ ] **Step 4: Implement conditional request handling**

  Validate `If-None-Match` length and control characters. Resolve auth/mapping before validating
  its context. On Hub `200`, parse and account-check before issuing a quoted portal ETag. On Hub
  `304`, return an empty `304` with the same portal ETag and never call JSON/schema parsing.

- [ ] **Step 5: Implement safe structured logging**

  Log only correlation ID, route, portal error code, upstream status class, and latency. Add a
  test logger dependency or spy proving that payloads, financial values, raw/portal ETags,
  authorization headers, and configured secrets never appear.

- [ ] **Step 6: Run the gate**

  ```bash
  npx vitest run \
    src/lib/portfolioDataHub/__tests__/performanceContract.test.ts \
    src/lib/portfolioDataHub/__tests__/performanceToken.test.ts \
    src/lib/portfolioDataHub/__tests__/server.test.ts
  npm run typecheck
  ```

  Omit the optional test path if token tests remain in `server.test.ts`.

**Commit:** `feat(hub): add mapped performance gateway`

---

## Task 4: Add the conditional browser client and identity-scoped cache

**Owner:** Sol · high
**Files:**

- Modify: `src/lib/portfolioDataHub/client.ts`
- Modify: `src/lib/portfolioDataHub/__tests__/client.test.ts`
- Modify or create: `src/features/clientPortal/usePortfolioDataHub.ts`
- Modify: `src/features/clientPortal/__tests__/usePortfolioDataHub.test.tsx`

- [ ] **Step 1: Write failing client tests**

  Prove the client calls only `/api/portfolio-data-hub/performance`, sends the Supabase bearer
  token, sends `If-None-Match` only when supplied by a matching cache entry, and branches on
  `304` before any JSON read.

  Use a result union:

  ```ts
  type ConditionalResult<T> =
    | { status: 'updated'; data: T; etag: string | null }
    | { status: 'not-modified'; etag: string | null }
  ```

- [ ] **Step 2: Write failing hook/cache tests**

  Cover:

  - cache key includes authenticated user ID, client ID, and response account ID;
  - `304` preserves the same valid object and state;
  - cacheless `304` makes one unconditional recovery request;
  - sign-out, user switch, client switch, or account change evicts/ignores old data;
  - late responses from an old generation cannot overwrite the current identity;
  - initial load and manual refresh only—no intervals, focus refresh, or automatic retry;
  - permanent portal error codes do not offer automatic retry;
  - rate limiting validates `Retry-After` and disables manual refresh without scheduling a call;
  - transport failure retains last valid data with refresh-failed state.

- [ ] **Step 3: Implement the client and hook**

  Keep the cache in memory. Never use localStorage, sessionStorage, service-worker cache, or a
  shared query key lacking the full identity tuple. Keep manual refresh non-overlapping.

- [ ] **Step 4: Run the gate**

  ```bash
  npx vitest run \
    src/lib/portfolioDataHub/__tests__/client.test.ts \
    src/features/clientPortal/__tests__/usePortfolioDataHub.test.tsx
  npm run typecheck
  ```

**Commit:** `feat(portal): add conditional performance client`

---

## Task 5: Render independent performance-quality states

**Owner:** Terra · high; Sol reviews and commits
**Files:**

- Modify: `src/features/clientPortal/components/HubPortfolioView.tsx`
- Create or modify: focused performance presentation component(s)
- Modify: `src/features/clientPortal/components/__tests__/HubPortfolioView.test.tsx`
- Modify: `src/features/clientPortal/__tests__/ClientPortalShell.test.tsx`

- [ ] **Step 1: Freeze the presentation input with Sol**

  Terra begins only after Task 4 exports are reviewed. Keep UI components pure where possible;
  they receive normalized performance state and refresh callbacks, not raw responses or auth.

- [ ] **Step 2: Write failing state-matrix tests**

  Cover at minimum:

  - equity ready + performance unavailable keeps equity visible;
  - equity unavailable + performance ready does not substitute summary equity;
  - ready, provisional, and unavailable for each block;
  - stale and unknown freshness;
  - recalculation pending combined with every availability state;
  - null renders `—` and exact zero renders formatted zero;
  - top-level opening equity is displayed, never the nested field directly;
  - known reason code uses approved copy;
  - unknown non-empty reason code uses generic copy without raw interpolation;
  - `quality.details` never appears;
  - refresh failure keeps the last valid result visibly marked;
  - rate-limited refresh control remains disabled until the validated time.

- [ ] **Step 3: Implement UI composition**

  Add separate equity and performance blocks. Preserve existing summary, positions, risk,
  currency selection, and provenance behavior. Do not derive missing performance values from
  summary components.

- [ ] **Step 4: Run the gate**

  ```bash
  npx vitest run \
    src/features/clientPortal/components/__tests__/HubPortfolioView.test.tsx \
    src/features/clientPortal/__tests__/ClientPortalShell.test.tsx
  npm run typecheck
  ```

**Agent handoff:** Terra reports the full state matrix covered and any copy still awaiting
approval. Sol reviews accessibility, null/zero behavior, and independent status handling.

**Commit:** `feat(portal): render performance quality states`

---

## Task 6: Add identity-repair audit storage and administrative tooling

**Owner:** Sol · high
**Files:**

- Create: `supabase/migrations/<timestamp>_auth_identity_admin_audit.sql`
- Create: `scripts/repair-portal-client-claim.mjs`
- Create: `scripts/repair-portal-client-claim.test.mjs`
- Modify: `package.json`
- Modify: `docs/DATABASE.md`

- [ ] **Step 1: Write the migration and SQL acceptance assertions**

  Create `public.auth_identity_admin_audit` with the design-specified fields. Enable RLS with no
  client policy. Add an append-only security-definer RPC executable only by `service_role`, and
  an admin-read policy. Store no email, JWT, password, API key, or full metadata object.

  Add SQL acceptance coverage proving clients cannot read/insert, administrators can read, the
  service role can append, and rows cannot be updated/deleted through exposed roles.

- [ ] **Step 2: Write failing repair-script tests**

  The script requires explicit subject user ID, target client ID, expected mapped Hub account ID,
  and change reference. Cover dry run, preservation of unrelated `app_metadata`, refusal to use
  `user_metadata`, target mapping mismatch, successful Auth update + audit append, audit failure
  rollback, and secret-safe output.

- [ ] **Step 3: Implement a dry-run-first operation**

  Default to dry run. Require an explicit `--apply` flag. Sequence:

  1. Read current Auth app metadata administratively.
  2. Verify the target client uniquely maps to the expected Hub account.
  3. Merge only `app_metadata.client_id`, preserving trusted claims.
  4. Append the portal audit row.
  5. Revoke/refresh the old session according to the approved Supabase operation.
  6. If audit append fails, restore prior metadata and record rollback where possible.

  Output only anonymous step names, audit/change reference, and pass/fail.

- [ ] **Step 4: Run the gate**

  ```bash
  npx vitest run scripts/repair-portal-client-claim.test.mjs
  npm run typecheck
  ```

  Run the repository's existing Supabase acceptance mechanism for the migration before any live
  Auth update.

**Commit:** `feat(auth): audit trusted client claim repairs`

---

## Task 7: Update deployment, security, and operator documentation

**Owner:** Luna · medium; Sol reviews and commits
**Files:**

- Modify: `.env.example`
- Modify: `docs/DEPLOY.md`
- Modify: `docs/DATABASE.md` only if Task 6 has not already completed its section
- Modify: `scripts/portfolio-data-hub-preflight.mjs`
- Modify: `scripts/portfolio-data-hub-preflight.test.mjs`

- [ ] **Step 1: Update the route and browser-boundary documentation**

  Add `/api/portfolio-data-hub/performance`, conditional-read semantics, live positive/negative
  acceptance, and the exact-key-scope gate. Replace the false “no routing ID reaches the browser”
  statement with the approved wording: account IDs may be present in normalized payloads, but
  the browser cannot choose them and the server verifies them against RLS-visible mapping.

- [ ] **Step 2: Document refresh and error semantics**

  Record initial load + manual refresh only, no polling, distinct portal error codes, validated
  rate-limit handling, and cacheless-`304` recovery.

- [ ] **Step 3: Strengthen preflight wording/tests**

  Keep the key server-only. Document that preflight proves configuration placement/shape but
  cannot prove the deployed key's scope; exact `data:read` verification comes from Hub key
  management.

- [ ] **Step 4: Run the gate**

  ```bash
  npx vitest run scripts/portfolio-data-hub-preflight.test.mjs
  npm run hub:preflight
  git diff --check
  ```

**Commit:** `docs(hub): document performance deployment controls`

---

## Task 8: Independent review and complete local verification

**Review owner:** Terra · xhigh, read-only
**Correction/integration owner:** Sol · high

- [ ] **Step 1: Run a focused review**

  Terra reviews the completed diff against every design invariant, with special attention to:

  - browser influence over account routing;
  - account enumeration;
  - schema permissiveness/coercion;
  - account mismatch checks;
  - ETag cross-user/account/normalizer reuse;
  - `304` JSON parsing;
  - independent status rendering;
  - null/zero confusion;
  - automatic polling/retry;
  - log/response secret exposure;
  - privileged identity-repair rollback and audit behavior.

  The review agent edits nothing and returns findings with file/line evidence and severity.

- [ ] **Step 2: Sol resolves findings**

  Apply focused corrections and add regression tests for every accepted finding. Do not dismiss a
  security finding solely because the happy path passes.

- [ ] **Step 3: Run targeted verification**

  ```bash
  npx vitest run \
    src/lib/portfolioDataHub/__tests__/canonicalV1.test.ts \
    src/lib/portfolioDataHub/__tests__/performanceContract.test.ts \
    src/lib/portfolioDataHub/__tests__/server.test.ts \
    src/lib/portfolioDataHub/__tests__/client.test.ts \
    src/features/clientPortal/__tests__/usePortfolioDataHub.test.tsx \
    src/features/clientPortal/components/__tests__/HubPortfolioView.test.tsx \
    src/features/clientPortal/__tests__/ClientPortalShell.test.tsx \
    scripts/repair-portal-client-claim.test.mjs \
    scripts/portfolio-data-hub-preflight.test.mjs
  ```

- [ ] **Step 4: Run full verification**

  ```bash
  npm run typecheck
  npm test
  npm run build
  npm run hub:preflight:production
  git diff --check
  git status --short
  ```

  Run production preflight with server variables supplied securely. Do not place secrets in the
  command line, test output, or shell history.

**Gate:** Clean worktree except intentional committed changes; all focused/full checks pass.

---

## Task 9: Privileged live acceptance and Production deployment

**Owner:** Sol · high
**Supporting agents:** None. Do not delegate privileged credentials, key inspection, or promotion.

- [ ] **Step 1: Verify the Production Hub key scope**

  In Hub key management, confirm the selected deployed key is active and its exact scope set is
  `['data:read']`. Record only an approved non-secret identifier/fingerprint, environment,
  timestamp, and reviewer. If extra scopes exist, rotate to a least-privilege key before deploy.

- [ ] **Step 2: Repair the intended authorized fixture identity**

  Run the claim-repair script in dry-run mode. Review the target user/client/account match and
  change reference, then apply. Refresh/revoke the old session and sign in again so the JWT
  contains the trusted `app_metadata.client_id`. Do not expose identities or tokens in output.

- [ ] **Step 3: Run live authorization tests before promotion**

  Authorized fixture must:

  - resolve exactly one RLS client;
  - map only to `bc0d0917-83a9-44e5-a447-f16fc9f4a5bf`;
  - receive only that account's normalized performance response;
  - make no account-listing call;
  - preserve data through a conditional `304`.

  Unauthorized fixture must receive no mapping, performance data, target ETag, or account ID.
  Report anonymous fixture names/statuses and pass/fail only.

- [ ] **Step 4: Create and identify the deployment commit**

  ```bash
  git status --short
  git rev-parse HEAD
  ```

  Push the reviewed commit through the repository's normal protected-branch workflow. Record the
  immutable commit SHA selected for Production.

- [ ] **Step 5: Deploy to Vercel Production**

  Verify the environment has the server-only Hub variables and the corrected Supabase settings.
  Promote only the deployment built from the recorded SHA. Do not infer this from branch name.

- [ ] **Step 6: Verify Vercel deployment metadata**

  Record:

  - Vercel environment `Production`;
  - Ready status;
  - immutable deployment URL and Production alias;
  - Git commit SHA matching the supplied implementation commit;
  - build completion and function presence for `/api/portfolio-data-hub/performance`.

- [ ] **Step 7: Run Production acceptance**

  Repeat authorized/unauthorized tests against the Production URL. Confirm ready/provisional/
  unavailable presentation as available from sanitized or controlled fixtures, manual ETag
  revalidation, no browser-to-Hub request, and no secret/payload leakage in browser or production
  logs.

- [ ] **Step 8: Deliver the validation record**

  Return:

  - implementation commit SHA;
  - deployed environment, immutable URL, and alias;
  - targeted/full test totals and commands;
  - anonymous authorized/unauthorized results;
  - exact deployed key scope confirmation without the key;
  - Vercel commit-match confirmation;
  - unresolved risks or an explicit statement that none remain.

## Stop conditions

Stop before Production promotion if any of the following is true:

- the provisional fixture is missing or differs from the pinned schema;
- any browser value can influence the Hub account path;
- a normal portal request enumerates accounts;
- revisions are coerced or financial values become numbers;
- opening-equity copies disagree without rejection;
- `304` is parsed as JSON or can reuse another context/normalizer's data;
- equity/performance states are collapsed;
- background polling or automatic retries remain;
- the authorized identity lacks the refreshed trusted claim;
- the unauthorized fixture receives any target data;
- the deployed key has any scope other than `data:read`;
- focused/full tests, typecheck, build, or Production preflight fail;
- Vercel cannot prove Production runs the recorded commit;
- secrets, personal information, payloads, or ETags appear in logs/evidence.
