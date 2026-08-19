# Remote Portfolio Data Hub Switch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repoint the portal gateway to the remote Portfolio Data Hub at `https://hub.germanquantum.tech` and safely remap every `clients.hub_account_id` to the new hub's account UUIDs, with a reviewed, auditable, reversible migration script.

**Architecture:** The app is already a hub-agnostic gateway; the remote hub speaks the same Canonical Contract v1 the Zod schemas already parse. So this is **config + data remap only** — no changes to `server.ts`, `client.ts`, `schemas.ts`, `normalizers.ts`, the `/api/portfolio-data-hub/*` routes, or the UI. A new dependency-free ESM script (`scripts/remote-hub-remap.mjs`, mirroring the `portfolio-data-hub-preflight.mjs` pattern) drives a four-phase flow: **build** a proposed mapping table from `GET /api/v1/data/accounts` joined to the `clients` table, a human reviews it, **apply** via the existing `admin_set_client_hub_account_mapping` RPC (capturing a rollback snapshot), **verify** each client against a known summary figure, and **rollback** on demand.

**Tech Stack:** Node ≥ 18 ESM (`.mjs`, no new deps — uses global `fetch`, `crypto` not needed), Vitest, Supabase PostgREST (`/rest/v1/rpc/...` and `/rest/v1/clients`), the Portfolio Data Hub v1 REST API.

## Global Constraints

Copied verbatim from the spec; every task's requirements implicitly include these.

