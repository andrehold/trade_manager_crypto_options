import { describe, expect, it } from 'vitest'
import { buildMappingTable, decimalWithinTolerance, verifyKnownFigure } from './remote-hub-remap.mjs'

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
