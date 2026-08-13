import React from 'react'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { ArrowLeft, Plus, Search, UserCircle } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fetchAdminReportingCurrencies,
  type AdminReportingCurrencyOptions,
  PortfolioHubClientError,
} from '../../lib/portfolioDataHub/client'

/* ── Types ── */

export type ClientFormData = {
  client_name: string
  contact_name: string
  contact_email: string
  phone: string
  mandate: string
  notes: string
  status: 'active' | 'inactive'
}

type ClientRecord = ClientFormData & {
  client_id: string
  hub_account_label: string | null
  reporting_currency: string | null
  reporting_currency_source: 'client' | 'admin' | null
}

type CurrencyLoadState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; options: AdminReportingCurrencyOptions }
  | { status: 'unmapped' }
  | { status: 'unavailable'; message: string }

type Props = {
  supabase: SupabaseClient | null
  isAdmin: boolean
  onClientAdded: (name: string) => void
  onBack: () => void
}

const emptyForm: ClientFormData = {
  client_name: '',
  contact_name: '',
  contact_email: '',
  phone: '',
  mandate: '',
  notes: '',
  status: 'active',
}

/* ── Main Component ── */

export default function ClientManagementPage({ supabase, isAdmin, onClientAdded, onBack }: Props) {
  /* ---------- state ---------- */
  const [clients, setClients] = React.useState<ClientRecord[]>([])
  const [loading, setLoading] = React.useState(true)
  const [search, setSearch] = React.useState('')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [mode, setMode] = React.useState<'idle' | 'add' | 'edit'>('idle')
  const [form, setForm] = React.useState<ClientFormData>(emptyForm)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [successMsg, setSuccessMsg] = React.useState<string | null>(null)
  const [currencyState, setCurrencyState] = React.useState<CurrencyLoadState>({ status: 'idle' })
  const [savingReportingCurrencyTargets, setSavingReportingCurrencyTargets] = React.useState<Set<string>>(new Set())
  const savingReportingCurrencyTargetsRef = React.useRef<Set<string>>(new Set())
  const selectedIdRef = React.useRef<string | null>(null)
  const selectionGenerationRef = React.useRef(0)
  const mountedRef = React.useRef(true)

  React.useEffect(() => () => { mountedRef.current = false }, [])

  const isCurrentCurrencyTarget = React.useCallback((clientId: string, generation: number) =>
    mountedRef.current
    && selectedIdRef.current === clientId
    && selectionGenerationRef.current === generation,
  [])

  const setReportingCurrencySaving = React.useCallback((clientId: string, savingNow: boolean) => {
    if (savingNow) savingReportingCurrencyTargetsRef.current.add(clientId)
    else savingReportingCurrencyTargetsRef.current.delete(clientId)
    if (!mountedRef.current) return
    setSavingReportingCurrencyTargets((previous) => {
      const next = new Set(previous)
      if (savingNow) next.add(clientId)
      else next.delete(clientId)
      return next
    })
  }, [])

  /* ---------- fetch clients ---------- */
  const fetchClients = React.useCallback(async () => {
    if (!supabase) {
      if (mountedRef.current) setLoading(false)
      return [] as ClientRecord[]
    }
    if (mountedRef.current) setLoading(true)
    const { data, error: err } = await supabase
      .from('clients')
      .select('client_id, client_name, contact_name, contact_email, phone, mandate, notes, status, hub_account_label, reporting_currency, reporting_currency_source')
      .order('client_name')
    const records = !err && data ? data as ClientRecord[] : []
    if (mountedRef.current) {
      if (!err && data) setClients(records)
      setLoading(false)
    }
    return records
  }, [supabase])

  React.useEffect(() => { fetchClients() }, [fetchClients])

  const loadAdminReportingCurrencies = React.useCallback(async (clientId: string, generation: number) => {
    if (!supabase) return
    if (isCurrentCurrencyTarget(clientId, generation)) setCurrencyState({ status: 'loading' })
    const { data: { session } } = await supabase.auth.getSession()
    if (!isCurrentCurrencyTarget(clientId, generation)) return
    if (!session?.access_token) {
      setCurrencyState({ status: 'unavailable', message: 'Your session has expired. Sign in again to manage reporting currency.' })
      return
    }
    try {
      const options = await fetchAdminReportingCurrencies(clientId, session.access_token)
      if (!isCurrentCurrencyTarget(clientId, generation)) return
      setCurrencyState({ status: 'ready', options })
    } catch (err) {
      if (!isCurrentCurrencyTarget(clientId, generation)) return
      if (err instanceof PortfolioHubClientError && err.code === 'HUB_ACCOUNT_NOT_CONFIGURED') {
        setCurrencyState({ status: 'unmapped' })
        return
      }
      const message = err instanceof PortfolioHubClientError && err.code === 'FORBIDDEN'
        ? 'This account is visible in the admin UI, but its Supabase app_metadata.role is not admin. Reporting-currency changes are blocked.'
        : err instanceof Error ? err.message : 'Reporting currencies could not be loaded.'
      setCurrencyState({ status: 'unavailable', message })
    }
  }, [isCurrentCurrencyTarget, supabase])

  React.useEffect(() => {
    if (!selectedId || mode !== 'edit') {
      setCurrencyState({ status: 'idle' })
      return
    }
    const generation = selectionGenerationRef.current
    void loadAdminReportingCurrencies(selectedId, generation)
  }, [loadAdminReportingCurrencies, mode, selectedId])

  /* ---------- helpers ---------- */
  const set = <K extends keyof ClientFormData>(key: K, value: ClientFormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const nameValid = form.client_name.trim().length > 0
  const emailValid = !form.contact_email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contact_email)
  const canSubmit = nameValid && emailValid && !saving

  const filtered = React.useMemo(() => {
    if (!search) return clients
    const q = search.toLowerCase()
    return clients.filter(
      (c) =>
        c.client_name.toLowerCase().includes(q) ||
        (c.contact_name ?? '').toLowerCase().includes(q) ||
        (c.contact_email ?? '').toLowerCase().includes(q),
    )
  }, [clients, search])

  /* ---------- select a client ---------- */
  const handleSelect = (id: string) => {
    const client = clients.find((c) => c.client_id === id)
    if (!client) return
    selectionGenerationRef.current += 1
    selectedIdRef.current = id
    setSelectedId(id)
    setMode('edit')
    setCurrencyState({ status: 'loading' })
    setForm({
      client_name: client.client_name,
      contact_name: client.contact_name ?? '',
      contact_email: client.contact_email ?? '',
      phone: client.phone ?? '',
      mandate: client.mandate ?? '',
      notes: client.notes ?? '',
      status: (client.status as 'active' | 'inactive') ?? 'active',
    })
    setError(null)
    setSuccessMsg(null)
  }

  const handleAdminReportingCurrency = async (value: string) => {
    const targetId = selectedIdRef.current
    const targetGeneration = selectionGenerationRef.current
    if (!supabase || !targetId || currencyState.status !== 'ready' || savingReportingCurrencyTargetsRef.current.has(targetId)) return
    // The select contains only Hub-derived currencies plus the explicit unset option.
    if (value && !currencyState.options.currencies.includes(value)) return
    setReportingCurrencySaving(targetId, true)
    setError(null)
    setSuccessMsg(null)
    try {
      const { error: rpcError } = await supabase.rpc('admin_set_client_reporting_currency', {
        p_client_id: targetId,
        p_reporting_currency: value || null,
      })
      if (rpcError) {
        if (isCurrentCurrencyTarget(targetId, targetGeneration)) {
          setError(rpcError.code === '42501'
            ? 'Administrator privileges are required by Supabase to change reporting currency.'
            : rpcError.message)
        }
        return
      }
      // Persist first. Re-read Hub-derived choices and client state afterwards so
      // a stale response cannot overwrite the just-saved selection.
      await fetchClients()
      if (!isCurrentCurrencyTarget(targetId, targetGeneration)) return
      await loadAdminReportingCurrencies(targetId, targetGeneration)
      if (isCurrentCurrencyTarget(targetId, targetGeneration)) {
        setSuccessMsg(value ? `Reporting currency set to ${value}.` : 'Reporting currency cleared.')
      }
    } catch (err: any) {
      if (isCurrentCurrencyTarget(targetId, targetGeneration)) {
        setError(err?.message ?? 'Reporting currency could not be saved.')
      }
    } finally {
      setReportingCurrencySaving(targetId, false)
    }
  }

  /* ---------- new client mode ---------- */
  const handleNewClient = () => {
    selectionGenerationRef.current += 1
    selectedIdRef.current = null
    setSelectedId(null)
    setMode('add')
    setCurrencyState({ status: 'idle' })
    setForm(emptyForm)
    setError(null)
    setSuccessMsg(null)
  }

  /* ---------- save / create ---------- */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    setSuccessMsg(null)
    setSaving(true)

    try {
      if (!supabase) {
        onClientAdded(form.client_name.trim())
        return
      }

      // Build payload — for inserts only include non-empty optional fields;
      // for updates always send every field so cleared values are persisted.
      const buildPayload = () => {
        const base: Record<string, string> = { client_name: form.client_name.trim() }
        if (mode === 'edit') {
          // Always send all fields so the user can clear them
          base.contact_name = form.contact_name.trim()
          base.contact_email = form.contact_email.trim()
          base.phone = form.phone.trim()
          base.mandate = form.mandate.trim()
          base.notes = form.notes.trim()
          base.status = form.status
        } else {
          // Insert — only include non-empty optional fields
          if (form.contact_name.trim()) base.contact_name = form.contact_name.trim()
          if (form.contact_email.trim()) base.contact_email = form.contact_email.trim()
          if (form.phone.trim()) base.phone = form.phone.trim()
          if (form.mandate.trim()) base.mandate = form.mandate.trim()
          if (form.notes.trim()) base.notes = form.notes.trim()
          base.status = form.status
        }
        return base
      }

      const payload = buildPayload()

      if (mode === 'add') {
        const { error: dbError } = await supabase
          .from('clients')
          .insert(payload)
          .select('client_id')
          .single()

        if (dbError) {
          setError(dbError.code === '23505' ? 'A client with this name already exists.' : dbError.message)
          return
        }
        onClientAdded(form.client_name.trim())
        setSuccessMsg('Client created.')
      } else {
        // edit mode
        const { data, error: dbError } = await supabase
          .from('clients')
          .update(payload)
          .eq('client_id', selectedId!)
          .select('client_id')

        if (dbError) {
          setError(dbError.message)
          return
        }

        // Supabase .update() with RLS can silently match 0 rows
        if (!data || data.length === 0) {
          setError('Update had no effect — check RLS policies or that the client still exists.')
          return
        }

        setSuccessMsg('Client updated.')
      }

      await fetchClients()

      // after create, select the new client
      if (mode === 'add') {
        const created = (await supabase
          .from('clients')
          .select('client_id')
          .eq('client_name', form.client_name.trim())
          .single()).data
        if (created) {
          // Keep the imperative target identity in lockstep with the React
          // selection before the effect starts its Hub-currency load.
          selectionGenerationRef.current += 1
          selectedIdRef.current = created.client_id
          setSelectedId(created.client_id)
          setMode('edit')
          setCurrencyState({ status: 'loading' })
        }
      }
    } catch (err: any) {
      setError(err?.message ?? 'Unexpected error')
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  /* ---------- admin gate ---------- */
  if (!isAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-secondary type-subhead">
        Client management is restricted to admin users.
      </div>
    )
  }

  /* ---------- table columns ---------- */
  const columns: Column<ClientRecord>[] = [
    {
      key: 'client_name',
      header: 'Client Name',
      render: (r) => (
        <span className="font-medium text-text-primary">{r.client_name}</span>
      ),
    },
    {
      key: 'contact_name',
      header: 'Contact',
      render: (r) => r.contact_name || <span className="text-text-muted">&mdash;</span>,
    },
    {
      key: 'contact_email',
      header: 'Email',
      render: (r) => r.contact_email || <span className="text-text-muted">&mdash;</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <span
          className={[
            'tbl-badge',
            r.status === 'active' ? 'bg-emerald-500/15 text-emerald-400' : 'tbl-badge-neutral',
          ].join(' ')}
        >
          <span
            className={[
              'inline-block h-1.5 w-1.5 rounded-full',
              r.status === 'active' ? 'bg-emerald-400' : 'bg-text-muted',
            ].join(' ')}
          />
          {r.status ?? 'active'}
        </span>
      ),
    },
  ]

  /* ---------- render ---------- */
  return (
    <div className="flex-1 overflow-auto px-6 py-5">
      {/* ── Breadcrumb header ── */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="rounded-xl p-2 text-text-secondary hover:bg-bg-surface-2 transition-colors duration-[120ms]"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2 type-subhead text-text-secondary">
            <button onClick={onBack} className="hover:text-text-primary transition-colors">
              Dashboard
            </button>
            <span>/</span>
            <span className="text-text-primary">Clients</span>
          </div>
        </div>
      </div>

      {/* ── Two-column layout ── */}
      <div className="flex gap-5 items-start" style={{ minHeight: 'calc(100vh - 10rem)' }}>
        {/* ── LEFT: Client list ── */}
        <div className="w-[480px] flex-shrink-0 bg-bg-surface-1 rounded-2xl border border-border-default overflow-hidden flex flex-col">
          {/* header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
            <span className="type-subhead font-semibold text-text-secondary">Clients</span>
            <Button size="sm" variant="primary" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={handleNewClient}>
              New
            </Button>
          </div>

          {/* search */}
          <div className="px-4 py-2 border-b border-border-default">
            <Input
              size="compact"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clients..."
              leftIcon={<Search className="h-3.5 w-3.5" />}
            />
          </div>

          {/* table */}
          <div className="overflow-y-auto flex-1" style={{ maxHeight: 'calc(100vh - 16rem)' }}>
            {loading ? (
              <div className="flex items-center justify-center py-12 text-text-muted type-subhead">
                Loading clients...
              </div>
            ) : (
              <table className="min-w-full type-subhead">
                <thead className="bg-bg-surface-1-alpha sticky top-0 z-[1]">
                  <tr>
                    {columns.map((col) => (
                      <th key={col.key} className="tbl-th">{col.header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length} className="tbl-td text-text-muted type-subhead">
                        {search ? 'No clients match your search.' : 'No clients yet.'}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((client) => (
                      <tr
                        key={client.client_id}
                        className={[
                          'tbl-row cursor-pointer transition-colors duration-[80ms]',
                          client.client_id === selectedId ? 'bg-bg-surface-2' : '',
                        ].join(' ')}
                        onClick={() => handleSelect(client.client_id)}
                      >
                        {columns.map((col) => (
                          <td key={col.key} className="tbl-td">
                            {col.render(client)}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── RIGHT: Detail / Form ── */}
        <div className="flex-1 min-w-0">
          {mode === 'idle' ? (
            /* empty state */
            <div className="bg-bg-surface-1 rounded-2xl border border-border-default flex flex-col items-center justify-center py-24 text-text-muted">
              <UserCircle className="h-12 w-12 mb-3 opacity-40" />
              <p className="type-subhead">Select a client from the list</p>
              <p className="type-caption mt-1">
                or click{' '}
                <button onClick={handleNewClient} className="text-accent-400 hover:underline">
                  + New
                </button>{' '}
                to create one.
              </p>
            </div>
          ) : (
            /* form card — follows StructureDetailPage pattern */
            <div className="bg-bg-surface-1 rounded-2xl border border-border-default overflow-hidden">
              {/* title section */}
              <div className="px-6 pt-6 pb-4 flex items-start justify-between">
                <div>
                  <h1 className="type-title-l font-bold text-text-primary">
                    {mode === 'add' ? 'New Client' : form.client_name || 'Edit Client'}
                  </h1>
                  <div className="mt-1 type-subhead text-text-secondary">
                    {mode === 'add' ? 'Fill in the details below.' : 'Update client information.'}
                  </div>
                </div>
                {mode === 'edit' && (
                  <span
                    className={[
                      'tbl-badge mt-1',
                      form.status === 'active' ? 'bg-emerald-500/15 text-emerald-400' : 'tbl-badge-neutral',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'inline-block h-1.5 w-1.5 rounded-full',
                        form.status === 'active' ? 'bg-emerald-400' : 'bg-text-muted',
                      ].join(' ')}
                    />
                    {form.status}
                  </span>
                )}
              </div>

              {/* form in a sub-card */}
              <div className="mx-6 mb-6">
                <div className="bg-bg-surface-2 rounded-xl border border-border-subtle p-5">
                  <form onSubmit={handleSubmit} className="space-y-5">
                    {/* Client Name */}
                    <Field label="Client Name" required>
                      <Input
                        value={form.client_name}
                        onChange={(e) => set('client_name', e.target.value)}
                        placeholder="e.g. Acme Capital"
                        invalid={form.client_name.length > 0 && !nameValid}
                        autoFocus={mode === 'add'}
                      />
                    </Field>

                    {/* Two-column grid for contact details */}
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Contact Name">
                        <Input
                          value={form.contact_name}
                          onChange={(e) => set('contact_name', e.target.value)}
                          placeholder="Primary contact person"
                        />
                      </Field>

                      <Field label="Contact Email">
                        <Input
                          type="email"
                          value={form.contact_email}
                          onChange={(e) => set('contact_email', e.target.value)}
                          placeholder="contact@example.com"
                          invalid={form.contact_email.length > 0 && !emailValid}
                        />
                      </Field>
                    </div>

                    {/* Phone */}
                    <Field label="Phone">
                      <Input
                        type="tel"
                        value={form.phone}
                        onChange={(e) => set('phone', e.target.value)}
                        placeholder="+1 555 000 0000"
                      />
                    </Field>

                    {/* Mandate */}
                    <Field label="Mandate">
                      <textarea
                        value={form.mandate}
                        onChange={(e) => set('mandate', e.target.value)}
                        placeholder="Describe the client mandate..."
                        rows={3}
                        className="w-full bg-bg-surface-3 border border-border-default rounded-xl px-3 py-2 text-text-primary placeholder:text-text-tertiary outline-none focus:border-border-accent focus:shadow-[var(--glow-accent-sm)] transition-colors duration-[120ms] resize-y"
                      />
                    </Field>

                    {/* Notes */}
                    <Field label="Notes">
                      <textarea
                        value={form.notes}
                        onChange={(e) => set('notes', e.target.value)}
                        placeholder="Additional notes..."
                        rows={2}
                        className="w-full bg-bg-surface-3 border border-border-default rounded-xl px-3 py-2 text-text-primary placeholder:text-text-tertiary outline-none focus:border-border-accent focus:shadow-[var(--glow-accent-sm)] transition-colors duration-[120ms] resize-y"
                      />
                    </Field>

                    {/* Status */}
                    <Field label="Status">
                      <div className="flex gap-2">
                        <StatusChip active={form.status === 'active'} onClick={() => set('status', 'active')} label="Active" />
                        <StatusChip active={form.status === 'inactive'} onClick={() => set('status', 'inactive')} label="Inactive" />
                      </div>
                    </Field>

                    {mode === 'edit' && selectedId && (
                      <AdminReportingCurrencyField
                        client={clients.find((candidate) => candidate.client_id === selectedId) ?? null}
                        state={currencyState}
                        saving={savingReportingCurrencyTargets.has(selectedId)}
                        onChange={handleAdminReportingCurrency}
                      />
                    )}

                    {/* Messages */}
                    {error && <p className="text-status-danger type-caption">{error}</p>}
                    {successMsg && <p className="text-emerald-400 type-caption">{successMsg}</p>}

                    {/* Actions */}
                    <div className="flex gap-3 pt-2">
                      <Button type="submit" variant="primary" loading={saving} disabled={!canSubmit}>
                        {mode === 'add' ? 'Create Client' : 'Save Changes'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => { selectionGenerationRef.current += 1; selectedIdRef.current = null; setCurrencyState({ status: 'idle' }); setMode('idle'); setSelectedId(null); setError(null); setSuccessMsg(null) }}
                        disabled={saving}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Helpers ── */

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="type-caption text-text-secondary">
        {label}
        {required && <span className="text-status-danger ml-0.5">*</span>}
      </span>
      {children}
    </label>
  )
}

function StatusChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'px-3 py-1.5 rounded-lg type-caption font-medium transition-colors duration-[120ms]',
        active
          ? 'bg-accent-500 text-text-primary'
          : 'bg-bg-surface-3 text-text-secondary hover:bg-bg-surface-4',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

function AdminReportingCurrencyField({
  client,
  state,
  saving,
  onChange,
}: {
  client: ClientRecord | null
  state: CurrencyLoadState
  saving: boolean
  onChange: (value: string) => void
}) {
  const configuredCurrency = state.status === 'ready'
    ? state.options.reportingCurrency
    : client?.reporting_currency ?? null
  const source = state.status === 'ready'
    ? state.options.reportingCurrencySource
    : client?.reporting_currency_source ?? null
  const currentMissing = state.status === 'ready'
    && configuredCurrency !== null
    && !state.options.currencies.includes(configuredCurrency)
  const [draft, setDraft] = React.useState(configuredCurrency ?? '')

  // The selected client is keyed by the parent, but configuration can also
  // change after a post-save re-read. Preserve a Hub-missing saved code here
  // rather than silently presenting it as "Not configured".
  React.useEffect(() => {
    setDraft(configuredCurrency ?? '')
  }, [client?.client_id, configuredCurrency])

  const canApply = state.status === 'ready'
    && !saving
    && draft !== ''
    && state.options.currencies.includes(draft)
    && (draft !== configuredCurrency || source !== 'admin')
  const canClear = state.status === 'ready' && !saving && configuredCurrency !== null

  return (
    <fieldset className="space-y-1.5" disabled={saving || state.status !== 'ready'}>
      <div className="flex items-center justify-between gap-3">
        <legend className="type-caption text-text-secondary">Reporting Currency</legend>
        {source && <span className="type-caption text-text-muted">Last selected by {source === 'admin' ? 'administrator' : 'client'}</span>}
      </div>
      {client?.hub_account_label && (
        <p className="type-caption text-text-muted">Hub account: {client.hub_account_label}</p>
      )}
      {state.status === 'loading' && <p className="type-caption text-text-muted">Loading currencies from Portfolio Data Hub…</p>}
      {state.status === 'unmapped' && <p className="type-caption text-text-muted">No Portfolio Data Hub account is mapped to this client.</p>}
      {state.status === 'unavailable' && <p className="type-caption text-status-danger">{state.message}</p>}
      {state.status === 'ready' && (
        <>
          <select
            aria-label="Reporting Currency"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="w-full rounded-xl border border-border-default bg-bg-surface-3 px-3 py-2 text-text-primary outline-none focus:border-border-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">Not configured</option>
            {currentMissing && <option value={configuredCurrency!}>{configuredCurrency} (not in latest summary)</option>}
            {state.options.currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
          </select>
          {currentMissing && (
            <p className="type-caption text-amber-400">
              Current setting {configuredCurrency} is not present in the latest Hub summary. It remains selected until explicitly cleared or replaced.
            </p>
          )}
          {state.options.currencies.length === 0 && (
            <p className="type-caption text-text-muted">The latest Hub summary has no usable account-level currencies.</p>
          )}
          <p className="type-caption text-text-muted">
            Uses an existing Hub summary component only; no FX conversion or currency aggregation is performed.
          </p>
          <div className="flex gap-2 pt-1">
            <Button type="button" size="sm" variant="primary" disabled={!canApply} onClick={() => onChange(draft)}>
              {saving ? 'Saving…' : 'Apply reporting currency'}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={!canClear} onClick={() => onChange('')}>
              Clear
            </Button>
          </div>
        </>
      )}
    </fieldset>
  )
}
