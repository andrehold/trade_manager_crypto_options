import React from 'react'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import type { SupabaseClient } from '@supabase/supabase-js'

export type ClientFormData = {
  client_name: string
  contact_name: string
  contact_email: string
  phone: string
  mandate: string
  notes: string
  status: 'active' | 'inactive'
}

type AddClientPageProps = {
  supabase: SupabaseClient | null
  isAdmin: boolean
  onClientAdded: (name: string) => void
  onCancel: () => void
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

export default function AddClientPage({ supabase, isAdmin, onClientAdded, onCancel }: AddClientPageProps) {
  const [form, setForm] = React.useState<ClientFormData>(emptyForm)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const set = <K extends keyof ClientFormData>(key: K, value: ClientFormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const nameValid = form.client_name.trim().length > 0
  const emailValid = !form.contact_email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contact_email)
  const canSubmit = nameValid && emailValid && !saving

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    setError(null)
    setSaving(true)

    try {
      if (!supabase) {
        onClientAdded(form.client_name.trim())
        return
      }

      const payload: Record<string, string> = { client_name: form.client_name.trim() }
      if (form.contact_name.trim()) payload.contact_name = form.contact_name.trim()
      if (form.contact_email.trim()) payload.contact_email = form.contact_email.trim()
      if (form.phone.trim()) payload.phone = form.phone.trim()
      if (form.mandate.trim()) payload.mandate = form.mandate.trim()
      if (form.notes.trim()) payload.notes = form.notes.trim()
      payload.status = form.status

      const { error: dbError } = await supabase
        .from('clients')
        .insert(payload)
        .select('client_id')
        .single()

      if (dbError) {
        if (dbError.code === '23505') {
          setError('A client with this name already exists.')
        } else {
          setError(dbError.message)
        }
        return
      }

      onClientAdded(form.client_name.trim())
    } catch (err: any) {
      setError(err?.message ?? 'Unexpected error')
    } finally {
      setSaving(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-secondary type-subhead">
        Client management is restricted to admin users.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-xl mx-auto bg-bg-surface-1 rounded-2xl border border-border-default p-6">
        <h2 className="type-title-m text-text-primary mb-6">Add Client</h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Client Name */}
          <Field label="Client Name" required>
            <Input
              value={form.client_name}
              onChange={(e) => set('client_name', e.target.value)}
              placeholder="e.g. Acme Capital"
              invalid={form.client_name.length > 0 && !nameValid}
              autoFocus
            />
          </Field>

          {/* Contact Name */}
          <Field label="Contact Name">
            <Input
              value={form.contact_name}
              onChange={(e) => set('contact_name', e.target.value)}
              placeholder="Primary contact person"
            />
          </Field>

          {/* Contact Email */}
          <Field label="Contact Email">
            <Input
              type="email"
              value={form.contact_email}
              onChange={(e) => set('contact_email', e.target.value)}
              placeholder="contact@example.com"
              invalid={form.contact_email.length > 0 && !emailValid}
            />
          </Field>

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
              className="w-full bg-bg-surface-2 border border-border-default rounded-xl px-3 py-2 text-text-primary placeholder:text-text-tertiary outline-none focus:border-border-accent focus:shadow-[var(--glow-accent-sm)] transition-colors duration-[120ms] resize-y"
            />
          </Field>

          {/* Notes */}
          <Field label="Notes">
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Additional notes..."
              rows={2}
              className="w-full bg-bg-surface-2 border border-border-default rounded-xl px-3 py-2 text-text-primary placeholder:text-text-tertiary outline-none focus:border-border-accent focus:shadow-[var(--glow-accent-sm)] transition-colors duration-[120ms] resize-y"
            />
          </Field>

          {/* Status */}
          <Field label="Status">
            <div className="flex gap-2">
              <StatusChip
                active={form.status === 'active'}
                onClick={() => set('status', 'active')}
                label="Active"
              />
              <StatusChip
                active={form.status === 'inactive'}
                onClick={() => set('status', 'inactive')}
                label="Inactive"
              />
            </div>
          </Field>

          {/* Error */}
          {error && (
            <p className="text-status-danger type-caption">{error}</p>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button type="submit" variant="primary" loading={saving} disabled={!canSubmit}>
              Add Client
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

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
