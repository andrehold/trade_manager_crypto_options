import { Check, AlertCircle } from 'lucide-react'
import { fmtPremium, type Position, type MarksMap } from '@/utils'
import { portfolioSummary } from '../portfolio'
import type { SetupStatus } from '../setupStatus'
import type { PortalPage } from '../routing'

const SETUP_LABELS: { key: keyof SetupStatus; label: string }[] = [
  { key: 'appropriateness', label: 'Appropriateness signed' },
  { key: 'strategy', label: 'Strategy selected' },
  { key: 'riskLimits', label: 'Risk limits set' },
  { key: 'tradingKey', label: 'Exchange key active' },
]

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="rounded-xl border border-border-default bg-bg-surface-1 p-4">
      <div className="type-caption uppercase tracking-wide text-text-tertiary">{label}</div>
      <div className={`mt-1.5 type-title-l font-bold ${tone === 'pos' ? 'text-status-success' : tone === 'neg' ? 'text-status-danger' : 'text-text-primary'}`}>{value}</div>
    </div>
  )
}

export function DashboardPage({ positions, marks, setupStatus, onNavigate }: {
  positions: Position[]; marks?: MarksMap; setupStatus: SetupStatus; onNavigate: (page: PortalPage) => void
}) {
  const s = portfolioSummary(positions, marks)
  const pnl = s.totalPnl
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="type-title-l font-bold text-text-primary">Dashboard</h1>
        <p className="mt-1 type-subhead text-text-secondary">Your portfolio at a glance. Everything here runs on the parameters you set.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Equity" value={fmtPremium(s.totalEquity, s.asset)} />
        <Kpi label="PnL" value={pnl != null ? fmtPremium(pnl, s.asset) : '—'} tone={pnl != null ? (pnl < 0 ? 'neg' : 'pos') : undefined} />
        <Kpi label="PnL %" value={s.pnlPct != null ? `${s.pnlPct.toFixed(2)}%` : '—'} tone={s.pnlPct != null ? (s.pnlPct < 0 ? 'neg' : 'pos') : undefined} />
        <Kpi label="Open positions" value={String(positions.length)} />
      </div>
      <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-5">
        <div className="type-caption uppercase tracking-wide text-text-tertiary">Setup status</div>
        <div className="mt-3 flex flex-wrap gap-2.5">
          {SETUP_LABELS.map(({ key, label }) => {
            const done = setupStatus[key]
            return (
              <button key={key} type="button" onClick={() => onNavigate(key === 'tradingKey' ? 'keys' : key === 'riskLimits' ? 'risk' : key)} className="flex items-center gap-2 rounded-lg border border-border-default bg-bg-canvas px-3 py-2 type-caption text-text-secondary hover:bg-bg-surface-2">
                {done ? <Check className="h-3.5 w-3.5 text-status-success" /> : <AlertCircle className="h-3.5 w-3.5 text-status-warning" />}
                {label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
