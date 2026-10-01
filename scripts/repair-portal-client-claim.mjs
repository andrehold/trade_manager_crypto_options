#!/usr/bin/env node

/**
 * Audited, dry-run-first repair for a user's trusted app_metadata.client_id.
 * This administrative tool never writes user_metadata and never prints user
 * identities, Auth metadata, access tokens, or service credentials.
 */

import { createClient } from '@supabase/supabase-js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CHANGE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,127}$/

function firstDefined(env, names) {
  for (const name of names) {
    const value = env[name]?.trim()
    if (value) return value
  }
  return null
}

export function parseRepairArgs(argv) {
  const values = new Map()
  let apply = false
  const valueFlags = new Set([
    '--subject-user-id',
    '--target-client-id',
    '--expected-hub-account-id',
    '--change-reference',
  ])

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') {
      apply = true
      continue
    }
    if (arg.includes('user-metadata')) {
      throw new Error('user_metadata is not an authorization source and cannot be supplied')
    }
    if (!valueFlags.has(arg)) throw new Error('Unknown argument; see the documented usage')
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
    if (values.has(arg)) throw new Error(`Duplicate argument: ${arg}`)
    values.set(arg, value.trim())
    index += 1
  }

  const required = [...valueFlags]
  const missing = required.filter((flag) => !values.get(flag))
  if (missing.length) throw new Error(`Missing required arguments: ${missing.join(', ')}`)

  const subjectUserId = values.get('--subject-user-id')
  const targetClientId = values.get('--target-client-id')
  const expectedHubAccountId = values.get('--expected-hub-account-id')
  const changeReference = values.get('--change-reference')
  for (const [label, value] of [
    ['subject user ID', subjectUserId],
    ['target client ID', targetClientId],
    ['expected Hub account ID', expectedHubAccountId],
  ]) {
    if (!UUID.test(value)) throw new Error(`${label} must be a UUID`)
  }
  if (!CHANGE_REFERENCE.test(changeReference)) {
    throw new Error('change reference must be 2-128 non-secret letters, digits, or ._:/- characters')
  }

  return { apply, subjectUserId, targetClientId, expectedHubAccountId, changeReference }
}

export function readRepairConfig(env, { apply = false } = {}) {
  for (const name of ['VITE_SUPABASE_SECRET_KEY', 'VITE_SUPABASE_SERVICE_ROLE_KEY', 'VITE_PORTAL_SUBJECT_ACCESS_TOKEN']) {
    if (env[name]) throw new Error(`${name} must never be exposed to browser code`)
  }
  const supabaseUrl = firstDefined(env, ['SUPABASE_URL', 'VITE_SUPABASE_URL'])
  const supabaseSecretKey = firstDefined(env, ['SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'])
  const subjectAccessToken = firstDefined(env, ['PORTAL_SUBJECT_ACCESS_TOKEN'])
  const missing = []
  if (!supabaseUrl) missing.push('SUPABASE_URL')
  if (!supabaseSecretKey) missing.push('SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)')
  if (apply && !subjectAccessToken) missing.push('PORTAL_SUBJECT_ACCESS_TOKEN')
  if (missing.length) throw new Error(`Missing required configuration: ${missing.join(', ')}`)

  const url = new URL(supabaseUrl)
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('SUPABASE_URL must use HTTPS except on loopback')
  }
  return {
    supabaseUrl: supabaseUrl.replace(/\/$/, ''),
    supabaseSecretKey,
    subjectAccessToken,
  }
}

export function redactRepairOutput(value, config) {
  let safe = String(value)
  for (const secret of [config?.supabaseSecretKey, config?.subjectAccessToken]) {
    if (secret) safe = safe.split(secret).join('«redacted»')
  }
  return safe
}

function requireOne(rows, label) {
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error(`${label} did not resolve exactly one row`)
  return rows[0]
}

