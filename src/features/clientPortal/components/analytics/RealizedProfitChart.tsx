import React from 'react'
import type { HubAnalyticsGroup } from '@/lib/portfolioDataHub'
import type { AnalyticsWindow } from '@/lib/portfolioDataHub/analyticsClient'
import { CHART_COLORS } from '../../dashboard/chartTheme'
import { completenessText, metricText, metricUnit, partitionLabel, plotCoordinate, type InspectMetric } from './analyticsPresentation'

const PROFIT = 'calculated_realized_gross_profit'
export function RealizedProfitChart({ groups, window, onInspect }: { groups: HubAnalyticsGroup[]; window: AnalyticsWindow; onInspect: InspectMetric }) {
  const [hovered, setHovered] = React.useState<HubAnalyticsGroup | null>(null)
  const sorted = [...groups].sort((a, b) => (a.dimensions.day ?? '').localeCompare(b.dimensions.day ?? ''))
  const points = sorted.map((group) => ({ group, y: plotCoordinate(group.metrics[PROFIT]?.value) }))
  const maximum = points.reduce((max, point) => point.y === null ? max : Math.max(max, Math.abs(point.y)), 0) || 1
  const positive = points.some((point) => point.y !== null && point.y > 0)
  const negative = points.some((point) => point.y !== null && point.y < 0)
  const baseline = negative && !positive ? 20 : positive && !negative ? 164 : 92
  const heightFor = (value: number) => Math.abs(value) / maximum * (positive && negative ? 72 : 144)
  const start = Date.parse(`${window.start.slice(0, 10)}T00:00:00Z`)
  const days = Math.max(1, Math.ceil((Date.parse(window.end) - start) / 86_400_000))
  const step = 552 / days
  const label = (group: HubAnalyticsGroup) => `${group.dimensions.day ?? 'Unknown day'} · ${metricText(group.metrics[PROFIT])} ${metricUnit(PROFIT, group.dimensions)}${completenessText(group.metrics[PROFIT]) ? ` · ${completenessText(group.metrics[PROFIT])}` : ''}`
  const select = (group: HubAnalyticsGroup) => onInspect(PROFIT, group)
  return <section className="min-w-0 rounded-2xl border border-border-default bg-bg-surface-1 p-4" aria-label="Daily realized trading profit">
    <h4 className="type-subhead font-semibold text-text-primary">Daily realized trading profit</h4>
    <p className="mt-1 type-caption text-text-tertiary">Before fees and funding · UTC. Gaps mean no reported activity; absent days are not zero.</p>
    {groups.length === 0 ? <p className="mt-4 type-caption text-text-secondary">No daily records in available history for this partition.</p> : <>
      <div className="mt-4 min-w-0">
        <svg viewBox="0 0 600 196" className="w-full" aria-label="Positive and negative daily gross-profit bars">
          <line x1="24" x2="576" y1={baseline} y2={baseline} stroke={CHART_COLORS.zero} />
          <text x="4" y={baseline + 4} fill="currentColor" className="text-text-tertiary" fontSize="10">0</text>
          {points.map(({ group, y }, index) => {
            const day = group.dimensions.day
            if (y === null || !day || !group.metrics[PROFIT]?.eligibleCount) return null
            const x = 24 + (Date.parse(`${day}T00:00:00Z`) - start) / 86_400_000 * step + step / 2
            if (!Number.isFinite(x)) return null
            const height = heightFor(y)
            if (y !== 0 && height === 0) return null
            const width = Math.max(1, Math.min(24, step * 0.65))
            return <g key={index} role="button" tabIndex={0} aria-label={`Inspect ${label(group)}`} className="cursor-pointer outline-none focus-visible:stroke-text-primary" onClick={() => select(group)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(group) } }} onMouseEnter={() => setHovered(group)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(group)} onBlur={() => setHovered(null)}>
              <title>{label(group)}</title>
              <rect x={x - width / 2} y={y === 0 ? baseline - 1.5 : y > 0 ? baseline - height : baseline} width={width} height={y === 0 ? 3 : height} rx="2" fill={y < 0 ? CHART_COLORS.danger : CHART_COLORS.good} fillOpacity={group.metrics[PROFIT].missingCount > 0 ? 0.65 : 1} stroke={hovered === group ? CHART_COLORS.accent : group.metrics[PROFIT].missingCount > 0 ? CHART_COLORS.amber : 'none'} strokeWidth={hovered === group ? 2 : 1} strokeDasharray={group.metrics[PROFIT].missingCount > 0 ? '2 2' : undefined} />
            </g>
          })}
          <text x="24" y="184" fill="currentColor" className="text-text-tertiary" fontSize="10">{window.start.slice(0, 10)}</text>
          <text x="576" y="184" textAnchor="end" fill="currentColor" className="text-text-tertiary" fontSize="10">{window.end.slice(0, 10)} (exclusive)</text>
        </svg>
      </div>
      {hovered && groups.includes(hovered) && <div role="tooltip" className="mb-3 break-all rounded-lg border border-border-default bg-bg-surface-2 p-2 type-caption text-text-primary">{label(hovered)}</div>}
      <details className="mt-2" open>
        <summary className="cursor-pointer type-caption text-text-secondary">Daily values and details</summary>
        <div className="mt-3 overflow-x-auto"><table className="w-full text-left type-caption">
          <caption className="sr-only">Exact daily gross profit, before fees and funding. {groups[0] && partitionLabel(groups[0].dimensions)}</caption>
          <thead className="border-b border-border-default text-text-tertiary"><tr><th className="py-2 pr-3 font-medium">Day (UTC)</th><th className="py-2 pr-3 font-medium">Exact profit</th><th className="py-2 font-medium">Availability</th></tr></thead>
          <tbody>{points.map(({ group, y }, index) => <tr className="border-b border-border-default/50" key={index}>
            <td className="whitespace-nowrap py-2 pr-3">{group.metrics[PROFIT]?.eligibleCount > 0 ? <button type="button" className="text-text-accent underline underline-offset-4 focus-visible:outline focus-visible:outline-2" onClick={() => select(group)} aria-label={`Day details: ${label(group)}`}>{group.dimensions.day ?? 'Unknown day'}</button> : group.dimensions.day ?? 'Unknown day'}</td>
            <td className="max-w-56 break-all py-2 pr-3 tabular-nums text-text-primary">{metricText(group.metrics[PROFIT])}{group.metrics[PROFIT]?.value != null ? ` ${metricUnit(PROFIT, group.dimensions)}` : ''}</td>
            <td className="py-2 text-text-secondary">{completenessText(group.metrics[PROFIT]) ?? (group.metrics[PROFIT]?.value != null ? 'Available' : 'No available profit')}{group.metrics[PROFIT]?.value != null && (y === null || (y !== 0 && heightFor(y) === 0)) && <span className="block text-status-warning">Outside plot range; exact value shown.</span>}</td>
          </tr>)}</tbody>
        </table></div>
      </details>
    </>}
  </section>
}
