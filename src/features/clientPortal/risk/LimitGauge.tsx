import type { GaugeModel, TwoStageModel, LimitStatus } from './gauge'

const MARKER_COLOR: Record<LimitStatus, string> = {
  ok: 'bg-status-success', near: 'bg-status-warning', breach: 'bg-status-danger',
}

function Marker({ pct, status }: { pct: number; status: LimitStatus }) {
  return (
    <span
      data-role="marker"
      className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg-canvas ${MARKER_COLOR[status]}`}
      style={{ left: `${pct}%` }}
    />
  )
}

export function LimitGauge({ model, status, leftLabel, rightLabel, floorTick }: {
  model: GaugeModel; status: LimitStatus; leftLabel: React.ReactNode; rightLabel: React.ReactNode; floorTick?: boolean
}) {
  return (
    <div className="mt-3">
      <div className="relative h-2 rounded-full bg-status-danger/15">
        <div className="absolute inset-y-0 rounded-full bg-status-success/20" style={{ left: `${model.safeStartPct}%`, width: `${model.safeWidthPct}%` }} />
        {floorTick && <span className="absolute -inset-y-1 w-px bg-status-danger/60" style={{ left: `${model.safeStartPct}%` }} />}
        {model.zeroPct != null && <span className="absolute -inset-y-1 w-px bg-border-default" style={{ left: `${model.zeroPct}%` }} />}
        <Marker pct={model.markerPct} status={status} />
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10.5px] text-text-tertiary">
        <span>{leftLabel}</span><span>{rightLabel}</span>
      </div>
    </div>
  )
}

export function TwoStageGauge({ model, leftLabel, midLabel, rightLabel }: {
  model: TwoStageModel; leftLabel: React.ReactNode; midLabel: React.ReactNode; rightLabel: React.ReactNode
}) {
  return (
    <div className="mt-3">
      <div className="relative h-2 rounded-full bg-status-success/20">
        <div className="absolute inset-y-0 bg-status-warning/25" style={{ left: `${model.amberStartPct}%`, width: `${model.redStartPct - model.amberStartPct}%` }} />
        <div className="absolute inset-y-0 rounded-r-full bg-status-danger/20" style={{ left: `${model.redStartPct}%`, right: 0 }} />
        <span className="absolute -inset-y-1 w-px bg-status-warning" style={{ left: `${model.amberStartPct}%` }} />
        <span className="absolute -inset-y-1 w-px bg-status-danger" style={{ left: `${model.redStartPct}%` }} />
        <Marker pct={model.markerPct} status={model.status} />
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10.5px] text-text-tertiary">
        <span>{leftLabel}</span><span className="text-status-warning">{midLabel}</span><span className="text-status-danger">{rightLabel}</span>
      </div>
    </div>
  )
}
