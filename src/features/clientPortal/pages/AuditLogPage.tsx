import React from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { AuditEvent, AuditType } from '../audit'

type Filter = 'all' | 'client actions' | 'activation' | 'parameters' | 'keys' | 'positions' | 'updates'
const FILTERS: Filter[] = ['all', 'client actions', 'activation', 'parameters', 'keys', 'positions', 'updates']

const TYPES_FOR: Partial<Record<Filter, AuditType[]>> = {
  activation: ['ACTIVATION', 'DEACTIVATION'],
  parameters: ['RISK_PARAM'],
  keys: ['API_KEY'],
  positions: ['POSITION'],
  updates: ['UPDATE'],
}

const TYPE_COLOR: Partial<Record<AuditType, string>> = {
  APPROPRIATENESS: 'text-status-success', ACTIVATION: 'text-status-success', DEACTIVATION: 'text-status-danger',
  API_KEY: 'text-status-info', STRATEGY: 'text-accent-400', RISK_PARAM: 'text-accent-400',
  UPDATE: 'text-status-warning', POSITION: 'text-status-danger', EXECUTION: 'text-text-tertiary',
}

function matches(e: AuditEvent, f: Filter): boolean {
  if (f === 'all') return true
  if (f === 'client actions') return e.actor === 'client'
  return (TYPES_FOR[f] ?? []).includes(e.type)
}

export function AuditLogPage({ events }: { events: AuditEvent[] }) {
  const [filter, setFilter] = React.useState<Filter>('all')
  const shown = events.filter((e) => matches(e, filter))
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="type-title-l font-bold text-text-primary">Audit log</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-status-info/15 px-2.5 py-1 type-caption font-semibold text-status-info">append-only · tamper-evident</span>
        <div className="ml-auto"><Button variant="secondary" size="sm" leftIcon={<Download className="h-3.5 w-3.5" />}>Export signed CSV</Button></div>
      </div>
      <div className="rounded-2xl border border-border-default bg-bg-surface-1 p-5">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f} type="button" onClick={() => setFilter(f)}
              className={`rounded-lg border px-2.5 py-1 font-mono text-[11.5px] ${filter === f ? 'border-accent-500/40 bg-accent-500/15 text-accent-400' : 'border-border-default bg-bg-surface-2 text-text-tertiary hover:text-text-secondary'}`}
            >{f}</button>
          ))}
        </div>
        <div className="mt-3.5 overflow-x-auto rounded-xl border border-border-default">
          <div className="grid grid-cols-[176px_110px_128px_1fr] gap-3.5 border-b border-border-default bg-bg-surface-2 px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-text-tertiary" style={{ minWidth: 640 }}>
            <span>timestamp (utc)</span><span>actor</span><span>type</span><span>detail</span>
          </div>
          {shown.length === 0
            ? <div className="px-4 py-6 text-center type-caption text-text-tertiary">No entries for this filter.</div>
            : shown.map((e) => (
              <div key={e.id} className="grid grid-cols-[176px_110px_128px_1fr] gap-3.5 border-t border-border-default px-4 py-2.5 font-mono text-xs first:border-t-0" style={{ minWidth: 640 }}>
                <span className="text-text-tertiary">{e.ts.replace('T', ' ').replace(/\.\d+Z$/, 'Z')}</span>
                <span className={e.actor === 'system' ? 'text-text-faint' : 'text-text-secondary'}>{e.actor === 'system' ? 'system' : 'R.Quandt'}</span>
                <span className={`font-semibold ${TYPE_COLOR[e.type] ?? 'text-text-secondary'}`}>{e.type}</span>
                <span className="truncate text-text-secondary">{e.detail}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
