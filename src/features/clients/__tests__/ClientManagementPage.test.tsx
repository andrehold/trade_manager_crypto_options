import React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ClientManagementPage from '../ClientManagementPage'

const client = {
  client_id: '038cd955-e117-4596-aaee-b46360dcf138',
  client_name: 'DWF', contact_name: null, contact_email: null, phone: null,
  mandate: null, notes: null, status: 'active', hub_account_id: '68288904-d6e7-4878-a712-430c84ffa447',
  hub_account_label: 'DWF', reporting_currency: 'BTC', reporting_currency_source: 'client',
}

const secondClient = {
  ...client,
  client_id: '11111111-1111-4111-8111-111111111111',
  client_name: 'Beta',
  hub_account_label: 'Beta Hub',
  reporting_currency: 'EUR',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

function createSupabase(clients = [client], rpcResult: (() => Promise<any>) | null = null) {
  const rpc = vi.fn(async () => ({ data: [{ ...client, reporting_currency: 'EUR', reporting_currency_source: 'admin' }], error: null }))
  if (rpcResult) rpc.mockImplementation(rpcResult)
  const ordered = vi.fn(async () => ({ data: clients, error: null }))
  const query: any = {
    select: vi.fn(() => query),
    order: ordered,
    update: vi.fn(() => query),
    eq: vi.fn(() => query),
    single: vi.fn(async () => ({ data: client, error: null })),
  }
  return {
    from: vi.fn(() => query),
    rpc,
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'admin-jwt' } } })) },
  }
}

function createCreateSupabase(created: { client_id: string }) {
  const ordered = vi.fn(async () => ({ data: [], error: null }))
  const clientQuery: any = {
    select: vi.fn(() => clientQuery), order: ordered,
    eq: vi.fn(() => clientQuery), single: vi.fn(async () => ({ data: { client_id: created.client_id }, error: null })),
  }
  const insertQuery: any = { select: vi.fn(() => insertQuery), single: vi.fn(async () => ({ data: { client_id: created.client_id }, error: null })) }
  const from = vi.fn(() => ({ ...clientQuery, insert: vi.fn(() => insertQuery) }))
  return {
    from,
    rpc: vi.fn(),
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'admin-jwt' } } })) },
  }
}