export async function runClaimRepair(input, operations, write = () => {}) {
  const user = await operations.getAuthUser(input.subjectUserId)
  if (!user) throw new Error('subject Auth user was not found')
  write('PASS trusted Auth identity resolved')

  const target = requireOne(await operations.findClientById(input.targetClientId), 'target client')
  const mapped = requireOne(
    await operations.findClientsByHubAccountId(input.expectedHubAccountId),
    'expected Hub account mapping',
  )
  if (target.client_id !== input.targetClientId
    || target.hub_account_id !== input.expectedHubAccountId
    || mapped.client_id !== input.targetClientId) {
    throw new Error('target client and expected Hub account mapping do not match')
  }
  write('PASS unique client-to-Hub mapping verified')

  const oldAppMetadata = { ...(user.app_metadata ?? {}) }
  const oldClientId = typeof oldAppMetadata.client_id === 'string' && UUID.test(oldAppMetadata.client_id)
    ? oldAppMetadata.client_id
    : null
  const newAppMetadata = { ...oldAppMetadata, client_id: input.targetClientId }

  if (!input.apply) {
    write(`DRY RUN passed; no changes applied; reference=${input.changeReference}`)
    return { applied: false, oldClientId, newAppMetadata }
  }

  await operations.updateAppMetadata(input.subjectUserId, newAppMetadata)
  write('PASS trusted app metadata updated')

  let auditId
  try {
    auditId = await operations.appendAudit({
      subjectUserId: input.subjectUserId,
      oldClientId,
      newClientId: input.targetClientId,
      changeReference: input.changeReference,
      operationResult: 'applied',
    })
  } catch (auditError) {
    await operations.updateAppMetadata(input.subjectUserId, oldAppMetadata)
    try {
      await operations.appendAudit({
        subjectUserId: input.subjectUserId,
        oldClientId: input.targetClientId,
        newClientId: oldClientId,
        changeReference: input.changeReference,
        operationResult: 'rolled_back',
      })
    } catch {
      // The original audit failure is authoritative. Never hide it behind the
      // best-effort rollback event failure.
    }
    write('PASS Auth metadata restored after audit failure')
    throw new Error('audit append failed; Auth metadata was rolled back', { cause: auditError })
  }
  write('PASS portal identity audit appended')

  await operations.revokeSessions(input.subjectUserId)
  write('PASS old subject sessions revoked; sign in again to mint a fresh JWT')
  return { applied: true, auditId }
}

function unwrap(result, label) {
  if (result.error) throw new Error(`${label} failed`)
  return result.data
}

export function createSupabaseRepairOperations(config) {
  const supabase = createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return {
    async getAuthUser(userId) {
      const data = unwrap(await supabase.auth.admin.getUserById(userId), 'Auth user lookup')
      return data.user
    },
    async findClientById(clientId) {
      return unwrap(
        await supabase.from('clients').select('client_id,hub_account_id').eq('client_id', clientId),
        'target client lookup',
      )
    },
    async findClientsByHubAccountId(hubAccountId) {
      return unwrap(
        await supabase.from('clients').select('client_id,hub_account_id').eq('hub_account_id', hubAccountId),
        'Hub account mapping lookup',
      )
    },
    async updateAppMetadata(userId, appMetadata) {
      unwrap(
        await supabase.auth.admin.updateUserById(userId, { app_metadata: appMetadata }),
        'Auth metadata update',
      )
    },
    async appendAudit(event) {
      return unwrap(await supabase.rpc('append_auth_identity_admin_audit', {
        p_subject_user_id: event.subjectUserId,
        p_old_client_id: event.oldClientId,
        p_new_client_id: event.newClientId,
        p_change_reference: event.changeReference,
        p_operation_result: event.operationResult,
      }), 'identity audit append')
    },
    async revokeSessions(expectedSubjectUserId) {
      let tokenSubject
      try {
        const payload = config.subjectAccessToken.split('.')[1]
        tokenSubject = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).sub
      } catch {
        throw new Error('subject access token is not a valid JWT')
      }
      if (tokenSubject !== expectedSubjectUserId) {
        throw new Error('subject access token does not belong to the requested Auth user')
      }
      const { error } = await supabase.auth.admin.signOut(config.subjectAccessToken, 'global')
      if (error) throw new Error('session revocation failed')
    },
  }
}

async function main() {
  let config
  try {
    const input = parseRepairArgs(process.argv.slice(2))
    config = readRepairConfig(process.env, input)
    const operations = createSupabaseRepairOperations(config)
    const result = await runClaimRepair(input, operations, (line) => {
      console.log(redactRepairOutput(line, config))
    })
    if (result.applied) console.log(`PASS repair applied; audit_event=${result.auditId}; reference=${input.changeReference}`)
  } catch (error) {
    console.error(redactRepairOutput(`FAIL identity repair: ${error?.message ?? error}`, config))
    process.exitCode = 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
