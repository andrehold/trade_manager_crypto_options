import type { MarginUsage, UtilizationZone } from '../dashboard/marginModel'

const FILL: Record<UtilizationZone, string> = {
  ok: 'bg-status-success', warn: 'bg-amber-400', high: 'bg-status-danger',
}

function fmtCcy(n: number, ccy: string): string {
  return `${Math.round(n).toLocaleString('en-US')} ${ccy}`
}

export function MarginUsageCard({ margin }: { margin: MarginUsage }) {
  const pct = Math.round(margin.imUtilization * 100)
  const rows: { label: React.ReactNode; amount: number }[] = [
    { label: <>Initial Margin <span className="text-text-tertiary">(IM)</span></>, amount: margin.initialMargin },
    { label: <>Maintenance Margin <span className="text-text-tertiary">(MM)</span></>, amount: margin.maintenanceMargin },
    { label: 'Margin Balance', amount: margin.marginBalance },
    { label: 'Available', amount: margin.available },
  ]
  return (
    <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-5">
      <div className="grid gap-6 md:grid-cols-[1.4fr_1fr] md:items-center">
        <div>
          <div className="type-caption uppercase tracking-wide text-text-tertiary">Initial Margin Utilization</div>
          <div className={`mt-1.5 type-title-m font-bold ${margin.zone === 'high' ? 'text-status-danger' : 'text-text-primary'}`}>{pct}%</div>
          <div
            data-testid="im-gauge" data-zone={margin.zone}
            role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
            aria-label="Initial margin utilization"
            className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-bg-surface-3"
          >
            <div className={`h-full rounded-full ${FILL[margin.zone]}`} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <div className="mt-1.5 type-caption text-text-tertiary">
            {fmtCcy(margin.initialMargin, margin.ccy)} committed to initial margin
          </div>
        </div>
        <div className="flex flex-col">
          {rows.map((r, i) => (
            <div key={i} className="flex items-baseline justify-between border-b border-border-subtle py-2 last:border-0">
              <span className="type-caption text-text-secondary">{r.label}</span>
              <span className="type-caption font-semibold text-text-primary tabular-nums">{fmtCcy(r.amount, margin.ccy)}</span>
            </div>
          ))}
          <div className="mt-2 type-caption text-text-tertiary">Amounts in venue margin currency · second-tier to utilization</div>
        </div>
      </div>
    </div>
  )
}
