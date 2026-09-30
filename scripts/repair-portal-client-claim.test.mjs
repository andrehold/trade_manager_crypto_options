import { describe, expect, it, vi } from 'vitest'
import {
  createSupabaseRepairOperations,
  parseRepairArgs,
  readRepairConfig,
  redactRepairOutput,
  runClaimRepair,
} from './repair-portal-client-claim.mjs'

const SUBJECT = '11111111-1111-4111-8111-111111111111'
const CLIENT = '22222222-2222-4222-8222-222222222222'
const HUB = 'bc0d0917-83a9-44e5-a447-f16fc9f4a5bf'

const input = (overrides = {}) => ({
  apply: false,
  subjectUserId: SUBJECT,
  targetClientId: CLIENT,
  expectedHubAccountId: HUB,
  changeReference: 'CHG-2042',
  ...overrides,
})

function operations(overrides = {}) {
  return {
    getAuthUser: vi.fn(async () => ({ app_metadata: { role: 'client', locale: 'en' }, user_metadata: { client_id: 'untrusted' } })),
    findClientById: vi.fn(async () => [{ client_id: CLIENT, hub_account_id: HUB }]),
    findClientsByHubAccountId: vi.fn(async () => [{ client_id: CLIENT, hub_account_id: HUB }]),
    updateAppMetadata: vi.fn(async () => undefined),
    appendAudit: vi.fn(async () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    revokeSessions: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('parseRepairArgs', () => {
  const args = [
    '--subject-user-id', SUBJECT,
    '--target-client-id', CLIENT,
    '--expected-hub-account-id', HUB,
    '--change-reference', 'CHG-2042',
  ]

  it('is dry-run-first and requires all explicit identifiers', () => {
    expect(parseRepairArgs(args)).toMatchObject(input())
    expect(parseRepairArgs([...args, '--apply']).apply).toBe(true)
    expect(() => parseRepairArgs(args.slice(0, -2))).toThrow(/change-reference/)
  })

  it('refuses user_metadata input', () => {
    expect(() => parseRepairArgs([...args, '--user-metadata.client_id', CLIENT])).toThrow(/user_metadata/)
  })
})

describe('runClaimRepair', () => {
  it('dry run verifies identity and mapping without any write', async () => {
    const ops = operations()
    const lines = []
    const result = await runClaimRepair(input(), ops, (line) => lines.push(line))
    expect(result.applied).toBe(false)
    expect(ops.updateAppMetadata).not.toHaveBeenCalled()
    expect(ops.appendAudit).not.toHaveBeenCalled()
    expect(ops.revokeSessions).not.toHaveBeenCalled()
    expect(lines.join('\n')).toContain('DRY RUN')
  })

  it('preserves unrelated app_metadata and ignores editable user_metadata', async () => {
    const ops = operations()
    await runClaimRepair(input({ apply: true }), ops)
    expect(ops.updateAppMetadata).toHaveBeenNthCalledWith(1, SUBJECT, {
      role: 'client', locale: 'en', client_id: CLIENT,
    })
    expect(ops.updateAppMetadata.mock.calls[0][1]).not.toHaveProperty('user_metadata')
  })

  it('rejects a target mapping mismatch before any write', async () => {
    const ops = operations({
      findClientById: vi.fn(async () => [{ client_id: CLIENT, hub_account_id: '33333333-3333-4333-8333-333333333333' }]),
    })
    await expect(runClaimRepair(input({ apply: true }), ops)).rejects.toThrow(/do not match/)
    expect(ops.updateAppMetadata).not.toHaveBeenCalled()
  })

  it('updates Auth, appends audit, then revokes sessions on success', async () => {
    const ops = operations()
    const result = await runClaimRepair(input({ apply: true }), ops)
    expect(result).toEqual({ applied: true, auditId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
    expect(ops.appendAudit).toHaveBeenCalledWith(expect.objectContaining({
      subjectUserId: SUBJECT,
      newClientId: CLIENT,
      operationResult: 'applied',
    }))
    expect(ops.updateAppMetadata.mock.invocationCallOrder[0]).toBeLessThan(ops.appendAudit.mock.invocationCallOrder[0])
    expect(ops.appendAudit.mock.invocationCallOrder[0]).toBeLessThan(ops.revokeSessions.mock.invocationCallOrder[0])
    expect(ops.revokeSessions).toHaveBeenCalledWith(SUBJECT)
  })

  it('restores exact old app_metadata and records rollback when audit append fails', async () => {
    const appendAudit = vi.fn()
      .mockRejectedValueOnce(new Error('audit unavailable'))
      .mockResolvedValueOnce('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    const ops = operations({ appendAudit })
    await expect(runClaimRepair(input({ apply: true }), ops)).rejects.toThrow(/rolled back/)
    expect(ops.updateAppMetadata).toHaveBeenNthCalledWith(2, SUBJECT, { role: 'client', locale: 'en' })
    expect(appendAudit).toHaveBeenNthCalledWith(2, expect.objectContaining({
      oldClientId: CLIENT,
      newClientId: null,
      operationResult: 'rolled_back',
    }))
    expect(ops.revokeSessions).not.toHaveBeenCalled()
  })
})

describe('configuration and output safety', () => {
  const env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SECRET_KEY: 'service-secret-do-not-print',
    PORTAL_SUBJECT_ACCESS_TOKEN: 'subject-jwt-do-not-print',
  }

  it('requires the subject token for apply but not dry run', () => {
    const { PORTAL_SUBJECT_ACCESS_TOKEN, ...withoutToken } = env
    expect(readRepairConfig(withoutToken, { apply: false }).subjectAccessToken).toBeNull()
    expect(() => readRepairConfig(withoutToken, { apply: true })).toThrow(/PORTAL_SUBJECT_ACCESS_TOKEN/)
  })

  it('rejects browser-visible privileged configuration', () => {
    expect(() => readRepairConfig({ ...env, VITE_SUPABASE_SECRET_KEY: 'bad' })).toThrow(/browser/)
  })

  it('redacts service credentials and subject JWT from output', () => {
    const config = readRepairConfig(env, { apply: true })
    const safe = redactRepairOutput(`${config.supabaseSecretKey} ${config.subjectAccessToken}`, config)
    expect(safe).not.toContain('service-secret-do-not-print')
    expect(safe).not.toContain('subject-jwt-do-not-print')
    expect(safe).toBe('«redacted» «redacted»')
  })

  it('refuses to revoke a token belonging to a different subject', async () => {
    const payload = Buffer.from(JSON.stringify({ sub: '99999999-9999-4999-8999-999999999999' })).toString('base64url')
    const ops = createSupabaseRepairOperations({
      ...readRepairConfig(env, { apply: true }),
      subjectAccessToken: `header.${payload}.signature`,
    })
    await expect(ops.revokeSessions(SUBJECT)).rejects.toThrow(/does not belong/)
  })
})
