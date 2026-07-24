import React from 'react'
import { Button } from '@/components/ui/Button'
import { type RiskLimits, ILLUSTRATIVE_READINGS, activeDeltaBand } from './riskLimits'
import { paddedDomain, rangeGauge, bandStatus, capStatus, twoStageGauge } from './gauge'
import { LimitGauge, TwoStageGauge } from './LimitGauge'
import { StressMatrix } from './StressMatrix'

const pctFmt = (n: number) => `${n > 0 ? '+' : ''}${n}%`

function Card({ title, sub, right, children, onApply, applyLabel }: {
  title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode; onApply: () => void; applyLabel: string
}) {
  return (
    <section className="rounded-2xl border border-border-default bg-bg-surface-1">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-5 pt-4">
        <span className="type-subhead font-semibold text-text-primary">{title}</span>
        {sub && <span className="type-caption text-text-tertiary">· {sub}</span>}
        {right && <span className="ml-auto">{right}</span>}
      </div>
      <div className="px-5 pb-2 pt-1">{children}</div>
      <div className="flex items-center gap-3 border-t border-border-default px-5 py-3">
        <span className="font-mono text-[11.5px] text-text-tertiary">client-set · not advised by the software</span>
        <div className="ml-auto"><Button size="sm" variant="primary" onClick={onApply}>{applyLabel}</Button></div>
      </div>
    </section>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="border-t border-border-default py-3.5 first:border-t-0">{children}</div>
}

function BoundInput({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (n: number) => void; step?: number }) {
  return (
    <label className="flex items-center gap-1.5 font-mono text-[11.5px] text-text-tertiary">
      {label}
      <input
        type="number" step={step} value={value} aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 rounded-md border border-border-default bg-bg-surface-2 px-2 py-1 text-right text-text-primary tabular-nums outline-none focus:border-accent-500/50"
      />
    </label>
  )
}

const STATUS_TEXT = { ok: 'text-status-success', near: 'text-status-warning', breach: 'text-status-danger' } as const

function Reading({ value, status }: { value: number; status: 'ok' | 'near' | 'breach' }) {
  return (
    <span className="ml-auto flex items-center gap-2">
      <span className="text-[10.5px] uppercase tracking-wide text-text-tertiary">now</span>
      <span className={`font-mono text-[13.5px] font-bold tabular-nums ${STATUS_TEXT[status]}`}>{pctFmt(value)}</span>
    </span>
  )
}

export function RiskPage({ limits, onApply }: { limits: RiskLimits; onApply: (next: RiskLimits) => void }) {
  const [draft, setDraft] = React.useState<RiskLimits>(limits)
  React.useEffect(() => setDraft(limits), [limits])
  const r = ILLUSTRATIVE_READINGS
  const patch = (p: Partial<RiskLimits>) => setDraft((d) => ({ ...d, ...p }))
  const apply = () => onApply(draft)

  // Applied-limit gauges
  const { band: dBand, regime } = activeDeltaBand(limits, r)
  const dDom = paddedDomain(dBand.min, dBand.max)
  const gDom = paddedDomain(limits.gammaFloor, limits.gammaCap)
  const vDom = paddedDomain(limits.vega.min, limits.vega.max)
  const tHi = Math.abs(limits.thetaFloor)
  const tDom = paddedDomain(limits.thetaFloor, tHi)
  const ndDom: [number, number] = [0, limits.netDeltaMaxPct * 1.3]

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="type-title-l font-bold text-text-primary">Risk &amp; deployment</h1>
          <span className="rounded-full bg-bg-surface-2 px-2.5 py-1 type-caption text-text-tertiary">You set every value</span>
        </div>
        <p className="mt-1 type-subhead text-text-secondary">The limits the software operates within — you define each value; nothing here is suggested by the software.</p>
      </div>

      <div className="flex flex-col gap-2.5 rounded-2xl border border-border-default bg-bg-surface-1 p-4 type-caption text-text-secondary">
        <p><strong className="text-text-primary">TVL — Total Value Locked.</strong> The capital you allocated to this strategy ({limits.capitalTvlBtc} BTC). Every Greek, stress and delta limit is a percentage of it.</p>
        <p><strong className="text-text-primary">On breach.</strong> Greek, stress &amp; net-delta limits trigger automatic <strong className="text-text-primary">rebalancing</strong> back within range; the drawdown stop is staged — <span className="text-status-warning">reduce risk</span>, then <span className="text-status-danger">stop &amp; close</span>.</p>
      </div>

      {/* Deployment */}
      <Card title="Deployment" sub="capital &amp; scheduling" onApply={apply} applyLabel="Apply deployment">
        <Row>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="type-subhead text-text-primary">Capital allocation (TVL)</span>
            <BoundInput label="Capital allocation (BTC)" value={draft.capitalTvlBtc} step={0.001} onChange={(n) => patch({ capitalTvlBtc: n })} />
          </div>
        </Row>
        <Row>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="type-subhead text-text-primary">Max concurrent structures</span>
            <BoundInput label="Max concurrent structures" value={draft.maxConcurrent} onChange={(n) => patch({ maxConcurrent: n })} />
          </div>
        </Row>
        <Row>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="type-subhead text-text-primary">Expiry window (DTE)</span>
            <div className="flex gap-2">
              <BoundInput label="Min DTE" value={draft.expiryMinDte} onChange={(n) => patch({ expiryMinDte: n })} />
              <BoundInput label="Max DTE" value={draft.expiryMaxDte} onChange={(n) => patch({ expiryMaxDte: n })} />
            </div>
          </div>
        </Row>
      </Card>

      {/* Greek limits */}
      <Card title="Greek exposure limits" sub="% of TVL · live values illustrative" onApply={apply} applyLabel="Apply greek limits"
        right={<span className="rounded-full bg-status-info/15 px-2.5 py-1 text-[10.5px] font-semibold text-status-info">on breach → rebalance</span>}>
        {/* Delta */}
        <Row>
          <div className="flex flex-wrap items-center gap-2">
            <span className="type-subhead font-semibold text-text-primary">Delta Cash</span>
            <span className="font-mono text-[11px] text-text-secondary">band depends on Γ regime</span>
            <Reading value={r.deltaPct} status={bandStatus(r.deltaPct, dBand.min, dBand.max)} />
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2 font-mono text-[11px]">
            <span className={`rounded-lg border px-2.5 py-1 ${regime === 'long' ? 'border-accent-500/40 bg-accent-500/15 text-accent-400' : 'border-border-default text-text-tertiary'}`}>Γ &gt; 0 → ±60%</span>
            <span className={`rounded-lg border px-2.5 py-1 ${regime === 'short' ? 'border-accent-500/40 bg-accent-500/15 text-accent-400' : 'border-border-default text-text-tertiary'}`}>Γ &lt; 0 → ±10% · active</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <BoundInput label="Γ<0 min" value={draft.deltaShortGamma.min} onChange={(n) => patch({ deltaShortGamma: { ...draft.deltaShortGamma, min: n } })} />
            <BoundInput label="Γ<0 max" value={draft.deltaShortGamma.max} onChange={(n) => patch({ deltaShortGamma: { ...draft.deltaShortGamma, max: n } })} />
          </div>
          <LimitGauge model={rangeGauge(r.deltaPct, dDom[0], dDom[1], dBand.min, dBand.max)} status={bandStatus(r.deltaPct, dBand.min, dBand.max)} leftLabel={`${dBand.min}%`} rightLabel={`+${dBand.max}%`} />
        </Row>
        {/* Gamma */}
        <Row>
          <div className="flex flex-wrap items-center gap-2">
            <span className="type-subhead font-semibold text-text-primary">Gamma Cash <span className="font-normal text-text-tertiary">(per 1% move)</span></span>
            <span className="font-mono text-[11px] text-text-secondary">−10% &lt; Γ% &lt; 0%</span>
            <Reading value={r.gammaPct} status={bandStatus(r.gammaPct, limits.gammaFloor, limits.gammaCap)} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <BoundInput label="Γ floor" value={draft.gammaFloor} onChange={(n) => patch({ gammaFloor: n })} />
            <BoundInput label="Γ cap" value={draft.gammaCap} onChange={(n) => patch({ gammaCap: n })} />
          </div>
          <LimitGauge floorTick model={rangeGauge(r.gammaPct, gDom[0], gDom[1], limits.gammaFloor, limits.gammaCap)} status={bandStatus(r.gammaPct, limits.gammaFloor, limits.gammaCap)} leftLabel={<span className="text-status-danger">{limits.gammaFloor}% floor</span>} rightLabel={`${limits.gammaCap}% cap`} />
        </Row>
        {/* Vega */}
        <Row>
          <div className="flex flex-wrap items-center gap-2">
            <span className="type-subhead font-semibold text-text-primary">Vega Cash <span className="font-normal text-text-tertiary">(per 1% IV)</span></span>
            <span className="font-mono text-[11px] text-text-secondary">−0.5% &lt; V% &lt; +0.5%</span>
            <Reading value={r.vegaPct} status={bandStatus(r.vegaPct, limits.vega.min, limits.vega.max)} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <BoundInput label="V min" value={draft.vega.min} step={0.1} onChange={(n) => patch({ vega: { ...draft.vega, min: n } })} />
            <BoundInput label="V max" value={draft.vega.max} step={0.1} onChange={(n) => patch({ vega: { ...draft.vega, max: n } })} />
          </div>
          <LimitGauge model={rangeGauge(r.vegaPct, vDom[0], vDom[1], limits.vega.min, limits.vega.max)} status={bandStatus(r.vegaPct, limits.vega.min, limits.vega.max)} leftLabel={`${limits.vega.min}%`} rightLabel={`+${limits.vega.max}%`} />
        </Row>
        {/* Theta */}
        <Row>
          <div className="flex flex-wrap items-center gap-2">
            <span className="type-subhead font-semibold text-text-primary">Theta Cash</span>
            <span className="font-mono text-[11px] text-text-secondary">−2% &lt; Θ%</span>
            <Reading value={r.thetaPct} status={bandStatus(r.thetaPct, limits.thetaFloor, tHi)} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <BoundInput label="Θ floor" value={draft.thetaFloor} onChange={(n) => patch({ thetaFloor: n })} />
          </div>
          <LimitGauge floorTick model={rangeGauge(r.thetaPct, tDom[0], tDom[1], limits.thetaFloor, tHi)} status={bandStatus(r.thetaPct, limits.thetaFloor, tHi)} leftLabel={<span className="text-status-danger">{limits.thetaFloor}% floor</span>} rightLabel={`+${tHi}%`} />
        </Row>
      </Card>

      {/* Stress & aggregate */}
      <Card title="Stress &amp; aggregate limits" sub="% of TVL" onApply={apply} applyLabel="Apply stress limits">
        <Row>
          <div className="flex flex-wrap items-center gap-2">
            <span className="type-subhead font-semibold text-text-primary">Stress loss</span>
            <span className="font-mono text-[11px] text-text-secondary">≤ {limits.stressLossMaxPct}% TVL</span>
            <Reading value={-r.stressWorstPct} status={capStatus(r.stressWorstPct, limits.stressLossMaxPct)} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <BoundInput label="Stress loss max" value={draft.stressLossMaxPct} onChange={(n) => patch({ stressLossMaxPct: n })} />
          </div>
          <StressMatrix />
          <p className="mt-2.5 font-sans type-caption text-text-tertiary">Worst-case loss <strong className="text-text-primary">{r.stressWorstPct}%</strong> · limit <strong className="text-text-primary">{limits.stressLossMaxPct}%</strong>.</p>
        </Row>
        <Row>
          <div className="flex flex-wrap items-center gap-2">
            <span className="type-subhead font-semibold text-text-primary">Net delta (absolute)</span>
            <span className="font-mono text-[11px] text-text-secondary">|Δ| ≤ {limits.netDeltaMaxPct}% TVL</span>
            <Reading value={r.netDeltaPct} status={capStatus(r.netDeltaPct, limits.netDeltaMaxPct)} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <BoundInput label="Net delta cap" value={draft.netDeltaMaxPct} onChange={(n) => patch({ netDeltaMaxPct: n })} />
          </div>
          <LimitGauge floorTick model={rangeGauge(r.netDeltaPct, ndDom[0], ndDom[1], 0, limits.netDeltaMaxPct)} status={capStatus(r.netDeltaPct, limits.netDeltaMaxPct)} leftLabel="0" rightLabel={<span className="text-status-danger">{limits.netDeltaMaxPct}% cap</span>} />
        </Row>
        <Row>
          <div className="flex flex-wrap items-center gap-2">
            <span className="type-subhead font-semibold text-text-primary">Drawdown stop <span className="font-normal text-text-tertiary">(two-stage)</span></span>
            <Reading value={r.drawdownPct} status={twoStageGauge(r.drawdownPct, limits.drawdownReducePct, limits.drawdownStopPct, limits.drawdownStopPct * 1.2).status} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <BoundInput label="Reduce %" value={draft.drawdownReducePct} onChange={(n) => patch({ drawdownReducePct: n })} />
            <BoundInput label="Stop %" value={draft.drawdownStopPct} onChange={(n) => patch({ drawdownStopPct: n })} />
          </div>
          <TwoStageGauge model={twoStageGauge(r.drawdownPct, limits.drawdownReducePct, limits.drawdownStopPct, limits.drawdownStopPct * 1.2)} leftLabel="0" midLabel={`reduce · ${limits.drawdownReducePct}%`} rightLabel={`stop & close · ${limits.drawdownStopPct}%`} />
        </Row>
      </Card>
    </div>
  )
}
