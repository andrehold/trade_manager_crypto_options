import React from 'react'
import type { PositionIntervention } from '@/lib/positions/interventions'

const SOURCE_ACTION_LABELS: Record<string, string> = {
  'platform:open': 'You opened this via the platform',
  'platform:modify': 'You modified this via the platform',
  'platform:close': 'You closed this via the platform',
  'venue:open': 'Changed directly on venue',
  'venue:modify': 'Changed directly on venue',
  'venue:close': 'Changed directly on venue',
}

function formatTs(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(d)
}

export function formatInterventionTooltip(intervention: PositionIntervention): string {
  const label = SOURCE_ACTION_LABELS[`${intervention.source}:${intervention.action}`] ?? 'Client intervention'
  const when = formatTs(intervention.ts)
  return when ? `${label} · ${when}` : label
}

export function InterventionBadge({ intervention }: { intervention: PositionIntervention }) {
  return (
    <span
      className="ml-2 inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-semibold text-amber-600 cursor-help"
      title={formatInterventionTooltip(intervention)}
    >
      Modified
    </span>
  )
}
