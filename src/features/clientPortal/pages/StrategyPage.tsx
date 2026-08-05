import React from 'react'
import { Button } from '@/components/ui/Button'

const MODULES: { name: string; desc: string; facts: string[] }[] = [
  { name: 'Obsidian Core Yield', desc: 'Systematic BTC options yield — multi-leg structures actively managed within a defined delta corridor to capture structural carry in rangebound markets.', facts: ['BTC options · European, cash-settled', 'iron condor / diagonal / vertical', 'Deribit · Coincall'] },
  { name: 'Nocturne Theta', desc: 'Short-dated premium capture — harvests time value on a compressed expiry cadence, managed to a delta band you set.', facts: ['horizon 0–3 DTE', 'legs 2–4', 'venue Deribit'] },
  { name: 'Ironbark Overlay', desc: 'Options overlay layered on a core BTC holding to generate income against existing exposure.', facts: ['overlay on spot/perp', 'legs 1–2', 'venue Deribit'] },
  { name: 'Obsidian Carry', desc: 'Captures volatility and term carry via calendar and diagonal spreads across expiries.', facts: ['horizon 7–30 DTE', 'legs 2', 'venue Deribit'] },
  { name: 'Twin Flow', desc: 'Delta-neutral paired structure rebalanced across two legs to harvest volatility flow.', facts: ['delta-neutral', 'legs 2', 'venue Deribit'] },
]

export function StrategyPage({ selected, onSelect }: { selected: string | null; onSelect: (name: string) => void }) {
  const [pick, setPick] = React.useState<string>(selected ?? MODULES[0].name)
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="type-title-l font-bold text-text-primary">Strategy module</h1>
        <span className="rounded-full bg-bg-surface-2 px-2.5 py-1 type-caption text-text-tertiary">You select</span>
      </div>
      <p className="type-subhead text-text-secondary">Choose which module the software runs. Modules are presented neutrally — the software does not recommend one over another.</p>
      <div className="rounded-2xl border border-border-default bg-bg-surface-1">
        <div className="px-5 py-2">
          {MODULES.map((m) => (
            <button
              key={m.name} type="button" onClick={() => setPick(m.name)}
              className="flex w-full items-start gap-3.5 border-t border-border-default py-3.5 text-left first:border-t-0"
            >
              <span className={`mt-1 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2 ${pick === m.name ? 'border-accent-500' : 'border-text-faint'}`}>
                {pick === m.name && <span className="h-2 w-2 rounded-full bg-accent-500" />}
              </span>
              <span className="flex-1">
                <span className="block type-subhead font-semibold text-text-primary">{m.name}</span>
                <span className="block type-caption text-text-tertiary">{m.desc}</span>
                <span className="mt-1.5 flex flex-wrap gap-3 font-mono text-[11px] text-text-tertiary">{m.facts.map((f) => <span key={f}>{f}</span>)}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center border-t border-border-default px-5 py-3">
          <span className="font-mono type-caption text-text-tertiary">client-set · not advised by the software</span>
          <div className="ml-auto"><Button variant="primary" size="sm" onClick={() => onSelect(pick)}>Apply selection</Button></div>
        </div>
      </div>
    </div>
  )
}
