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
