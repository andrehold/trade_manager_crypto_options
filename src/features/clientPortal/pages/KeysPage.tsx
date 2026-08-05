import React from 'react'
import { Plus, Info } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { ExchangeKey, AddKeyInput } from '@/lib/clientPortal/exchangeKeysRepo'

const VENUES = ['Deribit', 'Coincall', 'Bullish', 'CME'] as const

function Scope({ children, deny }: { children: React.ReactNode; deny?: boolean }) {
  return <span className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] ${deny ? 'bg-status-danger/15 text-status-danger' : 'bg-status-success/15 text-status-success'}`}>{children}</span>
}

function KeyRow({ k, onRevoke }: { k: ExchangeKey; onRevoke: () => void }) {
  const tag = (k.venue ?? '—').slice(0, 3).toUpperCase()
  return (
    <div className="flex flex-wrap items-center gap-3.5 border-t border-border-default py-3.5 first:border-t-0">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-bg-surface-3 font-mono text-[11px] font-bold text-text-secondary">{tag}</div>
      <div className="min-w-0 flex-1">
        <div className="type-subhead font-semibold text-text-primary">{k.label ?? 'Unnamed key'}</div>
        {k.fingerprint && <div className="font-mono type-caption text-text-tertiary">key ····{k.fingerprint}</div>}
        <div className="mt-1.5 flex flex-wrap gap-1.5"><Scope>trade</Scope><Scope>read</Scope><Scope deny>no withdrawal</Scope></div>
      </div>
      <Button variant="danger" size="sm" onClick={onRevoke}>Revoke</Button>
    </div>
  )
}

export function KeysPage({ keys, onAddKey, onRevokeKey }: {
  keys: ExchangeKey[]; onAddKey: (input: AddKeyInput) => void; onRevokeKey: (keyRef: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [venue, setVenue] = React.useState<string>(VENUES[0])
  const [label, setLabel] = React.useState('')
  const [fingerprint, setFingerprint] = React.useState('')
  const [noWithdrawal, setNoWithdrawal] = React.useState(false)
  const canAdd = label.trim().length > 0 && noWithdrawal

  const submit = () => {
    if (!canAdd) return
    onAddKey({ venue, label: label.trim(), fingerprint: fingerprint.trim() || null, noWithdrawal: true })
    setLabel(''); setFingerprint(''); setNoWithdrawal(false); setOpen(false)
  }

  const field = 'rounded-lg border border-border-default bg-bg-surface-2 px-3 py-2 type-caption text-text-primary placeholder:text-text-faint'
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="type-title-l font-bold text-text-primary">Exchange API keys</h1>
        <span className={`rounded-full px-2.5 py-1 type-caption font-semibold ${keys.length > 0 ? 'bg-status-success/15 text-status-success' : 'bg-bg-surface-2 text-text-tertiary'}`}>{keys.length > 0 ? `${keys.length} active` : 'No trading key'}</span>
        <div className="ml-auto"><Button variant="secondary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => setOpen((o) => !o)}>Add key</Button></div>
      </div>
      <p className="type-subhead text-text-secondary">You create these keys on the venue and control them here. The software never holds withdrawal permission and cannot move funds.</p>

      {open && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border-default bg-bg-surface-1 p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 type-caption text-text-tertiary">Venue
              <select className={field} value={venue} onChange={(e) => setVenue(e.target.value)}>
                {VENUES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 type-caption text-text-tertiary">Label
              <input className={field} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Deribit — main" />
            </label>
            <label className="flex flex-col gap-1 type-caption text-text-tertiary">Fingerprint (optional)
              <input className={field} value={fingerprint} onChange={(e) => setFingerprint(e.target.value)} placeholder="last 6 chars" maxLength={12} />
            </label>
          </div>
          <label className="flex items-center gap-2 type-caption text-text-secondary">
            <input type="checkbox" checked={noWithdrawal} onChange={(e) => setNoWithdrawal(e.target.checked)} />
            No withdrawal permission on this key
          </label>
          <div className="flex justify-end">
            <Button variant="primary" size="sm" disabled={!canAdd} onClick={submit}>Add</Button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-5">
        {keys.length === 0 ? (
          <div className="py-6 text-center type-caption text-text-tertiary">No keys registered yet.</div>
        ) : (
          keys.map((k) => <KeyRow key={k.keyRef} k={k} onRevoke={() => onRevokeKey(k.keyRef)} />)
        )}
        <div className="mt-3.5 flex items-start gap-2 type-caption text-text-tertiary">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-faint" />
          Keys are generated by you on the venue. Revoking a key here and on the venue immediately halts all execution.
        </div>
      </div>
    </div>
  )
}
