import React from 'react'
import { GripVertical } from 'lucide-react'
import { SortHeader } from './SortHeader'

type ColumnDef = {
  key: string
  label: string
  abbr?: string
}

const COLUMNS: ColumnDef[] = [
  { key: 'status', label: 'Status' },
  { key: 'dte', label: 'DTE/Since' },
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
    <thead className="bg-bg-surface-1-alpha">
      <tr>
        <th className="tbl-th w-10"> </th>
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
            <abbr title={col.abbr} className="cursor-help no-underline">
              {col.label}
            </abbr>
          ) : (
            col.label
          )
          return (
            <th key={col.key} className="tbl-th">
              <span className="inline-flex items-center gap-1.5">
                <GripVertical className="h-3 w-3 text-faint" />
                {content}
              </span>
            </th>
          )
        })}
        <th className="tbl-th text-right w-12">
          <span className="sr-only">Actions</span>
        </th>
      </tr>
    </thead>
  )
}
