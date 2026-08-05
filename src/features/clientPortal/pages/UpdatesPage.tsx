import { Download, Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'

const PENDING = {
  ver: 'v2.4.1',
  changelog: [
    'Deribit reconnection hardening after venue maintenance windows',
    'Drawdown-stop evaluation moved to per-tick (was per-minute)',
    'Audit-log export now includes cryptographic chain hash',
  ],
}
const HISTORY = [
  { ver: 'v2.4.0', date: '2026-07-11', note: 'Portfolio-greeks aggregation fix' },
  { ver: 'v2.3.5', date: '2026-06-28', note: 'CoinCall venue adapter' },
]

export function UpdatesPage({ approvedVersions, onApprove }: { approvedVersions: string[]; onApprove: (ver: string) => void }) {
  const installed = approvedVersions.includes(PENDING.ver)
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="type-title-l font-bold text-text-primary">Software updates</h1>
        <span className="rounded-full bg-bg-surface-2 px-2.5 py-1 font-mono type-caption text-text-tertiary">current v2.4.0</span>
        {!installed && <span className="rounded-full bg-status-warning/15 px-2.5 py-1 type-caption font-semibold text-status-warning">1 pending your approval</span>}
      </div>
      <p className="type-subhead text-text-secondary">Updates install only after you review and approve them. Nothing is applied automatically.</p>
      <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-5">
        <div className={`flex flex-wrap gap-3.5 rounded-xl border p-4 ${installed ? 'border-status-success/30 bg-status-success/10' : 'border-status-warning/30 bg-status-warning/10'}`}>
          <span className={installed ? 'text-status-success' : 'text-status-warning'}>{installed ? <Check className="h-5 w-5" /> : <Download className="h-5 w-5" />}</span>
          <div className="min-w-0 flex-1">
            <div className="type-subhead font-semibold text-text-primary">Update {installed ? 'applied' : 'available'} — <span className="font-mono text-status-warning">{PENDING.ver}</span></div>
            <ul className="mt-2 list-disc pl-4 type-caption text-text-secondary">{PENDING.changelog.map((c) => <li key={c}>{c}</li>)}</ul>
          </div>
          <div className="self-center">
            <Button variant="primary" size="sm" disabled={installed} onClick={() => onApprove(PENDING.ver)}>{installed ? 'Installed' : 'Approve & install'}</Button>
          </div>
        </div>
        <div className="mt-4">
          {HISTORY.map((h) => (
            <div key={h.ver} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-default py-2.5 type-caption">
              <span className="w-16 font-mono font-semibold text-text-secondary">{h.ver}</span>
              <span className="font-mono text-text-tertiary">{h.date}</span>
              <span className="text-text-secondary">{h.note}</span>
              <span className="ml-auto text-text-tertiary">approved by <b className="text-text-secondary">R. Quandt</b></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