- **Server-only Hub/Supabase secrets.** Hub and Supabase-secret variables must **never** carry a `VITE_` prefix.
- **No secrets in output.** The script and any log must never print URLs, API keys, bearer tokens, or Supabase keys. (Mirror the preflight's secret-safety test.)
- **HTTPS except loopback.** `PORTFOLIO_DATA_HUB_BASE_URL` must be an absolute HTTPS URL in production (loopback HTTP allowed only for local dev).
- **Exact decimals, never floats.** Monetary values arrive as exact decimal strings; compare them with integer-scaled `BigInt`, never `Number`/`parseFloat`.
- **No new migration.** The remap uses the existing `public.admin_set_client_hub_account_mapping(uuid, uuid, text)` RPC. Do not write a schema migration.
- **Human-review gate before any write.** `apply` operates only on a mapping file that a human produced from `build` and approved. No phase both derives and writes a mapping in one step.
- **Direct production cutover.** No Preview dry-run stage; the old hub stays reachable for rollback until production is verified and soaked.
- **Key scopes.** The new `PORTFOLIO_DATA_HUB_API_KEY` must carry the portal data-read scopes (data accounts, summaries, positions, ledger-events); `raw:read` is not required.

## File Structure

- `scripts/remote-hub-remap.mjs` — **create.** The remap CLI. Exports pure functions (`buildMappingTable`, `decimalWithinTolerance`, `verifyKnownFigure`, plus small helpers) and a guarded `main()` that performs all IO. One responsibility: orchestrate the four remap phases.
- `scripts/remote-hub-remap.test.mjs` — **create.** Vitest unit tests for every pure function. No network.
- `.env.example` — **modify.** Point the Hub example at the real host; add the service-role vars the remap script reads.
- `docs/DEPLOY.md` — **modify.** Update the Hub host guidance and add the remote-hub cutover + rollback runbook.

The gateway, schemas, normalizers, routes, and UI are intentionally **not** in this list — they need no change.

## Data artifacts (produced/consumed at run time, never committed)

- `mapping.json` — output of `build`, input to `apply` and `verify`. Array of:
  `{ client_id, client_name, old_hub_account_id, new_hub_account_id, hub_account_label, venue, external_account_identifier, match_status }`.
- `rollback.json` — output of `apply`. Array of `{ client_id, hub_account_id, hub_account_label }` snapshotted immediately before each write.
- `expected.json` — hand-authored input to `verify`. Array of:
  `{ client_id, currency, component_scope, field, expected, tolerance }` where `field` is `equity` or `balance`.

---

## Task 1: Config + docs for the new hub host

**Files:**
- Modify: `.env.example`
- Modify: `docs/DEPLOY.md:10-23` (Portfolio Data Hub environment) and `docs/DEPLOY.md:99-105` (add remote-hub context to key rotation).

**Interfaces:**
- Consumes: nothing.
- Produces: the env-variable vocabulary the remap script reads in later tasks — `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (fallback `SUPABASE_SERVICE_ROLE_KEY`), `PORTFOLIO_DATA_HUB_BASE_URL`, `PORTFOLIO_DATA_HUB_API_KEY`.

This task is documentation/config only; its deliverable is verified by the existing preflight and test suite rather than a new unit test (there is no code to test).

- [ ] **Step 1: Update `.env.example` Hub block**

Replace the server-only Hub block (currently defaulting to loopback) so the example names the real host and keeps the loopback note as a local-only aside. Replace:

```env
# Server-only Portfolio Data Hub connection. Never use a VITE_ prefix.
# Use the local loopback URL only for local development. Production must use the
# Hetzner Hub's public HTTPS hostname. Keep Preview unconfigured unless it uses
# a distinct, read-only staging Hub key.
PORTFOLIO_DATA_HUB_BASE_URL=http://127.0.0.1:8000
PORTFOLIO_DATA_HUB_API_KEY=
```

with:

```env
# Server-only Portfolio Data Hub connection. Never use a VITE_ prefix.
# Production and the remap script use the remote Hub's public HTTPS hostname.
# Use the local loopback URL (http://127.0.0.1:8000) only for local development.
# Keep Preview unconfigured unless it uses a distinct, read-only staging Hub key.
# The key must carry the portal data-read scopes (data accounts, summaries,
# positions, ledger-events); raw:read is not required.
PORTFOLIO_DATA_HUB_BASE_URL=https://hub.germanquantum.tech
PORTFOLIO_DATA_HUB_API_KEY=
```

- [ ] **Step 2: Confirm `.env.example` already documents the service-role vars the script needs**

The remap script reads `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (with legacy `SUPABASE_SERVICE_ROLE_KEY` accepted). These are already present in `.env.example` (the "Server only" block). No new lines are required; verify by reading the file that both `SUPABASE_URL` and `SUPABASE_SECRET_KEY` appear. If either is missing, add it under the existing server-only comment block.

- [ ] **Step 3: Update `docs/DEPLOY.md` Hub host guidance**

In the "Portfolio Data Hub environment" section, change the example host and the trailing sentence about Hetzner. Replace:

```env
PORTFOLIO_DATA_HUB_BASE_URL=https://hub.example.com
PORTFOLIO_DATA_HUB_API_KEY=<server-only bearer key>
```

with:

```env
PORTFOLIO_DATA_HUB_BASE_URL=https://hub.germanquantum.tech
PORTFOLIO_DATA_HUB_API_KEY=<server-only bearer key with portal data-read scopes>
```

Then replace the sentence:

> The local loopback Hub URL works only on the developer machine. Vercel requires the future reachable Hetzner HTTPS URL.

with:

> The local loopback Hub URL works only on the developer machine. Production and the account remap script use the remote Hub at `https://hub.germanquantum.tech`.

- [ ] **Step 4: Run the preflight against the new-style env**

Run:

```bash
PORTFOLIO_DATA_HUB_BASE_URL=https://hub.germanquantum.tech \
PORTFOLIO_DATA_HUB_API_KEY=placeholder-not-printed \
VITE_SUPABASE_URL=https://example.supabase.co \
VITE_SUPABASE_PUBLISHABLE_KEY=placeholder \
npm run hub:preflight:production
```

Expected: prints `Portfolio Data Hub production preflight passed. Values were not printed.` and exits 0.

- [ ] **Step 5: Run the full test suite to confirm nothing regressed**

Run: `npm run test`
Expected: PASS (all existing suites green; no new tests added by this task).

- [ ] **Step 6: Commit**

```bash
git add .env.example docs/DEPLOY.md
git commit -m "docs: point Hub config at hub.germanquantum.tech"
```

---

## Task 2: Mapping-table build logic (pure)

**Files:**
- Create: `scripts/remote-hub-remap.mjs`
- Test: `scripts/remote-hub-remap.test.mjs`

**Interfaces:**
- Consumes: nothing (pure data in / data out).
- Produces:
  - `buildMappingTable(clients, hubAccounts) -> { rows, conflicts }` where
    `clients` is `[{ client_id, client_name, hub_account_id, hub_account_label }]`,
    `hubAccounts` is `[{ id, label, venue, external_account_identifier, enabled }]`,
    `rows` is `[{ client_id, client_name, old_hub_account_id, new_hub_account_id, hub_account_label, venue, external_account_identifier, match_status }]`,
    and `conflicts` is `string[]` (human-readable blockers).
  - `match_status` is one of `'matched' | 'unmatched' | 'ambiguous'`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/remote-hub-remap.test.mjs`:

```js
import { describe, expect, it } from 'vitest'
import { buildMappingTable } from './remote-hub-remap.mjs'

const client = (over = {}) => ({
  client_id: '11111111-1111-4111-8111-111111111111',
  client_name: 'Acme',
  hub_account_id: 'old00000-0000-4000-8000-000000000001',
  hub_account_label: 'Acme Deribit Main',
  ...over,
})
const account = (over = {}) => ({
  id: 'new00000-0000-4000-8000-000000000001',
  label: 'Acme Deribit Main',
  venue: 'deribit',
  external_account_identifier: 'DBX-1',
  enabled: true,
  ...over,
})

describe('buildMappingTable', () => {
  it('matches one client to one enabled account by label', () => {
    const { rows, conflicts } = buildMappingTable([client()], [account()])
    expect(conflicts).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      client_id: '11111111-1111-4111-8111-111111111111',
      old_hub_account_id: 'old00000-0000-4000-8000-000000000001',
      new_hub_account_id: 'new00000-0000-4000-8000-000000000001',
      venue: 'deribit',
      external_account_identifier: 'DBX-1',
      match_status: 'matched',
    })
  })

  it('flags a client whose label matches no enabled account', () => {
    const { rows, conflicts } = buildMappingTable(
      [client({ hub_account_label: 'Unknown' })],
      [account()],
    )
    expect(rows[0].match_status).toBe('unmatched')
    expect(rows[0].new_hub_account_id).toBeNull()
    expect(conflicts.join('\n')).toContain('Acme')
  })

  it('flags an ambiguous label that matches two enabled accounts', () => {
    const { rows, conflicts } = buildMappingTable(
      [client()],
      [account(), account({ id: 'new00000-0000-4000-8000-000000000002', external_account_identifier: 'DBX-2' })],
    )
    expect(rows[0].match_status).toBe('ambiguous')
    expect(conflicts.join('\n')).toContain('ambiguous')
  })

  it('ignores disabled hub accounts when matching', () => {
    const { rows, conflicts } = buildMappingTable(
      [client()],
      [account({ enabled: false })],
    )
    expect(rows[0].match_status).toBe('unmatched')
    expect(conflicts).not.toEqual([])
  })

  it('flags one hub account claimed by two clients', () => {
    const { conflicts } = buildMappingTable(
      [client(), client({ client_id: '22222222-2222-4222-8222-222222222222', client_name: 'Beta' })],
      [account()],
    )
    expect(conflicts.join('\n')).toContain('claimed by more than one client')
  })

  it('skips clients that have no hub_account_label (never mapped)', () => {
    const { rows, conflicts } = buildMappingTable(
      [client({ hub_account_label: null, hub_account_id: null })],
      [account()],
    )
    expect(rows).toHaveLength(0)
    expect(conflicts).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/remote-hub-remap.test.mjs`
Expected: FAIL with "Cannot find module './remote-hub-remap.mjs'" / `buildMappingTable is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Create `scripts/remote-hub-remap.mjs`:

```js
#!/usr/bin/env node

/**
 * Remaps clients.hub_account_id to a new Portfolio Data Hub's account UUIDs.
 * Four phases: build, apply, verify, rollback. Pure logic is exported and
 * unit-tested; main() performs all IO. This script prints no secret values.
 */

const norm = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '')

/**
 * Join portal clients to new hub accounts by label (guarded by nothing else at
 * v1; venue is carried for human review). Only clients with a hub_account_label
 * are considered — an unlabeled client was never mapped and is out of scope.
 */
export function buildMappingTable(clients, hubAccounts) {
  const conflicts = []
  const enabled = hubAccounts.filter((a) => a.enabled)
  const byLabel = new Map()
  for (const account of enabled) {
    const key = norm(account.label)
    if (!byLabel.has(key)) byLabel.set(key, [])
    byLabel.get(key).push(account)
  }

  const rows = []
  for (const client of clients) {
    if (!client.hub_account_label) continue // never-mapped client; skip
    const matches = byLabel.get(norm(client.hub_account_label)) ?? []
    let match_status = 'matched'
    let account = null
    if (matches.length === 0) {
      match_status = 'unmatched'
      conflicts.push(`No enabled hub account matches client "${client.client_name}" (label "${client.hub_account_label}")`)
    } else if (matches.length > 1) {
      match_status = 'ambiguous'
      conflicts.push(`Label "${client.hub_account_label}" is ambiguous: matches ${matches.length} enabled hub accounts`)
    } else {
      account = matches[0]
    }
    rows.push({
      client_id: client.client_id,
      client_name: client.client_name,
      old_hub_account_id: client.hub_account_id ?? null,
      new_hub_account_id: account ? account.id : null,
      hub_account_label: client.hub_account_label,
      venue: account ? account.venue : null,
      external_account_identifier: account ? account.external_account_identifier : null,
      match_status,
    })
  }

  // A new account must not be claimed by more than one client.
  const claims = new Map()
  for (const row of rows) {
    if (!row.new_hub_account_id) continue
    if (!claims.has(row.new_hub_account_id)) claims.set(row.new_hub_account_id, [])
    claims.get(row.new_hub_account_id).push(row.client_name)
  }
  for (const [accountId, names] of claims) {
    if (names.length > 1) {
      conflicts.push(`Hub account ${accountId} is claimed by more than one client: ${names.join(', ')}`)
    }
  }

  return { rows, conflicts }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/remote-hub-remap.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/remote-hub-remap.mjs scripts/remote-hub-remap.test.mjs
git commit -m "feat: remap mapping-table build logic"
```

---

## Task 3: Exact-decimal tolerance + known-figure verification (pure)

**Files:**
- Modify: `scripts/remote-hub-remap.mjs`
- Test: `scripts/remote-hub-remap.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `decimalWithinTolerance(actual, expected, tolerance) -> boolean` — exact `BigInt`-scaled comparison; throws `Error` on non-plain-decimal input (e.g. exponent notation), which callers treat as "cannot auto-verify".
  - `verifyKnownFigure(summary, expectation) -> { ok: boolean, reasons: string[] }` where
    `summary` is a Hub `SummaryView` object (`{ venue, account_label, components: [{ currency, component_scope, equity, balance, ... }] }`)
    and `expectation` is `{ currency, component_scope, field, expected, tolerance, venue?, account_label? }`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/remote-hub-remap.test.mjs`:

```js
import { decimalWithinTolerance, verifyKnownFigure } from './remote-hub-remap.mjs'

describe('decimalWithinTolerance', () => {
  it('treats an exact match as within any non-negative tolerance', () => {
    expect(decimalWithinTolerance('12345.67', '12345.67', '0')).toBe(true)
  })
  it('accepts a difference at the tolerance boundary', () => {
    expect(decimalWithinTolerance('12345.67', '12345.00', '0.67')).toBe(true)
  })
  it('rejects a difference beyond tolerance', () => {
    expect(decimalWithinTolerance('12345.67', '12345.00', '0.50')).toBe(false)
  })
  it('compares large values exactly without float error', () => {
    // 20-digit integers differ by exactly 1; float would collapse them.
    expect(decimalWithinTolerance('10000000000000000001', '10000000000000000000', '0')).toBe(false)
    expect(decimalWithinTolerance('10000000000000000001', '10000000000000000000', '1')).toBe(true)
  })
  it('handles differing fractional lengths and signs', () => {
    expect(decimalWithinTolerance('-5.5', '-5.500', '0')).toBe(true)
  })
  it('throws on exponent notation so the caller falls back to manual review', () => {
    expect(() => decimalWithinTolerance('1e3', '1000', '0')).toThrow()
  })
})

describe('verifyKnownFigure', () => {
  const summary = {
    venue: 'deribit',
    account_label: 'Acme Deribit Main',
    components: [
      { currency: 'USD', component_scope: 'total', equity: '100000.00', balance: '99000.00' },
      { currency: 'BTC', component_scope: 'total', equity: '2.5', balance: '2.5' },
    ],
  }

  it('passes when the chosen component field is within tolerance and identity matches', () => {
    const result = verifyKnownFigure(summary, {
      currency: 'USD', component_scope: 'total', field: 'equity',
      expected: '100000.00', tolerance: '1.00', venue: 'deribit', account_label: 'Acme Deribit Main',
    })
    expect(result).toEqual({ ok: true, reasons: [] })
  })

  it('fails when the figure is out of tolerance', () => {
    const result = verifyKnownFigure(summary, {
      currency: 'USD', component_scope: 'total', field: 'equity', expected: '50000', tolerance: '1',
    })
    expect(result.ok).toBe(false)
    expect(result.reasons.join('\n')).toContain('equity')
  })

  it('fails when the expected venue does not match', () => {
    const result = verifyKnownFigure(summary, {
      currency: 'USD', component_scope: 'total', field: 'equity',
      expected: '100000.00', tolerance: '1', venue: 'coincall',
    })
    expect(result.ok).toBe(false)
    expect(result.reasons.join('\n')).toContain('venue')
  })

  it('fails when the requested component is absent', () => {
    const result = verifyKnownFigure(summary, {
      currency: 'EUR', component_scope: 'total', field: 'equity', expected: '1', tolerance: '1',
    })
    expect(result.ok).toBe(false)
    expect(result.reasons.join('\n')).toContain('component')
  })

  it('fails safe when the value cannot be compared (exponent form)', () => {
    const weird = { ...summary, components: [{ currency: 'USD', component_scope: 'total', equity: '1e5' }] }
    const result = verifyKnownFigure(weird, {
      currency: 'USD', component_scope: 'total', field: 'equity', expected: '100000', tolerance: '1',
    })
    expect(result.ok).toBe(false)
    expect(result.reasons.join('\n')).toContain('could not be compared')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/remote-hub-remap.test.mjs`
Expected: FAIL with `decimalWithinTolerance is not a function` / `verifyKnownFigure is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Append to `scripts/remote-hub-remap.mjs`:

```js
const PLAIN_DECIMAL = /^([+-]?)(\d+)(?:\.(\d+))?$/

function fracLen(value) {
  const match = PLAIN_DECIMAL.exec(String(value).trim())
  if (!match) throw new Error(`Not a plain decimal: ${value}`)
  return match[3] ? match[3].length : 0
}

/** Scale a plain decimal string to an integer BigInt at `scale` fractional digits. */
function scaledBigInt(value, scale) {
  const match = PLAIN_DECIMAL.exec(String(value).trim())
  if (!match) throw new Error(`Not a plain decimal: ${value}`)
  const negative = match[1] === '-'
  const intPart = match[2]
  const fracPart = (match[3] ?? '').padEnd(scale, '0').slice(0, scale)
  const magnitude = BigInt(intPart + fracPart)
  return negative ? -magnitude : magnitude
}

/** Exact |actual - expected| <= tolerance using integer scaling. */
export function decimalWithinTolerance(actual, expected, tolerance) {
  const scale = Math.max(fracLen(actual), fracLen(expected), fracLen(tolerance))
  const a = scaledBigInt(actual, scale)
  const e = scaledBigInt(expected, scale)
  const t = scaledBigInt(tolerance, scale)
  const diff = a > e ? a - e : e - a
  return diff <= t
}

/**
 * Assert a known summary figure and (optionally) the account identity.
 * Returns every failure reason so the operator sees the full picture.
 */
export function verifyKnownFigure(summary, expectation) {
  const reasons = []

  if (expectation.venue && norm(summary.venue) !== norm(expectation.venue)) {
    reasons.push(`venue mismatch: hub="${summary.venue}" expected="${expectation.venue}"`)
  }
  if (expectation.account_label && norm(summary.account_label) !== norm(expectation.account_label)) {
    reasons.push(`account_label mismatch: hub="${summary.account_label}" expected="${expectation.account_label}"`)
  }

  const component = (summary.components ?? []).find(
    (c) => norm(c.currency) === norm(expectation.currency)
      && norm(c.component_scope) === norm(expectation.component_scope),
  )
  if (!component) {
    reasons.push(`component not found: ${expectation.currency}/${expectation.component_scope}`)
    return { ok: false, reasons }
  }

  const actual = component[expectation.field]
  if (actual === null || actual === undefined) {
    reasons.push(`component field "${expectation.field}" is null`)
    return { ok: false, reasons }
  }
  try {
    if (!decimalWithinTolerance(actual, expectation.expected, expectation.tolerance)) {
      reasons.push(`${expectation.field} out of tolerance: hub="${actual}" expected="${expectation.expected}" (±${expectation.tolerance})`)
    }
  } catch {
    reasons.push(`${expectation.field}="${actual}" could not be compared as an exact decimal; verify manually`)
  }

  return { ok: reasons.length === 0, reasons }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run scripts/remote-hub-remap.test.mjs`
Expected: PASS (all Task 2 + Task 3 tests green).

- [ ] **Step 5: Commit**

```bash
git add scripts/remote-hub-remap.mjs scripts/remote-hub-remap.test.mjs
git commit -m "feat: exact-decimal tolerance and known-figure verification"
```

---

## Task 4: CLI/IO wiring — build, apply, verify, rollback

**Files:**
- Modify: `scripts/remote-hub-remap.mjs`
- Test: `scripts/remote-hub-remap.test.mjs`
- Modify: `package.json` (add `hub:remap` script)

**Interfaces:**
- Consumes: `buildMappingTable`, `verifyKnownFigure` (Tasks 2–3).
- Produces:
  - `readRemapConfig(env) -> { supabaseUrl, supabaseSecretKey, hubBaseUrl, hubApiKey }` (throws on missing/invalid; never echoes values).
  - `assertNoSecretsPrinted`-style guarantee: a `redact(...)` helper used by all logging.
  - A guarded `main()` dispatching on `process.argv[2]` ∈ `build | apply | verify | rollback`.

- [ ] **Step 1: Write the failing tests for config + redaction (pure parts only)**

Append to `scripts/remote-hub-remap.test.mjs`:

```js
import { readRemapConfig, redact } from './remote-hub-remap.mjs'

const validRemapEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_do-not-print',
  PORTFOLIO_DATA_HUB_BASE_URL: 'https://hub.germanquantum.tech',
  PORTFOLIO_DATA_HUB_API_KEY: 'hub-key-do-not-print',
}

describe('readRemapConfig', () => {
  it('reads all four values from a valid env', () => {
    const config = readRemapConfig(validRemapEnv)
    expect(config.hubBaseUrl).toBe('https://hub.germanquantum.tech')
    expect(config.supabaseUrl).toBe('https://example.supabase.co')
  })
  it('accepts the legacy SUPABASE_SERVICE_ROLE_KEY fallback', () => {
    const { SUPABASE_SECRET_KEY, ...rest } = validRemapEnv
    const config = readRemapConfig({ ...rest, SUPABASE_SERVICE_ROLE_KEY: 'legacy-secret' })
    expect(config.supabaseSecretKey).toBe('legacy-secret')
  })
  it('throws when the Hub base URL is missing', () => {
    const { PORTFOLIO_DATA_HUB_BASE_URL, ...rest } = validRemapEnv
    expect(() => readRemapConfig(rest)).toThrow(/PORTFOLIO_DATA_HUB_BASE_URL/)
  })
  it('rejects a VITE_-prefixed Hub key', () => {
    expect(() => readRemapConfig({ ...validRemapEnv, VITE_PORTFOLIO_DATA_HUB_API_KEY: 'x' }))
      .toThrow(/VITE_/)
  })
})

describe('redact', () => {
  it('never leaks configured secret values', () => {
    const config = readRemapConfig(validRemapEnv)
    const line = redact(`connecting to ${config.hubBaseUrl} with ${config.hubApiKey} and ${config.supabaseSecretKey}`, config)
    expect(line).not.toContain('hub-key-do-not-print')
    expect(line).not.toContain('sb_secret_do-not-print')
    expect(line).toContain('«redacted»')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/remote-hub-remap.test.mjs`
Expected: FAIL with `readRemapConfig is not a function` / `redact is not a function`.

- [ ] **Step 3: Write the config + redaction implementation**

Append to `scripts/remote-hub-remap.mjs` (above the `main()` you add in Step 5):

```js
function firstDefined(env, names) {
  for (const name of names) {
    const value = env[name]?.trim()
    if (value) return value
  }
  return null
}

export function readRemapConfig(env) {
  for (const name of Object.keys(env)) {
    if (name.startsWith('VITE_PORTFOLIO_DATA_HUB_') || name === 'VITE_SUPABASE_SECRET_KEY') {
      throw new Error(`${name} must not be VITE_-prefixed; Hub/secret settings are server-only`)
    }
  }
  const supabaseUrl = firstDefined(env, ['SUPABASE_URL', 'VITE_SUPABASE_URL'])
  const supabaseSecretKey = firstDefined(env, ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'])
  const hubBaseUrl = firstDefined(env, ['PORTFOLIO_DATA_HUB_BASE_URL'])
  const hubApiKey = firstDefined(env, ['PORTFOLIO_DATA_HUB_API_KEY'])
  const missing = []
  if (!supabaseUrl) missing.push('SUPABASE_URL')
  if (!supabaseSecretKey) missing.push('SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)')
  if (!hubBaseUrl) missing.push('PORTFOLIO_DATA_HUB_BASE_URL')
  if (!hubApiKey) missing.push('PORTFOLIO_DATA_HUB_API_KEY')
  if (missing.length) throw new Error(`Missing required configuration: ${missing.join(', ')}`)
  const url = new URL(hubBaseUrl)
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('PORTFOLIO_DATA_HUB_BASE_URL must use HTTPS except on loopback')
  }
  return {
    supabaseUrl: supabaseUrl.replace(/\/$/, ''),
    supabaseSecretKey,
    hubBaseUrl: hubBaseUrl.replace(/\/$/, ''),
    hubApiKey,
  }
}

/** Replace every configured secret with a marker so logs can never leak them. */
export function redact(text, config) {
  let safe = String(text)
  for (const secret of [config.hubApiKey, config.supabaseSecretKey]) {
    if (secret) safe = safe.split(secret).join('«redacted»')
  }
  return safe
}
```

- [ ] **Step 4: Run the config/redaction tests to verify they pass**

Run: `npx vitest run scripts/remote-hub-remap.test.mjs`
Expected: PASS (all tests through Task 4 Step 1 green).

- [ ] **Step 5: Add the IO helpers and `main()` dispatcher**

Append to `scripts/remote-hub-remap.mjs`. These functions perform network/file IO and are exercised by the live rehearsal in Step 7 (not by unit tests, which stay network-free):

```js
import { readFileSync, writeFileSync } from 'node:fs'

const log = (config, text) => console.log(redact(text, config))
const die = (config, text) => { console.error(redact(text, config)); process.exitCode = 1 }

async function hubGet(config, path) {
  const response = await fetch(`${config.hubBaseUrl}${path}`, {
    headers: { authorization: `Bearer ${config.hubApiKey}`, accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`Hub GET ${path} failed with ${response.status}`)
  return response.json()
}

async function listHubAccounts(config) {
  const page = await hubGet(config, '/api/v1/data/accounts')
  return (page.items ?? []).map((a) => ({
    id: a.id, label: a.label, venue: a.venue,
    external_account_identifier: a.external_account_identifier ?? null,
    enabled: Boolean(a.enabled),
  }))
}

async function fetchSummary(config, accountId) {
  return hubGet(config, `/api/v1/accounts/${encodeURIComponent(accountId)}/summaries/latest`)
}

function supabaseHeaders(config) {
  return {
    apikey: config.supabaseSecretKey,
    authorization: `Bearer ${config.supabaseSecretKey}`,
    accept: 'application/json',
    'content-type': 'application/json',
  }
}

async function listClients(config) {
  const query = 'select=client_id,client_name,hub_account_id,hub_account_label'
  const response = await fetch(`${config.supabaseUrl}/rest/v1/clients?${query}`, { headers: supabaseHeaders(config) })
  if (!response.ok) throw new Error(`Supabase clients read failed with ${response.status}`)
  return response.json()
}

/** Apply one mapping through the audited, admin/service-role-gated RPC. */
async function setMapping(config, clientId, hubAccountId, label) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/admin_set_client_hub_account_mapping`, {
    method: 'POST',
    headers: supabaseHeaders(config),
    body: JSON.stringify({ p_client_id: clientId, p_hub_account_id: hubAccountId, p_hub_account_label: label }),
  })
  if (!response.ok) throw new Error(`RPC failed for client ${clientId} with ${response.status}`)
  return response.json()
}

async function phaseBuild(config, outPath) {
  const [clients, hubAccounts] = await Promise.all([listClients(config), listHubAccounts(config)])
  const { rows, conflicts } = buildMappingTable(clients, hubAccounts)
  writeFileSync(outPath, JSON.stringify(rows, null, 2))
  for (const row of rows) {
    log(config, `${row.match_status.padEnd(9)} ${row.client_name} | ${row.old_hub_account_id ?? '—'} -> ${row.new_hub_account_id ?? '—'} | ${row.venue ?? '—'} | ${row.external_account_identifier ?? '—'}`)
  }
  if (conflicts.length) {
    for (const conflict of conflicts) die(config, `CONFLICT: ${conflict}`)
    die(config, `Wrote ${outPath} but ${conflicts.length} conflict(s) block apply. Resolve, then re-run build.`)
  } else {
    log(config, `Wrote ${outPath}. Review it, then run: npm run hub:remap -- apply --input ${outPath}`)
  }
}

async function phaseApply(config, inPath, rollbackPath) {
  const rows = JSON.parse(readFileSync(inPath, 'utf8'))
  const applicable = rows.filter((r) => r.match_status === 'matched' && r.new_hub_account_id)
  if (applicable.length !== rows.length) {
    return die(config, `Refusing to apply: ${rows.length - applicable.length} row(s) are not 'matched'. Re-run build until clean.`)
  }
  const currentById = new Map((await listClients(config)).map((c) => [c.client_id, c]))
  const rollback = []
  for (const row of applicable) {
    const current = currentById.get(row.client_id)
    rollback.push({ client_id: row.client_id, hub_account_id: current?.hub_account_id ?? null, hub_account_label: current?.hub_account_label ?? null })
  }
  writeFileSync(rollbackPath, JSON.stringify(rollback, null, 2))
  log(config, `Wrote rollback snapshot to ${rollbackPath} before any write.`)
  for (const row of applicable) {
    await setMapping(config, row.client_id, row.new_hub_account_id, row.hub_account_label)
    log(config, `Applied: ${row.client_name} -> ${row.new_hub_account_id}`)
  }
  log(config, `Applied ${applicable.length} mapping(s). Next: npm run hub:remap -- verify --input ${inPath} --expected expected.json`)
}

async function phaseVerify(config, inPath, expectedPath) {
  const rows = JSON.parse(readFileSync(inPath, 'utf8'))
  const expected = JSON.parse(readFileSync(expectedPath, 'utf8'))
  const expectedById = new Map(expected.map((e) => [e.client_id, e]))
  let failures = 0
  for (const row of rows) {
    if (!row.new_hub_account_id) continue
    const expectation = expectedById.get(row.client_id)
    if (!expectation) { die(config, `No expected figure for client ${row.client_name}; cannot verify`); failures += 1; continue }
    const summary = await fetchSummary(config, row.new_hub_account_id)
    const { ok, reasons } = verifyKnownFigure(summary, expectation)
    if (ok) log(config, `OK   ${row.client_name}`)
    else { failures += 1; for (const reason of reasons) die(config, `FAIL ${row.client_name}: ${reason}`) }
  }
  if (failures) die(config, `${failures} client(s) failed verification. Roll back the failed clients and investigate.`)
  else log(config, 'All mapped clients verified.')
}

async function phaseRollback(config, rollbackPath) {
  const entries = JSON.parse(readFileSync(rollbackPath, 'utf8'))
  for (const entry of entries) {
    await setMapping(config, entry.client_id, entry.hub_account_id, entry.hub_account_label)
    log(config, `Rolled back: ${entry.client_id} -> ${entry.hub_account_id ?? '(unmapped)'}`)
  }
  log(config, `Rolled back ${entries.length} mapping(s).`)
}

function argValue(argv, flag, fallback) {
  const index = argv.indexOf(flag)
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback
}

async function main() {
  const config = readRemapConfig(process.env)
  const argv = process.argv.slice(2)
  const phase = argv[0]
  if (phase === 'build') return phaseBuild(config, argValue(argv, '--out', 'mapping.json'))
  if (phase === 'apply') return phaseApply(config, argValue(argv, '--input', 'mapping.json'), argValue(argv, '--rollback-out', 'rollback.json'))
  if (phase === 'verify') return phaseVerify(config, argValue(argv, '--input', 'mapping.json'), argValue(argv, '--expected', 'expected.json'))
  if (phase === 'rollback') return phaseRollback(config, argValue(argv, '--input', 'rollback.json'))
  die(config, 'Usage: hub:remap <build|apply|verify|rollback> [--input f] [--out f] [--expected f] [--rollback-out f]')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(String(error?.message ?? error)); process.exitCode = 1 })
}
```

Note: move the `import { readFileSync, writeFileSync } from 'node:fs'` line to the top of the file with the other imports; it is shown here inline only for locality.

- [ ] **Step 6: Add the `hub:remap` npm script**

In `package.json` `scripts`, add after `hub:preflight:production`:

```json
    "hub:remap": "node scripts/remote-hub-remap.mjs",
```

- [ ] **Step 7: Run the full suite, then a read-only live rehearsal**

Run: `npm run test`
Expected: PASS (all unit tests, network-free).

Then, with the real server env exported (never committed), rehearse the read-only build phase against the live hub and database:

```bash
npm run hub:remap -- build --out /tmp/mapping.json
```

Expected: one line per labeled client showing `matched|unmatched|ambiguous` and `old -> new`, a written `/tmp/mapping.json`, and either a clean "review it" message or explicit CONFLICT lines. No secret value appears in the output. `build` performs **no writes** to the database.

- [ ] **Step 8: Commit**

```bash
git add scripts/remote-hub-remap.mjs scripts/remote-hub-remap.test.mjs package.json
git commit -m "feat: remote-hub remap CLI (build/apply/verify/rollback)"
```

---

## Task 5: Cutover + rollback runbook

**Files:**
- Modify: `docs/DEPLOY.md` (add a new "Remote Hub cutover" section after "Key rotation", around `docs/DEPLOY.md:105`).

**Interfaces:**
- Consumes: the `hub:remap` script and phases from Task 4; the preflight from the existing tooling.
- Produces: the operator runbook (no code).

Documentation only; verified by review and by the commands it contains having been exercised in Task 4 Step 7.

- [ ] **Step 1: Add the runbook section**

Insert after the "Key rotation" list (before the "If the Hub is unavailable" paragraph) in `docs/DEPLOY.md`:

```markdown
### Remote Hub cutover (hub.germanquantum.tech)

Direct production switch. The old Hub stays reachable until the new one is
verified, so rollback is immediate.

**Preconditions**
- The new `PORTFOLIO_DATA_HUB_API_KEY` carries the portal data-read scopes
  (data accounts, summaries, positions, ledger-events); `raw:read` is not needed.
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
```

- [ ] **Step 2: Verify the doc renders and references are correct**

Run: `grep -n "hub:remap\|expected.json\|rollback.json" docs/DEPLOY.md`
Expected: the new section appears with the four `hub:remap` phase commands.

- [ ] **Step 3: Commit**

```bash
git add docs/DEPLOY.md
git commit -m "docs: remote Hub cutover and rollback runbook"
```

---

## Self-Review

**Spec coverage:**
- Config switch (base URL + scoped key, preflight) → Task 1, Task 5 steps 1–2. ✓
- No data-path code changes → asserted in Architecture; no task touches `server.ts`/`schemas.ts`/routes/UI. ✓
- Remap via existing RPC, no new migration → Task 4 `setMapping`, Global Constraints. ✓
- Match key = `GET /api/v1/data/accounts` joined on label, venue-guarded, external id captured → Task 2 + Task 4 `listHubAccounts`. ✓
- Build → human review → apply → verify → rollback discipline → Tasks 2–5; human gate enforced (apply refuses non-`matched` rows). ✓
- Known-figure verification on `summaries/latest` component equity, exact decimals not floats → Task 3. ✓
- Direct cutover, old hub kept for rollback → Task 5. ✓
- Secrets never printed, no VITE_ prefix → Task 4 `redact`/`readRemapConfig` + tests. ✓
- Key scopes prerequisite → Task 1 `.env.example`, Task 5 preconditions. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has an expected result. The only run-time-supplied artifact (`expected.json` values) is defined by shape, not left vague.

**Type consistency:** `buildMappingTable` row shape (Task 2) is the exact shape `phaseBuild`/`phaseApply` read (Task 4). `verifyKnownFigure(summary, expectation)` signature (Task 3) matches the call in `phaseVerify` (Task 4). `readRemapConfig`/`redact` names (Task 4 tests) match their definitions. Hub field names (`id`, `label`, `venue`, `external_account_identifier`, `enabled`, `components[].currency/component_scope/equity/balance`, `venue`, `account_label`) match the hub `openapi.json` and `schemas.ts`.
