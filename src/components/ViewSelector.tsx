import React from 'react'
import { Search } from 'lucide-react'
import { SegmentedControl } from './ui'

export type ActiveView = 'table' | 'kanban' | 'gantt'

const VIEW_ITEMS = [
  { value: 'table',  label: 'Table'  },
  { value: 'kanban', label: 'Kanban' },
  { value: 'gantt',  label: 'Gantt'  },
]

type Props = {
  activeView: ActiveView
  onViewChange: (view: ActiveView) => void
  query: string
  onQueryChange: (q: string) => void
  searchSuggestions?: React.ReactNode
  onSearchFocus?: () => void
  onSearchBlur?: () => void
  onSearchKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

export function ViewSelector({
  activeView,
  onViewChange,
  query,
  onQueryChange,
  searchSuggestions,
  onSearchFocus,
  onSearchBlur,
  onSearchKeyDown,
}: Props) {
  return (
    <div className="flex items-center justify-between px-6 py-3 gap-4">
      {/* View toggle pill */}
      <SegmentedControl
        items={VIEW_ITEMS}
        value={activeView}
        onChange={(v) => onViewChange(v as ActiveView)}
      />

      {/* Search */}
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-text-tertiary pointer-events-none" />
        <input
          className="w-full bg-bg-surface-2 border border-border-default rounded-xl pl-9 pr-3 py-2 type-subhead text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-accent focus:shadow-[var(--glow-accent-sm)] transition-colors"
          placeholder="Search symbol, strategy, strike…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={onSearchFocus}
          onBlur={onSearchBlur}
          onKeyDown={onSearchKeyDown}
        />
        {searchSuggestions}
      </div>
    </div>
  )
}