describe('ClientManagementPage reporting currency', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: {
        currencies: ['BTC', 'EUR'], reportingCurrency: 'BTC', reportingCurrencySource: 'client',
        summary: { runId: 'run-1', fetchedAt: '2026-08-13T10:00:00Z', venueObservedAt: null, quality: 'complete', venue: 'deribit' },
      },
    }), { headers: { 'content-type': 'application/json' } })) as typeof fetch
  })

  afterEach(() => { globalThis.fetch = originalFetch })

  it('loads Hub-derived choices and persists an admin choice through the RPC, never the client update payload', async () => {
    const supabase = createSupabase()
    render(<ClientManagementPage supabase={supabase as any} isAdmin onClientAdded={() => {}} onBack={() => {}} />)
    await screen.findByText('DWF')
    fireEvent.click(screen.getByText('DWF'))
    await screen.findByRole('option', { name: 'EUR' })
    const select = screen.getByRole('combobox', { name: 'Reporting Currency' })
    fireEvent.change(select, { target: { value: 'EUR' } })
    fireEvent.click(screen.getByRole('button', { name: /apply reporting currency/i }))
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('admin_set_client_reporting_currency', {
      p_client_id: client.client_id, p_reporting_currency: 'EUR',
    }))
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `/api/portfolio-data-hub/admin/reporting-currencies?client_id=${client.client_id}`,
      { headers: { authorization: 'Bearer admin-jwt', accept: 'application/json' } },
    )
    // The ordinary form update is only used for the normal Save Changes action.
    expect(supabase.from().update).not.toHaveBeenCalled()
    expect(String(supabase.from().select.mock.calls[0]?.[0])).not.toContain('hub_account_id')
  })

  it('shows the trusted-role mismatch instead of attempting a direct write', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'FORBIDDEN', message: 'Administrator privileges are required' },
    }), { status: 403, headers: { 'content-type': 'application/json' } })) as typeof fetch
    const supabase = createSupabase()
    render(<ClientManagementPage supabase={supabase as any} isAdmin onClientAdded={() => {}} onBack={() => {}} />)
    await screen.findByText('DWF')
    fireEvent.click(screen.getByText('DWF'))
    await screen.findByText(/app_metadata\.role is not admin/i)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('allows an explicit same-value client-to-admin override', async () => {
    const supabase = createSupabase()
    render(<ClientManagementPage supabase={supabase as any} isAdmin onClientAdded={() => {}} onBack={() => {}} />)
    await screen.findByText('DWF')
    fireEvent.click(screen.getByText('DWF'))
    await screen.findByRole('option', { name: 'BTC' })
    fireEvent.click(screen.getByRole('button', { name: /apply reporting currency/i }))
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('admin_set_client_reporting_currency', {
      p_client_id: client.client_id, p_reporting_currency: 'BTC',
    }))
  })

  it('keeps a saved currency missing from the summary visible and permits explicitly clearing it with no options', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: {
        currencies: [], reportingCurrency: 'JPY', reportingCurrencySource: 'admin',
        summary: { runId: 'run-1', fetchedAt: '2026-08-13T10:00:00Z', venueObservedAt: null, quality: 'partial', venue: 'deribit' },
      },
    }), { headers: { 'content-type': 'application/json' } })) as typeof fetch
    const supabase = createSupabase()
    render(<ClientManagementPage supabase={supabase as any} isAdmin onClientAdded={() => {}} onBack={() => {}} />)
    await screen.findByText('DWF')
    fireEvent.click(screen.getByText('DWF'))
    await screen.findByRole('option', { name: /jpy \(not in latest summary\)/i })
    expect(screen.getByText(/remains selected until explicitly cleared/i)).toBeInTheDocument()
    const clear = screen.getByRole('button', { name: 'Clear' })
    expect(clear).toBeEnabled()
    fireEvent.click(clear)
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('admin_set_client_reporting_currency', {
      p_client_id: client.client_id, p_reporting_currency: null,
    }))
  })

  it('discards a late currency load for a previously selected client', async () => {
    const aResponse = deferred<Response>()
    globalThis.fetch = vi.fn((input) => {
      const path = String(input)
      if (path.includes(client.client_id)) return aResponse.promise
      return Promise.resolve(new Response(JSON.stringify({
        data: { currencies: ['EUR'], reportingCurrency: 'EUR', reportingCurrencySource: 'client', summary: {} },
      }), { headers: { 'content-type': 'application/json' } }))
    }) as typeof fetch
    const supabase = createSupabase([client, secondClient])
    render(<ClientManagementPage supabase={supabase as any} isAdmin onClientAdded={() => {}} onBack={() => {}} />)
    await screen.findByText('DWF')
    fireEvent.click(screen.getByText('DWF'))
    fireEvent.click(screen.getByText('Beta'))
    await screen.findByRole('option', { name: 'EUR' })
    await act(async () => {
      aResponse.resolve(new Response(JSON.stringify({
        data: { currencies: ['BTC'], reportingCurrency: 'BTC', reportingCurrencySource: 'client', summary: {} },
      }), { headers: { 'content-type': 'application/json' } }))
      await Promise.resolve()
    })
    expect(screen.getByRole('option', { name: 'EUR' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'BTC' })).not.toBeInTheDocument()
  })

  it('keeps the new client view intact when a save started for another client completes', async () => {
    const rpcResult = deferred<{ data: unknown; error: null }>()
    const supabase = createSupabase([client, secondClient], () => rpcResult.promise)
    globalThis.fetch = vi.fn(async (input) => {
      const beta = String(input).includes(secondClient.client_id)
      return new Response(JSON.stringify({
        data: { currencies: [beta ? 'EUR' : 'BTC'], reportingCurrency: beta ? 'EUR' : 'BTC', reportingCurrencySource: 'client', summary: {} },
      }), { headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    render(<ClientManagementPage supabase={supabase as any} isAdmin onClientAdded={() => {}} onBack={() => {}} />)
    await screen.findByText('DWF')
    fireEvent.click(screen.getByText('DWF'))
    await screen.findByRole('option', { name: 'BTC' })
    fireEvent.click(screen.getByRole('button', { name: /apply reporting currency/i }))
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('admin_set_client_reporting_currency', {
      p_client_id: client.client_id, p_reporting_currency: 'BTC',
    }))
    fireEvent.click(screen.getByText('Beta'))
    await screen.findByRole('option', { name: 'EUR' })
    await act(async () => {
      rpcResult.resolve({ data: null, error: null })
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByRole('heading', { name: 'Beta' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'EUR' })).toBeInTheDocument()
    expect(screen.queryByText(/reporting currency set to btc/i)).not.toBeInTheDocument()
  })

  it('suppresses a duplicate Apply while the first reporting-currency RPC is pending', async () => {
    const rpcResult = deferred<{ data: unknown; error: null }>()
    const supabase = createSupabase([client], () => rpcResult.promise)
    render(<ClientManagementPage supabase={supabase as any} isAdmin onClientAdded={() => {}} onBack={() => {}} />)
    await screen.findByText('DWF')
    fireEvent.click(screen.getByText('DWF'))
    await screen.findByRole('option', { name: 'BTC' })
    const apply = screen.getByRole('button', { name: /apply reporting currency/i })
    fireEvent.click(apply)
    fireEvent.click(apply)
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
    await act(async () => { rpcResult.resolve({ data: null, error: null }); await Promise.resolve() })
  })

  it('does not schedule a reporting-currency state update when a pending save resolves after unmount', async () => {
    const rpcResult = deferred<{ data: unknown; error: null }>()
    const supabase = createSupabase([client], () => rpcResult.promise)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const view = render(<ClientManagementPage supabase={supabase as any} isAdmin onClientAdded={() => {}} onBack={() => {}} />)
    await screen.findByText('DWF')
    fireEvent.click(screen.getByText('DWF'))
    await screen.findByRole('option', { name: 'BTC' })
    fireEvent.click(screen.getByRole('button', { name: /apply reporting currency/i }))
    view.unmount()
    await act(async () => { rpcResult.resolve({ data: null, error: null }); await Promise.resolve(); await Promise.resolve() })
    expect(consoleError.mock.calls.join('\n')).not.toMatch(/state update on an unmounted/i)
    consoleError.mockRestore()
  })

  it('initializes the imperative target before auto-selecting a newly created client and loads its currency state', async () => {
    const created = { ...secondClient, client_name: 'New client', reporting_currency: null, reporting_currency_source: null }
    const supabase = createCreateSupabase(created)
    globalThis.fetch = vi.fn(async (input) => {
      expect(String(input)).toContain(created.client_id)
      return new Response(JSON.stringify({
        data: { currencies: ['EUR'], reportingCurrency: null, reportingCurrencySource: null, summary: {} },
      }), { headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    render(<ClientManagementPage supabase={supabase as any} isAdmin onClientAdded={() => {}} onBack={() => {}} />)
    await screen.findByRole('button', { name: 'New' })
    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    fireEvent.change(screen.getByLabelText(/client name/i), { target: { value: 'New client' } })
    fireEvent.click(screen.getByRole('button', { name: /create client/i }))
    await screen.findByRole('option', { name: 'EUR' })
    expect(globalThis.fetch).toHaveBeenCalled()
  })
})
