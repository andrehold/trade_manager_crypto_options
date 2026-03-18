import React from 'react'

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
  const isAsc = currentKey === sortKey && direction === 'asc'
  const isDesc = currentKey === sortKey && direction === 'desc'
  return (
    <div className="inline-flex items-center gap-2">
      <span>{label}</span>
      <span className="inline-flex flex-col -space-y-1">
        <button
          type="button"
          className={`text-[10px] leading-none ${isAsc ? 'text-strong' : 'text-faint hover:text-subtle'}`}
          aria-label={`Sort ${label} ascending`}
          onClick={() => onSort(sortKey, 'asc')}
        >
          ▲
        </button>
        <button
          type="button"
          className={`text-[10px] leading-none ${isDesc ? 'text-strong' : 'text-faint hover:text-subtle'}`}
          aria-label={`Sort ${label} descending`}
          onClick={() => onSort(sortKey, 'desc')}
        >
          ▼
        </button>
      </span>
    </div>
  )
}
