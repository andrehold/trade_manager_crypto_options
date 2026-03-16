import React from 'react'
import { SortHeader } from './SortHeader'

type ColumnDef = {
  key: string
  label: string
  abbr?: string
}

const COLUMNS: ColumnDef[] = [
  { key: 'status', label: 'Status' },
  { key: 'structure', label: 'Structure' },
  { key: 'dte', label: 'DTE/Since' },
  { key: 'legs', label: 'Legs' },
  { key: 'strategy', label: 'Strategy' },
  { key: 'pnl', label: 'PnL' },
  { key: 'pnlpct', label: 'PnL %' },
  { key: 'delta', label: 'Δ', abbr: 'Delta' },
  { key: 'gamma', label: 'Γ', abbr: 'Gamma' },
  { key: 'theta', label: 'Θ', abbr: 'Theta' },
  { key: 'vega', label: 'V', abbr: 'Vega' },
  { key: 'rho', label: 'ρ', abbr: 'Rho' },
  { key: 'playbook', label: 'Playbook' },
]

type SortConfig<K extends string> = {
  sortKey: K
  direction: 'asc' | 'desc'
  onSort: (key: K, direction: 'asc' | 'desc') => void
}

type PositionTableHeadProps<K extends string> = {
  visibleCols: string[]
  sort?: SortConfig<K>
}

export function PositionTableHead<K extends string>({
  visibleCols,
  sort,
}: PositionTableHeadProps<K>) {
  return (
    <thead className="bg-zinc-800/60 text-zinc-400">
      <tr>
        <th className="p-3 text-left w-10"> </th>
        {COLUMNS.map((col) => {
          if (!visibleCols.includes(col.key)) return null
          const content = sort ? (
            <SortHeader<K>
              label={col.abbr ? col.label : col.label}
              sortKey={col.key as K}
              currentKey={sort.sortKey}
              direction={sort.direction}
              onSort={sort.onSort}
            />
          ) : col.abbr ? (
            <abbr title={col.abbr} className="cursor-help">
              {col.label}
            </abbr>
          ) : (
            col.label
          )
          return (
            <th key={col.key} className="p-3 text-left">
              {content}
            </th>
          )
        })}
        <th className="p-3 text-right w-12">
          <span className="sr-only">Save position</span>
        </th>
      </tr>
    </thead>
  )
}
