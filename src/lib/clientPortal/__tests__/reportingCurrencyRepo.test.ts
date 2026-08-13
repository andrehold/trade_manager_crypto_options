import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeReportingCurrency, parseReportingCurrencySelection, setOwnReportingCurrency } from '../reportingCurrencyRepo'

function mockClient(data: unknown, error: { message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error })
  return { client: { rpc } as unknown as SupabaseClient, rpc }
}

describe('normalizeReportingCurrency', () => {
  it('uses the database-compatible uppercase 2-12 alphanumeric currency format', () => {
    expect(normalizeReportingCurrency(' usdc ')).toBe('USDC')
    expect(normalizeReportingCurrency('')).toBeNull()
    expect(normalizeReportingCurrency('A')).toBeNull()
    expect(normalizeReportingCurrency('ABCDEFGHIJKLM')).toBeNull()
    expect(normalizeReportingCurrency('USD!')).toBeNull()
  })
})

describe('parseReportingCurrencySelection', () => {
  it('maps a valid RPC row and preserves the setter provenance', () => {
    expect(parseReportingCurrencySelection({ client_id: 'client-1', reporting_currency: 'USDC', reporting_currency_source: 'admin' }))
      .toEqual({ clientId: 'client-1', reportingCurrency: 'USDC', reportingCurrencySource: 'admin' })
  })

  it('rejects incomplete or untrustworthy RPC results', () => {
    expect(parseReportingCurrencySelection({ client_id: 'client-1', reporting_currency: 'USDC', reporting_currency_source: null })).toBeNull()
    expect(parseReportingCurrencySelection({ client_id: 'client-1', reporting_currency: null, reporting_currency_source: 'client' })).toBeNull()
  })
})

describe('setOwnReportingCurrency', () => {
  it('uses only the client-scoped RPC to set a currency', async () => {
    const { client, rpc } = mockClient([{ client_id: 'client-1', reporting_currency: 'USDC', reporting_currency_source: 'client' }])
    await expect(setOwnReportingCurrency(client, 'USDC')).resolves.toEqual({
      ok: true,
      selection: { clientId: 'client-1', reportingCurrency: 'USDC', reportingCurrencySource: 'client' },
    })
    expect(rpc).toHaveBeenCalledWith('set_own_reporting_currency', { p_reporting_currency: 'USDC' })
  })

  it('canonicalizes a valid value and refuses invalid input before calling the RPC', async () => {
    const { client, rpc } = mockClient([{ client_id: 'client-1', reporting_currency: 'USDC', reporting_currency_source: 'client' }])
    await expect(setOwnReportingCurrency(client, ' usdc ')).resolves.toMatchObject({ ok: true })
    expect(rpc).toHaveBeenCalledWith('set_own_reporting_currency', { p_reporting_currency: 'USDC' })
    await expect(setOwnReportingCurrency(client, 'too-long-currency')).resolves.toMatchObject({ ok: false })
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('uses null to clear the selection', async () => {
    const { client, rpc } = mockClient([{ client_id: 'client-1', reporting_currency: null, reporting_currency_source: null }])
    await expect(setOwnReportingCurrency(client, null)).resolves.toMatchObject({ ok: true })
    expect(rpc).toHaveBeenCalledWith('set_own_reporting_currency', { p_reporting_currency: null })
  })

  it('keeps the database error available to the UI', async () => {
    const { client } = mockClient(null, { message: 'session expired' })
    await expect(setOwnReportingCurrency(client, 'USDC')).resolves.toEqual({ ok: false, error: 'session expired' })
  })
})
