import React from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'

export type SortHeaderProps<K extends string> = {
  label: string
  sortKey: K
  currentKey: K
  direction: 'asc' | 'desc'
  onSort: (key: K, direction: 'asc' | 'desc') => void
}

export function SortHeader<K extends string>({
  label,
  sortKey,
  currentKey,
  direction,
  onSort,
}: SortHeaderProps<K>) {
  const isActive = currentKey === sortKey
  const handleClick = () => {
    const next = isActive && direction === 'asc' ? 'desc' : 'asc'
    onSort(sortKey, next)
  }

  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 hover:text-subtle"
      aria-label={`Sort by ${label}`}
      onClick={handleClick}
    >
      <span>{label}</span>
      {isActive && (
        direction === 'asc'
          ? <ChevronUp className="h-3 w-3 text-strong" />
          : <ChevronDown className="h-3 w-3 text-strong" />
      )}
    </button>
  )
}
