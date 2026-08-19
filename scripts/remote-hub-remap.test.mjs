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
