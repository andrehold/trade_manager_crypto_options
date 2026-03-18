import React from 'react'
import { LayoutList, Columns3, GanttChart, Search } from 'lucide-react'

export type ActiveView = 'table' | 'kanban' | 'gantt'

const VIEWS: { key: ActiveView; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'table',  label: 'Table',  Icon: LayoutList  },
  { key: 'kanban', label: 'Kanban', Icon: Columns3     },
  { key: 'gantt',  label: 'Gantt',  Icon: GanttChart   },
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
      <div className="flex items-center gap-0.5 bg-surface-section border border-default rounded-xl p-1 flex-shrink-0">
        {VIEWS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => onViewChange(key)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg type-subhead font-medium transition-colors ${
              activeView === key
                ? 'bg-surface-primary-btn text-on-primary-btn'
                : 'text-muted hover:text-strong'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-muted pointer-events-none" />
        <input
          className="w-full bg-surface-section border border-default rounded-xl pl-9 pr-3 py-2 type-subhead text-strong placeholder-text-faint focus:outline-none focus:ring-1 focus:ring-border-accent focus:border-accent transition-colors"
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
