#!/usr/bin/env node

/**
 * Remaps clients.hub_account_id to a new Portfolio Data Hub's account UUIDs.
 * Four phases: build, apply, verify, rollback. Pure logic is exported and
 * unit-tested; main() performs all IO. This script prints no secret values.
 */

import { readFileSync, writeFileSync } from 'node:fs'

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
